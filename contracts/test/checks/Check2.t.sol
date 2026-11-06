// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// First-hour check 2 (CLOAKROOM_PLAN.md section 17), against ensdomains/contracts-v2@48b3e2d:
//   a) a registry derived from UserRegistry compiles;
//   b) bits 40/44/48 (and their admin bits) are free and valid EAC role bits;
//   c) every grant/revoke path reaches an override we control (history must hook in there);
//   d) stripping ROLE_UPGRADE in _getRoles blocks upgradeToAndCall for every caller;
//   e) our own initializer works through VerifiableFactory.
// This is a throwaway spike. The real DriveRegistry (step A2) replaces SpikeDriveRegistry.

import {Test} from "forge-std/Test.sol";

import {UserRegistry} from "@ensv2/registry/UserRegistry.sol";
import {IRegistry} from "@ensv2/registry/interfaces/IRegistry.sol";
import {RegistryRolesLib} from "@ensv2/registry/libraries/RegistryRolesLib.sol";
import {EACBaseRolesLib} from "@ensv2/access-control/libraries/EACBaseRolesLib.sol";
import {IEnhancedAccessControl} from "@ensv2/access-control/interfaces/IEnhancedAccessControl.sol";
import {LabelStore} from "@ensv2/utils/LabelStore.sol";
import {ContractNamer} from "@ensv2/utils/ContractNamer.sol";
import {ILabelStore} from "@ensv2/utils/interfaces/ILabelStore.sol";
import {VerifiableFactory} from "@ensdomains/verifiable-factory/VerifiableFactory.sol";
import {IUUPSProxy} from "@ensdomains/verifiable-factory/IUUPSProxy.sol";

uint256 constant ROLE_DRIVE_READ = 1 << 40;
uint256 constant ROLE_DRIVE_WRITE = 1 << 44;
uint256 constant ROLE_DRIVE_SHARE = 1 << 48;
uint256 constant DRIVE_BITS = ROLE_DRIVE_READ | ROLE_DRIVE_WRITE | ROLE_DRIVE_SHARE;
uint256 constant DRIVE_ADMIN_BITS = DRIVE_BITS << 128;
uint256 constant UPGRADE_MASK = RegistryRolesLib.ROLE_UPGRADE | RegistryRolesLib.ROLE_UPGRADE_ADMIN;

contract SpikeDriveRegistry is UserRegistry {
    /// Counters only prove that each path reaches the override. The real contract appends history here.
    uint256 public grantCalls;
    uint256 public revokeCalls;

    constructor(ILabelStore labelStore, address namer) UserRegistry(labelStore, namer) {}

    /// Our own initializer, alongside UserRegistry.initialize. The test passes ROLE_UPGRADE in on purpose
    /// (worst case): the freeze must hold even if the upgrade role somehow sits in storage.
    function initializeSpike(address root, uint256 roleBitmap) external initializer {
        _grantRoles(ROOT_RESOURCE, roleBitmap, root, false);
    }

    function _getRoles(uint256 resource, address account) internal view override returns (uint256) {
        return super._getRoles(resource, account) & ~UPGRADE_MASK;
    }

    function _grantRoles(uint256 resource, uint256 roleBitmap, address account, bool executeCallbacks)
        internal
        override
        returns (bool changed)
    {
        changed = super._grantRoles(resource, roleBitmap, account, executeCallbacks);
        if (changed) ++grantCalls;
    }

    function _revokeRoles(uint256 resource, uint256 roleBitmap, address account, bool executeCallbacks)
        internal
        override
        returns (bool changed)
    {
        changed = super._revokeRoles(resource, roleBitmap, account, executeCallbacks);
        if (changed) ++revokeCalls;
    }
}

