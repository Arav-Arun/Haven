// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";

import {RegistryRolesLib} from "@ensv2/registry/libraries/RegistryRolesLib.sol";
import {IUUPSProxy} from "@ensdomains/verifiable-factory/IUUPSProxy.sol";

import {DriveRegistry} from "../src/DriveRegistry.sol";
import {DriveFixture} from "./utils/DriveFixture.sol";

/// @dev Drives random sequences of grants, renewals, revokes, sweeps and time jumps, by the owner and by a manager.
///      After every step it records what the LIVE permission check said at that moment. The history must later
///      agree with every one of those observations. That's an independent check: it doesn't re-implement the
///      contract's interval logic.
contract DriveHandler is Test {
    uint256 internal constant READ = 1 << 40;
    uint256 internal constant WRITE = 1 << 44;
    uint256 internal constant SHARE = 1 << 48;
    uint256 internal constant ALL_DRIVE = (READ | WRITE | SHARE) | ((READ | WRITE | SHARE) << 128);

    DriveRegistry public immutable reg;
    address public immutable owner;
    address public immutable manager;
    uint64 public immutable managerEnd;
    address[] internal _members;

    struct Observation {
        address account;
        uint256 role;
        uint64 t;
        bool allowed;
    }

    bytes32[] internal _keys;
    mapping(bytes32 => Observation) internal _obs;

    uint256 public calls;
    uint256 public unexpectedReverts;
    uint256 public sweepsDone;
    uint256 public attacks;
    /// Count of broken properties: a grant or revoke changing live roles by anything other than exactly the roles
    /// it named, or an attack that didn't revert.
    uint256 public violations;

    constructor(DriveRegistry reg_, address owner_, address manager_, uint64 managerEnd_, address[] memory members_) {
        reg = reg_;
        owner = owner_;
        manager = manager_;
        managerEnd = managerEnd_;
        _members = members_;
        _observe();
    }

    // ---------------------------------------------------------------- actions

    function grant(uint256 memberSeed, uint256 roleSeed, uint256 untilSeed, bool byManager) external {
        address a = _members[memberSeed % _members.length];
        if (_historyNearlyFull(a)) return; // keep every observation inside the 8-interval window
        uint64 nowTs = uint64(block.timestamp);
        bool useManager = byManager && managerEnd > nowTs;
        address by = useManager ? manager : owner;
        uint64 maxUntil = useManager ? managerEnd : nowTs + 3 days;
        uint64 until = uint64(bound(untilSeed, nowTs + 1, maxUntil));
        uint256 roles = [READ, READ | WRITE, ALL_DRIVE][roleSeed % 3];

        uint256 liveBefore = _live(a);
        ++calls;
        vm.prank(by);
        try reg.grantRolesUntil(roles, a, until) {
            // Exactly what was live plus what was granted: expired roles must not come back.
            if (_live(a) != liveBefore | roles) ++violations;
        } catch {
            ++unexpectedReverts;
        }
        _observe();
    }

    function revoke(uint256 memberSeed, uint256 roleSeed, bool byManager) external {
        address a = _members[memberSeed % _members.length];
        if (_historyNearlyFull(a)) return;
        bool useManager = byManager && managerEnd > block.timestamp;
        uint256 bits = [READ, WRITE, SHARE, READ | WRITE, ALL_DRIVE][roleSeed % 5];

        uint256 liveBefore = _live(a);
        ++calls;
        vm.prank(useManager ? manager : owner);
        try reg.revokeRootRoles(bits, a) {
            if (_live(a) != liveBefore & ~bits) ++violations;
        } catch {
            ++unexpectedReverts;
        }
        _observe();
    }

    /// Moves that must always revert. If one succeeds, that's a violation (and the owner invariant may also fail).
    function attack(uint256 kindSeed, uint256 memberSeed, uint256 untilSeed) external {
        address a = _members[memberSeed % _members.length];
        uint64 nowTs = uint64(block.timestamp);
        uint256 kind = kindSeed % 5;
        address by;
        bytes memory data;
        if (kind == 0) {
            // a manager revokes the owner's drive roles
            (by, data) = (manager, abi.encodeCall(reg.revokeRootRoles, (ALL_DRIVE, owner)));
        } else if (kind == 1) {
            // a manager time-limits the owner
            (by, data) = (manager, abi.encodeCall(reg.grantRolesUntil, (READ, owner, nowTs + 1 hours)));
        } else if (kind == 2) {
            // a manager grants beyond its own end
            uint64 until = uint64(bound(untilSeed, uint256(managerEnd) + 1, uint256(managerEnd) + 365 days));
            (by, data) = (manager, abi.encodeCall(reg.grantRolesUntil, (READ, a, until)));
        } else if (kind == 3) {
            // an outsider grants
            (by, data) = (address(0xBAD), abi.encodeCall(reg.grantRolesUntil, (READ, a, nowTs + 1 hours)));
        } else {
            // a member that isn't a manager grants (if it is one right now, skip)
            if (reg.hasRootRoles(READ << 128, a)) return;
            (by, data) = (a, abi.encodeCall(reg.grantRolesUntil, (READ, _members[(memberSeed + 1) % _members.length], nowTs + 1)));
        }
        ++attacks;
        vm.prank(by);
        (bool ok,) = address(reg).call(data);
        if (ok) ++violations;
        _observe();
    }

    /// Sweeping a non-expired account reverts by design, so it isn't counted as unexpected.
    function sweep(uint256 memberSeed) external {
        address a = _members[memberSeed % _members.length];
        try reg.sweep(a) {
            ++sweepsDone;
        } catch {}
        _observe();
    }

    function warp(uint256 secondsSeed) external {
        vm.warp(block.timestamp + bound(secondsSeed, 1, 2 days));
        _observe();
    }

    // ---------------------------------------------------------------- observations

    function _observe() internal {
        uint64 nowTs = uint64(block.timestamp);
        for (uint256 i; i <= _members.length; ++i) {
            address a = i < _members.length ? _members[i] : manager;
            for (uint256 n = 10; n <= 12; ++n) {
                uint256 role = 1 << (n * 4);
                bytes32 key = keccak256(abi.encode(a, role, nowTs));
                if (_obs[key].t == 0) _keys.push(key);
                _obs[key] = Observation(a, role, nowTs, reg.hasRootRoles(role, a)); // latest at this second wins
            }
        }
    }

    function _live(address a) internal view returns (uint256) {
        return reg.roles(0, a) & ALL_DRIVE;
    }

    function _historyNearlyFull(address a) internal view returns (bool) {
        return reg.historyLength(a) >= reg.MAX_INTERVALS() - 1;
    }

    function observationCount() external view returns (uint256) {
        return _keys.length;
    }

    function observation(uint256 i) external view returns (Observation memory) {
        return _obs[_keys[i]];
    }

    function members() external view returns (address[] memory) {
        return _members;
    }
}

