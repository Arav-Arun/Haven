// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {UserRegistry} from "@ensv2/registry/UserRegistry.sol";
import {RegistryRolesLib} from "@ensv2/registry/libraries/RegistryRolesLib.sol";
import {EnhancedAccessControl} from "@ensv2/access-control/EnhancedAccessControl.sol";
import {IEnhancedAccessControl} from "@ensv2/access-control/interfaces/IEnhancedAccessControl.sol";
import {ILabelStore} from "@ensv2/utils/interfaces/ILabelStore.sol";
import {InvalidOwner} from "@ensv2/CommonErrors.sol";

/// @title DriveRegistry
/// @notice A Cloakroom folder or room: a stock ENSv2 `UserRegistry` (deployed as a proxy through `VerifiableFactory`)
///         that adds
///         - access that ends on its own (`grantRolesUntil`; `_getRoles` drops drive roles at the end date),
///         - an onchain access history, so `wasAllowed(account, roles, t)` answers for any past time t with a plain
///           view call (no archive node, no log scan),
///         - `sweep`, so anyone can free the holder slot of an expired grant,
///         - a permanent upgrade freeze, and a split between everyday powers (drive key K) and dangerous powers
///           (main wallet W).
///
/// Roles (root resource only):
///   viewer  = ROLE_DRIVE_READ
///   editor  = ROLE_DRIVE_READ | ROLE_DRIVE_WRITE
///   manager = all three drive roles and their admin bits (ENSv2's own rule: an admin bit lets you grant and revoke)
///
/// Rules on top of stock ENSv2:
///   1. Drive roles are granted only through `grantRolesUntil` (stock `grantRootRoles` refuses them), only on the
///      root resource, and always with an end date. The owner's drive roles are the one exception: set once, no end.
///   2. Nobody but the owner can revoke or time-limit the owner's drive roles. (Stock ENSv2 lets any admin of a role
///      revoke it from anyone, which would let a manager lock the owner out.)
///   3. A grant never outlives the grantor's own access, so a manager can't extend their own access.
///   4. Expired access never comes back: re-granting an expired account first clears its stale roles.
///   5. History is recorded in `_grantRoles` / `_revokeRoles`. ENSv2's `_onRolesGranted` / `_onRolesRevoked` hooks
///      are not `virtual` in `PermissionedRegistry`, and they also skip the initializer and registration grants.
///      Every grant and revoke goes through `_grantRoles` / `_revokeRoles` (docs/checks-a.md, check 2c).
///   6. Frozen: `_getRoles` strips `ROLE_UPGRADE` and its admin bit from every account, `upgradeToAndCall` always
///      reverts, and `canUpgradeFrom` returns false, so no proxy can be upgraded into this implementation either.
contract DriveRegistry is UserRegistry {
    ////////////////////////////////////////////////////////////////////////
    // Constants
    ////////////////////////////////////////////////////////////////////////

    /// @notice Viewer. Nybble 10.
    uint256 public constant ROLE_DRIVE_READ = 1 << 40;
    /// @notice Editor. Nybble 11.
    uint256 public constant ROLE_DRIVE_WRITE = 1 << 44;
    /// @notice Manager: adds and removes members, rotates keys. Nybble 12.
    uint256 public constant ROLE_DRIVE_SHARE = 1 << 48;

    uint256 internal constant DRIVE_ROLES = ROLE_DRIVE_READ | ROLE_DRIVE_WRITE | ROLE_DRIVE_SHARE;
    /// @notice The three drive roles and their admin bits.
    uint256 public constant ALL_DRIVE_ROLES = DRIVE_ROLES | (DRIVE_ROLES << 128);

    uint256 internal constant UPGRADE_ROLES = RegistryRolesLib.ROLE_UPGRADE | RegistryRolesLib.ROLE_UPGRADE_ADMIN;

    /// @dev Everyday roles for the drive key K: create subfolders and links, manage members.
    uint256 internal constant EVERYDAY_ROLES = RegistryRolesLib.ROLE_REGISTRAR | ALL_DRIVE_ROLES;

    /// @dev Dangerous roles for the main wallet W (or for K_room, since a room has no W). They include their admin
    ///      bits, so only their holder can manage them: K can neither use nor revoke them.
    uint256 internal constant DANGEROUS_ROLES = RegistryRolesLib.ROLE_SET_SUBREGISTRY
        | RegistryRolesLib.ROLE_SET_SUBREGISTRY_ADMIN | RegistryRolesLib.ROLE_SET_PARENT
        | RegistryRolesLib.ROLE_SET_PARENT_ADMIN | RegistryRolesLib.ROLE_UNREGISTER
        | RegistryRolesLib.ROLE_UNREGISTER_ADMIN | RegistryRolesLib.ROLE_CAN_TRANSFER_ADMIN;

    /// @notice End date meaning "no end".
    uint64 public constant NO_END = type(uint64).max;

    /// @notice Intervals kept per account. Older ones are overwritten (the events keep the full record), and
    ///         `wasAllowed` then fails closed (answers false) for times only they covered. Each share uses a fresh
    ///         stealth address, so a real account sees a handful at most.
    uint256 public constant MAX_INTERVALS = 8;

    ////////////////////////////////////////////////////////////////////////
    // Types
    ////////////////////////////////////////////////////////////////////////

    /// @notice How an account holds its access. Parent (inheritance) and Group come in later implementations.
    enum Via {
        None,
        Owner,
        Direct,
        Parent,
        Group
    }

    /// @dev One stretch of time with a fixed set of drive roles. It covers [from, end), where end = endedAt if the
    ///      stretch was closed early by a revoke or a change, else until. Fits one storage slot.
    struct Interval {
        uint64 from;
        uint64 until;
        uint64 endedAt; // 0 while open; else min(until, time of the change)
        uint32 roles; // packed, see _pack
    }

    /// @notice An interval as returned by `historyOf`.
    struct IntervalView {
        uint256 roles;
        uint64 from;
        uint64 until;
        uint64 endedAt;
    }

    ////////////////////////////////////////////////////////////////////////
    // Storage (this contract is never upgraded, so plain storage is fine)
    ////////////////////////////////////////////////////////////////////////

    address private _driveOwner;
    mapping(address account => uint64 until) private _until;
    mapping(address account => uint256 total) private _intervalCount;
    mapping(address account => Interval[MAX_INTERVALS] ring) private _intervals;

    ////////////////////////////////////////////////////////////////////////
    // Events and errors
    ////////////////////////////////////////////////////////////////////////

    /// @notice An account's drive roles changed: a new interval [from, until) starts.
    event AccessGranted(address indexed account, uint256 roles, uint64 from, uint64 until);
    /// @notice An account's current interval ended (revoke, change of roles or end date, or a sweep after expiry).
    event AccessEnded(address indexed account, uint256 roles, uint64 endedAt);

    error InvalidDriveRoles(uint256 roleBitmap);
    error InvalidUntil(uint64 until);
    error OwnerAccessIsFixed();
    error GrantOutlivesGrantor(uint64 until, uint64 grantorEnd);
    error UseGrantRolesUntil();
    error DriveRolesOnlyAtRoot();
    error NotExpired(address account);
    error UpgradesDisabled();
    error LengthMismatch();

    ////////////////////////////////////////////////////////////////////////
    // Initialization
    ////////////////////////////////////////////////////////////////////////

    constructor(ILabelStore labelStore, address namer) UserRegistry(labelStore, namer) {}

    /// @notice Sets up a new folder or room. Called once, atomically, by `VerifiableFactory.deployProxy`.
    /// @param driveKey K (or K_room): everyday roles, and the folder's permanent owner.
    /// @param mainWallet W: dangerous roles. Pass address(0) for a room; K_room then holds them, since a W would link
    ///        the room to its owner. No upgrade role is granted to anyone.
    function initializeDrive(address driveKey, address mainWallet) external initializer {
        if (driveKey == address(0)) revert InvalidOwner();
        emit RegistryCreated();
        _driveOwner = driveKey;
        _until[driveKey] = NO_END;
        if (mainWallet == address(0)) {
            _grantRoles(ROOT_RESOURCE, EVERYDAY_ROLES | DANGEROUS_ROLES, driveKey, false);
        } else {
            _grantRoles(ROOT_RESOURCE, EVERYDAY_ROLES, driveKey, false);
            _grantRoles(ROOT_RESOURCE, DANGEROUS_ROLES, mainWallet, false);
        }
    }

    ////////////////////////////////////////////////////////////////////////
    // Access that ends
    ////////////////////////////////////////////////////////////////////////

    /// @notice Grants drive roles to `account` until `until` (exclusive; `NO_END` for none). The end date applies to
    ///         all of the account's drive roles, so this also renews or shortens existing access.
    /// @dev Same caller check as `grantRoles`: the caller needs the admin bit of every drive role the account will
    ///      hold afterwards, since all of them get the new end date.
    function grantRolesUntil(uint256 roleBitmap, address account, uint64 until) external returns (bool) {
        if (roleBitmap == 0 || roleBitmap & ~ALL_DRIVE_ROLES != 0) revert InvalidDriveRoles(roleBitmap);
        if (until <= block.timestamp) revert InvalidUntil(until);
        if (account == _driveOwner) revert OwnerAccessIsFixed();
        uint64 grantorEnd = _endOf(msg.sender);
        if (until > grantorEnd) revert GrantOutlivesGrantor(until, grantorEnd);

        uint256 current = _rawDriveRoles(account);
        if (current != 0 && _isExpired(account)) {
            // Expired roles never come back with a new grant.
            _revokeRoles(ROOT_RESOURCE, current, account, true);
            current = 0;
        }
        _checkCanGrantRoles(ROOT_RESOURCE, roleBitmap | current, msg.sender);

        uint64 previousUntil = _until[account];
        _until[account] = until;
        bool rolesChanged = _grantRoles(ROOT_RESOURCE, roleBitmap, account, true);
        if (!rolesChanged && until != previousUntil) {
            _onDriveChange(account, current, current); // same roles, new end date
        }
        return rolesChanged || until != previousUntil;
    }

    /// @notice Anyone may revoke an expired grant, which frees its holder slot (ENSv2 allows 15 per role).
    ///         The history stays.
    function sweep(address account) external {
        uint256 stale = _rawDriveRoles(account);
        if (stale == 0 || !_isExpired(account)) revert NotExpired(account);
        _revokeRoles(ROOT_RESOURCE, stale, account, true);
    }

    /// @inheritdoc IEnhancedAccessControl
    /// @dev Drive roles must go through `grantRolesUntil`, so every one of them has an end date.
    function grantRootRoles(uint256 roleBitmap, address account)
        public
        override(EnhancedAccessControl, IEnhancedAccessControl)
        returns (bool)
    {
        if (roleBitmap & ALL_DRIVE_ROLES != 0) revert UseGrantRolesUntil();
        return super.grantRootRoles(roleBitmap, account);
    }

    /// @inheritdoc IEnhancedAccessControl
    /// @dev Only the owner can revoke the owner's drive roles.
    function revokeRootRoles(uint256 roleBitmap, address account)
        public
        override(EnhancedAccessControl, IEnhancedAccessControl)
        returns (bool)
    {
        if (account == _driveOwner && msg.sender != account && roleBitmap & ALL_DRIVE_ROLES != 0) {
            revert OwnerAccessIsFixed();
        }
        return super.revokeRootRoles(roleBitmap, account);
    }

    ////////////////////////////////////////////////////////////////////////
    // Views
    ////////////////////////////////////////////////////////////////////////

    /// @notice K (or K_room): the account whose drive roles have no end and can't be revoked by others.
    function driveOwner() external view returns (address) {
        return _driveOwner;
    }

    /// @notice Current access of `account`: drive roles held now, since when, until when, and how.
    function accessOf(address account) external view returns (uint256 roles, uint64 from, uint64 until, Via via) {
        roles = _getRoles(ROOT_RESOURCE, account) & ALL_DRIVE_ROLES;
        if (roles == 0) return (0, 0, 0, Via.None);
        from = _intervals[account][(_intervalCount[account] - 1) % MAX_INTERVALS].from;
        until = _until[account];
        via = account == _driveOwner ? Via.Owner : Via.Direct;
    }

    /// @notice Whether `account` held all of `roleBitmap` (drive roles only) at time `t`. A plain view call that
    ///         works for any past time.
    function wasAllowed(address account, uint256 roleBitmap, uint64 t) public view returns (bool) {
        if (roleBitmap == 0 || roleBitmap & ~ALL_DRIVE_ROLES != 0) revert InvalidDriveRoles(roleBitmap);
        uint32 wanted = _pack(roleBitmap);
        uint256 n = _intervalCount[account];
        uint256 oldest = n > MAX_INTERVALS ? n - MAX_INTERVALS : 0;
        // Intervals of one account never overlap, so the first one (newest first) that covers t decides.
        for (uint256 i = n; i > oldest; --i) {
            Interval storage iv = _intervals[account][(i - 1) % MAX_INTERVALS];
            if (t < iv.from) continue;
            if (t < (iv.endedAt == 0 ? iv.until : iv.endedAt)) return iv.roles & wanted == wanted;
        }
        return false;
    }

    /// @notice Batch form of `wasAllowed` for validating many entries in one call.
    function wasAllowedMany(address[] calldata accounts, uint256 roleBitmap, uint64[] calldata times)
        external
        view
        returns (bool[] memory allowed)
    {
        if (accounts.length != times.length) revert LengthMismatch();
        allowed = new bool[](accounts.length);
        for (uint256 i; i < accounts.length; ++i) {
            allowed[i] = wasAllowed(accounts[i], roleBitmap, times[i]);
        }
    }

    /// @notice The retained intervals of `account`, oldest first.
    function historyOf(address account) external view returns (IntervalView[] memory intervals) {
        uint256 n = _intervalCount[account];
        uint256 kept = n > MAX_INTERVALS ? MAX_INTERVALS : n;
        intervals = new IntervalView[](kept);
        for (uint256 i; i < kept; ++i) {
            Interval storage iv = _intervals[account][(n - kept + i) % MAX_INTERVALS];
            intervals[i] = IntervalView(_unpack(iv.roles), iv.from, iv.until, iv.endedAt);
        }
    }

    /// @notice Total intervals ever recorded for `account` (including any overwritten ones).
    function historyLength(address account) external view returns (uint256) {
        return _intervalCount[account];
    }

    ////////////////////////////////////////////////////////////////////////
    // Upgrade freeze
    ////////////////////////////////////////////////////////////////////////

    /// @notice Folders can never be upgraded.
    function upgradeToAndCall(address, bytes memory) public payable override {
        revert UpgradesDisabled();
    }

    /// @notice No proxy may be upgraded into a DriveRegistry, so every DriveRegistry proxy was created as one.
    function canUpgradeFrom(address) external pure override returns (bool) {
        return false;
    }

    ////////////////////////////////////////////////////////////////////////
    // Internal: roles and history
    ////////////////////////////////////////////////////////////////////////

    /// @dev Every permission check (including `_authorizeUpgrade` and who may grant what) reads roles through here.
    ///      Strips the upgrade role and its admin bit from everyone; drops drive roles once their end date is reached.
    function _getRoles(uint256 resource, address account) internal view override returns (uint256 roleBitmap) {
        roleBitmap = super._getRoles(resource, account) & ~UPGRADE_ROLES;
        if (resource == ROOT_RESOURCE && roleBitmap & ALL_DRIVE_ROLES != 0 && _isExpired(account)) {
            roleBitmap &= ~ALL_DRIVE_ROLES;
        }
    }

    function _grantRoles(uint256 resource, uint256 roleBitmap, address account, bool executeCallbacks)
        internal
        override
        returns (bool changed)
    {
        if (resource != ROOT_RESOURCE) {
            if (roleBitmap & ALL_DRIVE_ROLES != 0) revert DriveRolesOnlyAtRoot();
            return super._grantRoles(resource, roleBitmap, account, executeCallbacks);
        }
        uint256 before = _rawDriveRoles(account);
        changed = super._grantRoles(resource, roleBitmap, account, executeCallbacks);
        uint256 afterChange = _rawDriveRoles(account);
        if (afterChange != before) _onDriveChange(account, before, afterChange);
    }

    function _revokeRoles(uint256 resource, uint256 roleBitmap, address account, bool executeCallbacks)
        internal
        override
        returns (bool changed)
    {
        if (resource != ROOT_RESOURCE) return super._revokeRoles(resource, roleBitmap, account, executeCallbacks);
        uint256 before = _rawDriveRoles(account);
        changed = super._revokeRoles(resource, roleBitmap, account, executeCallbacks);
        uint256 afterChange = _rawDriveRoles(account);
        if (afterChange != before) _onDriveChange(account, before, afterChange);
    }

    /// @dev Closes the account's open interval (if any) and opens a new one for `afterChange` (if non-empty and not
    ///      already past its end date).
    function _onDriveChange(address account, uint256 before, uint256 afterChange) private {
        uint64 nowTs = uint64(block.timestamp);
        uint256 n = _intervalCount[account];
        if (before != 0 && n != 0) {
            Interval storage last = _intervals[account][(n - 1) % MAX_INTERVALS];
            if (last.endedAt == 0) {
                uint64 ended = last.until < nowTs ? last.until : nowTs;
                last.endedAt = ended;
                emit AccessEnded(account, _unpack(last.roles), ended);
            }
        }
        uint64 until = _until[account];
        if (afterChange != 0 && until > nowTs) {
            _intervals[account][n % MAX_INTERVALS] = Interval(nowTs, until, 0, _pack(afterChange));
            _intervalCount[account] = n + 1;
            emit AccessGranted(account, afterChange, nowTs, until);
        }
    }

    /// @dev Drive roles in storage, before the expiry and upgrade filters.
    function _rawDriveRoles(address account) private view returns (uint256) {
        return super._getRoles(ROOT_RESOURCE, account) & ALL_DRIVE_ROLES;
    }

    /// @dev True once the end date is reached. An account with no end date recorded counts as expired (fails closed).
    function _isExpired(address account) private view returns (bool) {
        return block.timestamp >= _until[account];
    }

    /// @dev The end of `account`'s current access: its end date if it holds unexpired drive roles, else 0.
    function _endOf(address account) private view returns (uint64) {
        return _getRoles(ROOT_RESOURCE, account) & ALL_DRIVE_ROLES == 0 ? 0 : _until[account];
    }

    /// @dev Drive bits (nybbles 10–12 and 42–44) into 24 bits: regular in 0–11, admin in 12–23.
    function _pack(uint256 roles) private pure returns (uint32) {
        return uint32(((roles >> 40) & 0x111) | (((roles >> 168) & 0x111) << 12));
    }

    function _unpack(uint32 packed) private pure returns (uint256) {
        return ((uint256(packed) & 0x111) << 40) | (((uint256(packed) >> 12) & 0x111) << 168);
    }
}