contract Check2Test is Test {
    VerifiableFactory internal factory;
    LabelStore internal labelStore;
    ContractNamer internal namer;
    SpikeDriveRegistry internal spikeImpl;

    address internal K = makeAddr("K");
    address internal S = makeAddr("S");

    function setUp() public {
        namer = new ContractNamer();
        labelStore = new LabelStore(namer);
        factory = new VerifiableFactory();
        spikeImpl = new SpikeDriveRegistry(labelStore, address(namer));
    }

    function _deploySpike(uint256 rootRoles) internal returns (SpikeDriveRegistry r) {
        return _deploySpikeFor(K, rootRoles);
    }

    function _deploySpikeFor(address root, uint256 rootRoles) internal returns (SpikeDriveRegistry r) {
        vm.prank(K);
        r = SpikeDriveRegistry(
            factory.deployProxy(
                address(spikeImpl), 1, abi.encodeCall(SpikeDriveRegistry.initializeSpike, (root, rootRoles))
            )
        );
    }

    // ---------- b) bits ----------

    function test_driveBitsAreFreeAndValid() public {
        uint256 stock = RegistryRolesLib.ROLE_REGISTRAR | RegistryRolesLib.ROLE_REGISTER_RESERVED
            | RegistryRolesLib.ROLE_SET_PARENT | RegistryRolesLib.ROLE_UNREGISTER | RegistryRolesLib.ROLE_RENEW
            | RegistryRolesLib.ROLE_SET_SUBREGISTRY | RegistryRolesLib.ROLE_SET_RESOLVER
            | RegistryRolesLib.ROLE_WAS_RESERVED | RegistryRolesLib.ROLE_SET_URI | RegistryRolesLib.ROLE_CAN_NAME
            | RegistryRolesLib.ROLE_UPGRADE;
        stock |= stock << 128; // admin counterparts
        stock |= RegistryRolesLib.ROLE_CAN_TRANSFER_ADMIN;
        assertEq(stock & (DRIVE_BITS | DRIVE_ADMIN_BITS), 0, "drive bits collide with a stock ENSv2 role");
        assertEq((DRIVE_BITS | DRIVE_ADMIN_BITS) & ~EACBaseRolesLib.ALL_ROLES, 0, "not one-per-nybble role bits");

        // And the live contract accepts them: K (drive admin) grants all three to S.
        SpikeDriveRegistry r = _deploySpike(DRIVE_ADMIN_BITS);
        vm.prank(K);
        r.grantRootRoles(DRIVE_BITS, S);
        assertTrue(r.hasRootRoles(DRIVE_BITS, S));
        assertFalse(r.hasRootRoles(RegistryRolesLib.ROLE_REGISTRAR, S), "drive grant leaked a registry role");
    }

    // ---------- e) initializer through VerifiableFactory ----------

    function test_initializerWorksThroughVerifiableFactory() public {
        SpikeDriveRegistry r = _deploySpike(RegistryRolesLib.ROLE_REGISTRAR | DRIVE_ADMIN_BITS);
        assertEq(factory.verifyContract(address(r)), address(spikeImpl), "factory does not verify the proxy");
        assertTrue(r.hasRootRoles(RegistryRolesLib.ROLE_REGISTRAR | DRIVE_ADMIN_BITS, K));
        // Neither initializer can run a second time.
        vm.expectRevert();
        r.initializeSpike(S, DRIVE_ADMIN_BITS);
        vm.expectRevert();
        r.initialize(S, DRIVE_ADMIN_BITS);
        assertFalse(r.hasRootRoles(DRIVE_ADMIN_BITS, S));
    }

    // ---------- c) every grant/revoke path reaches our override ----------

    function test_allGrantAndRevokePathsReachOverride() public {
        SpikeDriveRegistry r = _deploySpike(RegistryRolesLib.ROLE_REGISTRAR | DRIVE_ADMIN_BITS);
        // initializer grant runs with executeCallbacks=false, so _onRolesGranted would never see it
        assertEq(r.grantCalls(), 1, "initializer grant missed");

        vm.startPrank(K);
        r.grantRootRoles(ROLE_DRIVE_READ, S);
        assertEq(r.grantCalls(), 2, "grantRootRoles missed");

        // name registration grants token roles with executeCallbacks=false too
        r.register(
            "f-test", S, IRegistry(address(0)), address(0), RegistryRolesLib.ROLE_SET_RESOLVER,
            uint64(block.timestamp + 1 days)
        );
        assertEq(r.grantCalls(), 3, "register grant missed");

        r.revokeRootRoles(ROLE_DRIVE_READ, S);
        assertEq(r.revokeCalls(), 1, "revokeRootRoles missed");
        vm.stopPrank();

        // a no-op grant (already held) must not count as a change
        vm.prank(K);
        r.grantRootRoles(ROLE_DRIVE_WRITE, S);
        vm.prank(K);
        r.grantRootRoles(ROLE_DRIVE_WRITE, S);
        assertEq(r.grantCalls(), 4, "repeated grant counted twice");
    }

    // ---------- d) upgrade freeze ----------

    /// Control: the same setup on a stock UserRegistry DOES upgrade. Without this, a green freeze test
    /// could just mean the upgrade call was broken for unrelated reasons.
    function test_control_stockUserRegistryCanUpgrade() public {
        UserRegistry stockImpl = new UserRegistry(labelStore, address(namer));
        UserRegistry stockImpl2 = new UserRegistry(labelStore, address(namer));
        vm.prank(K);
        UserRegistry r = UserRegistry(
            factory.deployProxy(address(stockImpl), 2, abi.encodeCall(UserRegistry.initialize, (K, UPGRADE_MASK)))
        );
        vm.prank(K);
        r.upgradeToAndCall(address(stockImpl2), "");
        (, address impl) = IUUPSProxy(address(r)).getVerifiableProxyData();
        assertEq(impl, address(stockImpl2), "control: stock upgrade did not happen");
    }

    function test_upgradeRevertsForRootHolderEvenWithUpgradeRoleInStorage() public {
        SpikeDriveRegistry r = _deploySpike(type(uint256).max & EACBaseRolesLib.ALL_ROLES); // every role, incl. upgrade
        SpikeDriveRegistry impl2 = new SpikeDriveRegistry(labelStore, address(namer));

        assertFalse(r.hasRootRoles(RegistryRolesLib.ROLE_UPGRADE, K));
        assertEq(r.roles(0, K) & UPGRADE_MASK, 0, "roles() exposes upgrade bits");

        vm.expectRevert(
            abi.encodeWithSelector(
                IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector, 0, RegistryRolesLib.ROLE_UPGRADE, K
            )
        );
        vm.prank(K);
        r.upgradeToAndCall(address(impl2), "");

        // K can't hand the upgrade role to anyone either (its admin bit is stripped too)
        vm.expectRevert();
        vm.prank(K);
        r.grantRootRoles(RegistryRolesLib.ROLE_UPGRADE, S);

        (, address impl) = IUUPSProxy(address(r)).getVerifiableProxyData();
        assertEq(impl, address(spikeImpl), "implementation changed");
    }

    /// The fuzzed caller itself holds every role in storage, upgrade included, so this can only pass
    /// because of the strip in _getRoles (a random caller with no roles would revert regardless).
    function testFuzz_upgradeRevertsEvenForHolderOfEveryRole(address holder) public {
        assumeNotZeroAddress(holder);
        assumeNotForgeAddress(holder);
        SpikeDriveRegistry r = _deploySpikeFor(holder, type(uint256).max & EACBaseRolesLib.ALL_ROLES);
        SpikeDriveRegistry impl2 = new SpikeDriveRegistry(labelStore, address(namer));
        vm.expectRevert(
            abi.encodeWithSelector(
                IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector, 0, RegistryRolesLib.ROLE_UPGRADE, holder
            )
        );
        vm.prank(holder);
        r.upgradeToAndCall(address(impl2), "");
    }
}