contract DriveRegistryInvariantTest is DriveFixture {
    DriveRegistry internal reg;
    DriveHandler internal handler;
    address internal M = makeAddr("manager");

    function setUp() public override {
        super.setUp();
        reg = _deployDrive(K, W);
        uint64 managerEnd = T0 + 30 days;
        vm.prank(K);
        reg.grantRolesUntil(MANAGER, M, managerEnd);

        address[] memory ms = new address[](4);
        for (uint256 i; i < 4; ++i) {
            ms[i] = makeAddr(string.concat("member", vm.toString(i)));
        }
        handler = new DriveHandler(reg, K, M, managerEnd, ms);

        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = DriveHandler.grant.selector;
        selectors[1] = DriveHandler.revoke.selector;
        selectors[2] = DriveHandler.sweep.selector;
        selectors[3] = DriveHandler.warp.selector;
        selectors[4] = DriveHandler.attack.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function _actors() internal view returns (address[] memory all) {
        address[] memory ms = handler.members();
        all = new address[](ms.length + 3);
        for (uint256 i; i < ms.length; ++i) {
            all[i] = ms[i];
        }
        all[ms.length] = M;
        all[ms.length + 1] = K;
        all[ms.length + 2] = W;
    }

    /// History at the current time equals the live permission check.
    function invariant_historyNowEqualsLiveCheck() public view {
        address[] memory all = _actors();
        for (uint256 i; i < all.length; ++i) {
            for (uint256 n = 10; n <= 12; ++n) {
                uint256 role = 1 << (n * 4);
                assertEq(reg.wasAllowed(all[i], role, _now()), reg.hasRootRoles(role, all[i]), "history != live");
                assertEq(
                    reg.wasAllowed(all[i], role << 128, _now()), reg.hasRootRoles(role << 128, all[i]), "admin bits"
                );
            }
        }
    }

    /// The owner keeps its everyday roles whatever members and managers do.
    function invariant_ownerKeepsEverydayRoles() public view {
        assertTrue(reg.hasRootRoles(RegistryRolesLib.ROLE_REGISTRAR | ALL_DRIVE, K));
        (,, uint64 until,) = reg.accessOf(K);
        assertEq(until, NO_END);
    }

    /// Nobody ever holds an upgrade role, and the implementation never changes.
    function invariant_upgradeImpossible() public view {
        address[] memory all = _actors();
        for (uint256 i; i < all.length; ++i) {
            assertEq(reg.roles(0, all[i]) & UPGRADE, 0);
        }
        (, address current) = IUUPSProxy(address(reg)).getVerifiableProxyData();
        assertEq(current, address(impl));
    }

    /// Every past live observation agrees with the history. This covers "never allowed after min(until, endedAt)":
    /// observations taken after an end or a revoke saw false, and the history must agree.
    function afterInvariant() external view {
        uint256 n = handler.observationCount();
        for (uint256 i; i < n; ++i) {
            DriveHandler.Observation memory o = handler.observation(i);
            assertEq(reg.wasAllowed(o.account, o.role, o.t), o.allowed, "history disagrees with a past live check");
        }
        // The handler only makes calls that should succeed; a high revert rate would mean the run proved little.
        assertEq(handler.unexpectedReverts(), 0, "handler hit unexpected reverts");
        assertEq(handler.violations(), 0, "a grant/revoke changed the wrong roles, or an attack succeeded");
    }
}
