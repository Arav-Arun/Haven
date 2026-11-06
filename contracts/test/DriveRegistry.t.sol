// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {UserRegistry} from "@ensv2/registry/UserRegistry.sol";
import {IRegistry} from "@ensv2/registry/interfaces/IRegistry.sol";
import {RegistryRolesLib} from "@ensv2/registry/libraries/RegistryRolesLib.sol";
import {EACBaseRolesLib} from "@ensv2/access-control/libraries/EACBaseRolesLib.sol";
import {IEnhancedAccessControl} from "@ensv2/access-control/interfaces/IEnhancedAccessControl.sol";
import {InvalidOwner} from "@ensv2/CommonErrors.sol";
import {IUUPSProxy} from "@ensdomains/verifiable-factory/IUUPSProxy.sol";

import {DriveRegistry} from "../src/DriveRegistry.sol";
import {DriveFixture} from "./utils/DriveFixture.sol";

contract DriveRegistryTest is DriveFixture {
    DriveRegistry internal reg;

    address internal S1 = makeAddr("S1");
    address internal S2 = makeAddr("S2");
    address internal M = makeAddr("manager");
    address internal X = makeAddr("outsider");

    function setUp() public override {
        super.setUp();
        reg = _deployDrive(K, W);
    }

    function _grant(address by, uint256 roles, address to, uint64 until) internal {
        vm.prank(by);
        reg.grantRolesUntil(roles, to, until);
    }

    function _readCount(DriveRegistry r) internal view returns (uint256) {
        (uint256 counts,) = r.getAssigneeCount(0, READ);
        return (counts >> 40) & 0xf;
    }

    // =====================================================================
    // Initialization and the power split
    // =====================================================================

    function test_init_givesEverydayRolesToK_andDangerousRolesToW() public view {
        assertEq(reg.driveOwner(), K);
        assertTrue(reg.hasRootRoles(RegistryRolesLib.ROLE_REGISTRAR | ALL_DRIVE, K), "K lacks everyday roles");
        assertEq(reg.roles(0, K) & DANGEROUS, 0, "K holds a dangerous role");
        assertTrue(reg.hasRootRoles(DANGEROUS, W), "W lacks dangerous roles");
        assertEq(reg.roles(0, W) & ALL_DRIVE, 0, "W holds a drive role");
        assertEq(reg.roles(0, K) & UPGRADE, 0);
        assertEq(reg.roles(0, W) & UPGRADE, 0);

        (uint256 roles, uint64 from, uint64 until, DriveRegistry.Via via) = reg.accessOf(K);
        assertEq(roles, ALL_DRIVE);
        assertEq(from, T0);
        assertEq(until, NO_END);
        assertEq(uint8(via), uint8(DriveRegistry.Via.Owner));
        assertEq(factory.verifyContract(address(reg)), address(impl));
    }

    function test_init_roomKeyHoldsEverything() public {
        address kRoom = makeAddr("K_room");
        DriveRegistry room = _deployDrive(kRoom, address(0));
        assertTrue(room.hasRootRoles(RegistryRolesLib.ROLE_REGISTRAR | ALL_DRIVE | DANGEROUS, kRoom));
        assertEq(room.roles(0, kRoom) & UPGRADE, 0);
    }

    function test_init_rejectsZeroKey_andRunsOnce() public {
        vm.prank(K);
        vm.expectRevert(InvalidOwner.selector);
        factory.deployProxy(address(impl), 999, abi.encodeCall(DriveRegistry.initializeDrive, (address(0), W)));

        vm.expectRevert();
        reg.initializeDrive(X, X);
        vm.expectRevert();
        reg.initialize(X, ALL_DRIVE);
        assertEq(reg.driveOwner(), K);
        assertFalse(reg.hasRootRoles(READ, X));
    }

    /// Section 20 "Power split": K can't set a subregistry, set the parent, unregister or transfer; W can.
    function test_powerSplit_kCannotUseOrTouchDangerousRoles() public {
        vm.startPrank(K);
        uint256 id = reg.register("f-a", K, IRegistry(address(0)), address(0), 0, T0 + 365 days);

        vm.expectPartialRevert(IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector);
        reg.setSubregistry(id, IRegistry(address(0xBEEF)));
        vm.expectPartialRevert(IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector);
        reg.setParent(IRegistry(address(0xBEEF)), "x");
        vm.expectPartialRevert(IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector);
        reg.unregister(id);
        vm.expectRevert();
        reg.safeTransferFrom(K, X, id, 1, "");

        // nor revoke W's roles, nor grant itself one
        vm.expectPartialRevert(IEnhancedAccessControl.EACCannotRevokeRoles.selector);
        reg.revokeRootRoles(RegistryRolesLib.ROLE_SET_PARENT, W);
        vm.expectPartialRevert(IEnhancedAccessControl.EACCannotGrantRoles.selector);
        reg.grantRootRoles(RegistryRolesLib.ROLE_SET_PARENT, K);
        vm.stopPrank();

        assertEq(reg.ownerOf(reg.getTokenId(id)), K, "transfer happened");
        vm.startPrank(W);
        reg.setSubregistry(id, IRegistry(address(0xBEEF)));
        reg.setParent(IRegistry(address(0xBEEF)), "x");
        vm.stopPrank();
        assertEq(address(reg.getSubregistry("f-a")), address(0xBEEF));
    }

    // =====================================================================
    // Access that ends; history before, during and after
    // =====================================================================

    function test_viewerAccessEndsExactlyAtUntil_andHistoryStaysReadable() public {
        uint64 until = T0 + 1 hours;
        vm.expectEmit(address(reg));
        emit DriveRegistry.AccessGranted(S1, VIEWER, T0, until);
        _grant(K, VIEWER, S1, until);

        assertTrue(reg.hasRootRoles(READ, S1));
        assertFalse(reg.hasRootRoles(WRITE, S1));
        (uint256 roles, uint64 from, uint64 u, DriveRegistry.Via via) = reg.accessOf(S1);
        assertEq(roles, VIEWER);
        assertEq(from, T0);
        assertEq(u, until);
        assertEq(uint8(via), uint8(DriveRegistry.Via.Direct));

        vm.warp(until - 1);
        assertTrue(reg.hasRootRoles(READ, S1));
        assertTrue(reg.wasAllowed(S1, READ, _now()));

        vm.warp(until);
        assertFalse(reg.hasRootRoles(READ, S1), "still allowed at until");
        assertFalse(reg.wasAllowed(S1, READ, until));
        (roles,,,) = reg.accessOf(S1);
        assertEq(roles, 0);

        // the history stays readable after the end, with no archive node
        assertFalse(reg.wasAllowed(S1, READ, T0 - 1), "allowed before the grant");
        assertTrue(reg.wasAllowed(S1, READ, T0));
        assertTrue(reg.wasAllowed(S1, READ, until - 1));
        assertFalse(reg.wasAllowed(S1, WRITE, T0), "viewer allowed to write");
        DriveRegistry.IntervalView[] memory h = reg.historyOf(S1);
        assertEq(h.length, 1);
        assertEq(h[0].roles, VIEWER);
        assertEq(h[0].from, T0);
        assertEq(h[0].until, until);
        assertEq(h[0].endedAt, 0);
    }

    function test_revokeMidway_endsAccessAtTheRevokeTime() public {
        _grant(K, EDITOR, S1, T0 + 1 days);
        vm.warp(T0 + 1 hours);
        vm.expectEmit(address(reg));
        emit DriveRegistry.AccessEnded(S1, EDITOR, T0 + 1 hours);
        vm.prank(K);
        reg.revokeRootRoles(EDITOR, S1);

        assertFalse(reg.hasRootRoles(READ, S1));
        assertTrue(reg.wasAllowed(S1, EDITOR, T0 + 1 hours - 1));
        assertFalse(reg.wasAllowed(S1, READ, T0 + 1 hours));
        assertFalse(reg.wasAllowed(S1, READ, T0 + 12 hours), "allowed after revoke, before the old end date");
        assertEq(reg.historyOf(S1)[0].endedAt, T0 + 1 hours);
    }

    function test_partialRevoke_demotesEditorToViewer() public {
        _grant(K, EDITOR, S1, T0 + 1 days);
        vm.warp(T0 + 1 hours);
        vm.prank(K);
        reg.revokeRootRoles(WRITE, S1);

        assertTrue(reg.wasAllowed(S1, WRITE, T0 + 1 hours - 1));
        assertFalse(reg.wasAllowed(S1, WRITE, T0 + 1 hours));
        assertTrue(reg.wasAllowed(S1, READ, T0 + 1 hours));
        assertFalse(reg.wasAllowed(S1, READ, T0 + 1 days), "demoted viewer outlived the end date");
        DriveRegistry.IntervalView[] memory h = reg.historyOf(S1);
        assertEq(h.length, 2);
        assertEq(h[1].roles, VIEWER);
        assertEq(h[1].until, T0 + 1 days);
    }

    function test_renewAndShorten() public {
        _grant(K, VIEWER, S1, T0 + 1 hours);
        vm.warp(T0 + 30 minutes);
        _grant(K, VIEWER, S1, T0 + 2 hours); // renew
        assertTrue(reg.wasAllowed(S1, READ, T0 + 90 minutes));
        assertTrue(reg.wasAllowed(S1, READ, T0 + 30 minutes - 1), "gap at renewal");
        assertEq(reg.historyOf(S1).length, 2);

        vm.warp(T0 + 40 minutes);
        _grant(K, VIEWER, S1, T0 + 50 minutes); // shorten
        vm.warp(T0 + 50 minutes);
        assertFalse(reg.hasRootRoles(READ, S1));
        assertFalse(reg.wasAllowed(S1, READ, T0 + 90 minutes), "shortened access still covers the old end");
    }

    function test_expiredRolesNeverComeBack() public {
        _grant(K, EDITOR, S1, T0 + 1 hours);
        vm.warp(T0 + 2 hours);
        _grant(K, VIEWER, S1, T0 + 3 hours);
        assertTrue(reg.hasRootRoles(READ, S1));
        assertFalse(reg.hasRootRoles(WRITE, S1), "expired WRITE revived by a new viewer grant");
        DriveRegistry.IntervalView[] memory h = reg.historyOf(S1);
        assertEq(h.length, 2);
        assertEq(h[0].endedAt, T0 + 1 hours, "old interval should close at its own end date");
        assertFalse(reg.wasAllowed(S1, READ, T0 + 90 minutes), "allowed in the gap");
    }

    // =====================================================================
    // sweep and the 15-holder cap
    // =====================================================================

    function test_sweep_onlyAfterExpiry_byAnyone_freesSlot_keepsHistory() public {
        _grant(K, VIEWER, S1, T0 + 1 hours);
        assertEq(_readCount(reg), 2); // K + S1

        vm.expectRevert(abi.encodeWithSelector(DriveRegistry.NotExpired.selector, S1));
        reg.sweep(S1);
        vm.expectRevert(abi.encodeWithSelector(DriveRegistry.NotExpired.selector, K));
        reg.sweep(K);

        vm.warp(T0 + 1 hours);
        vm.prank(X);
        reg.sweep(S1);
        assertEq(_readCount(reg), 1, "slot not freed");
        assertTrue(reg.wasAllowed(S1, READ, T0), "history lost");
        assertEq(reg.historyOf(S1)[0].endedAt, T0 + 1 hours);

        vm.expectRevert(abi.encodeWithSelector(DriveRegistry.NotExpired.selector, S1));
        reg.sweep(S1);
    }

    function test_holderCap_isFifteen_andSweepMakesRoom() public {
        for (uint256 i = 1; i <= 14; ++i) {
            _grant(K, VIEWER, address(uint160(0x1000 + i)), T0 + 1 hours);
        }
        assertEq(_readCount(reg), 15);
        vm.prank(K);
        vm.expectPartialRevert(IEnhancedAccessControl.EACMaxAssignees.selector);
        reg.grantRolesUntil(VIEWER, S1, T0 + 1 hours);

        vm.warp(T0 + 1 hours);
        reg.sweep(address(uint160(0x1001)));
        _grant(K, VIEWER, S1, T0 + 2 hours);
        assertTrue(reg.hasRootRoles(READ, S1));
    }

    // =====================================================================
    // Who may grant what
    // =====================================================================

    function test_ownerProtection_managerCannotRevokeOrTimeLimitOwner() public {
        _grant(K, MANAGER, M, T0 + 1 days);
        vm.startPrank(M);
        vm.expectRevert(DriveRegistry.OwnerAccessIsFixed.selector);
        reg.revokeRootRoles(READ, K);
        vm.expectRevert(DriveRegistry.OwnerAccessIsFixed.selector);
        reg.revokeRootRoles(READ << 128, K);
        vm.expectRevert(DriveRegistry.OwnerAccessIsFixed.selector);
        reg.grantRolesUntil(READ, K, T0 + 1 hours);
        vm.stopPrank();
        assertTrue(reg.hasRootRoles(ALL_DRIVE, K));

        // the manager can manage everyone else
        _grant(M, VIEWER, S1, T0 + 1 hours);
        vm.prank(M);
        reg.revokeRootRoles(VIEWER, S1);
        assertFalse(reg.hasRootRoles(READ, S1));
    }

    function test_grantNeverOutlivesGrantor() public {
        _grant(K, MANAGER, M, T0 + 1 days);
        vm.startPrank(M);
        vm.expectRevert(
            abi.encodeWithSelector(DriveRegistry.GrantOutlivesGrantor.selector, T0 + 2 days, T0 + 1 days)
        );
        reg.grantRolesUntil(VIEWER, S1, T0 + 2 days);
        vm.expectRevert(
            abi.encodeWithSelector(DriveRegistry.GrantOutlivesGrantor.selector, T0 + 2 days, T0 + 1 days)
        );
        reg.grantRolesUntil(READ, M, T0 + 2 days); // can't extend itself
        reg.grantRolesUntil(VIEWER, S1, T0 + 1 days); // up to its own end is fine
        vm.stopPrank();

        vm.warp(T0 + 1 days);
        vm.expectRevert(abi.encodeWithSelector(DriveRegistry.GrantOutlivesGrantor.selector, T0 + 2 days, 0));
        vm.prank(M);
        reg.grantRolesUntil(VIEWER, S2, T0 + 2 days);
    }

    function test_callerMustControlEveryRoleTheAccountWillHold() public {
        address E = makeAddr("editor");
        address PM = makeAddr("viewer-admin");
        _grant(K, EDITOR, E, T0 + 1 days);
        _grant(K, READ | (READ << 128), PM, T0 + 1 days);

        vm.prank(E);
        vm.expectPartialRevert(IEnhancedAccessControl.EACCannotGrantRoles.selector);
        reg.grantRolesUntil(VIEWER, S1, T0 + 1 hours); // editors can't share

        _grant(PM, VIEWER, S1, T0 + 1 hours); // viewer-admin can add viewers
        vm.startPrank(PM);
        vm.expectPartialRevert(IEnhancedAccessControl.EACCannotGrantRoles.selector);
        reg.grantRolesUntil(WRITE, S2, T0 + 1 hours);
        // nor change the end date of someone holding WRITE, which it doesn't control
        vm.expectPartialRevert(IEnhancedAccessControl.EACCannotGrantRoles.selector);
        reg.grantRolesUntil(READ, E, T0 + 1 hours);
        vm.stopPrank();
        (,, uint64 eUntil,) = reg.accessOf(E);
        assertEq(eUntil, T0 + 1 days);
    }

    function test_driveRolesOnlyThroughGrantRolesUntil_andOnlyAtRoot() public {
        vm.startPrank(K);
        vm.expectRevert(DriveRegistry.UseGrantRolesUntil.selector);
        reg.grantRootRoles(READ, S1);
        vm.expectRevert(DriveRegistry.DriveRolesOnlyAtRoot.selector);
        reg.register("f-b", S1, IRegistry(address(0)), address(0), READ, T0 + 1 days);
        uint256 id = reg.register("f-c", K, IRegistry(address(0)), address(0), 0, T0 + 1 days);
        vm.expectRevert(DriveRegistry.DriveRolesOnlyAtRoot.selector);
        reg.grantRoles(id, READ, S1);
        vm.stopPrank();

        // non-drive root roles still work the stock way
        vm.prank(W);
        reg.grantRootRoles(RegistryRolesLib.ROLE_SET_PARENT, X);
        assertTrue(reg.hasRootRoles(RegistryRolesLib.ROLE_SET_PARENT, X));
    }

    function test_inputValidation() public {
        vm.startPrank(K);
        vm.expectRevert(abi.encodeWithSelector(DriveRegistry.InvalidDriveRoles.selector, 0));
        reg.grantRolesUntil(0, S1, T0 + 1);
        vm.expectRevert(
            abi.encodeWithSelector(DriveRegistry.InvalidDriveRoles.selector, RegistryRolesLib.ROLE_REGISTRAR)
        );
        reg.grantRolesUntil(RegistryRolesLib.ROLE_REGISTRAR, S1, T0 + 1);
        vm.expectRevert(abi.encodeWithSelector(DriveRegistry.InvalidUntil.selector, T0));
        reg.grantRolesUntil(READ, S1, T0);
        vm.expectRevert(DriveRegistry.OwnerAccessIsFixed.selector);
        reg.grantRolesUntil(READ, K, T0 + 1);
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(DriveRegistry.InvalidDriveRoles.selector, 0));
        reg.wasAllowed(S1, 0, T0);
        address[] memory accounts = new address[](2);
        uint64[] memory times = new uint64[](1);
        vm.expectRevert(DriveRegistry.LengthMismatch.selector);
        reg.wasAllowedMany(accounts, READ, times);
    }

    function test_wasAllowedMany_matchesSingleCalls() public {
        _grant(K, EDITOR, S1, T0 + 1 hours);
        _grant(K, VIEWER, S2, T0 + 1 hours);
        address[] memory accounts = new address[](4);
        uint64[] memory times = new uint64[](4);
        (accounts[0], times[0]) = (S1, T0);
        (accounts[1], times[1]) = (S2, T0);
        (accounts[2], times[2]) = (S1, T0 + 1 hours);
        (accounts[3], times[3]) = (K, T0 + 100 days);
        bool[] memory got = reg.wasAllowedMany(accounts, WRITE, times);
        for (uint256 i; i < 4; ++i) {
            assertEq(got[i], reg.wasAllowed(accounts[i], WRITE, times[i]));
        }
        assertTrue(got[0]);
        assertFalse(got[1]);
        assertFalse(got[2]);
        assertTrue(got[3]);
    }

    function test_historyRing_keepsNewestEight_andFailsClosedForDroppedTimes() public {
        for (uint64 i; i < 10; ++i) {
            vm.warp(T0 + i * 1 hours);
            _grant(K, VIEWER, S1, T0 + i * 1 hours + 30 minutes);
        }
        assertEq(reg.historyLength(S1), 10);
        DriveRegistry.IntervalView[] memory h = reg.historyOf(S1);
        assertEq(h.length, 8);
        assertEq(h[0].from, T0 + 2 hours, "oldest kept should be the third");
        assertEq(h[7].from, T0 + 9 hours);
        assertFalse(reg.wasAllowed(S1, READ, T0 + 10 minutes), "dropped interval should fail closed");
        assertTrue(reg.wasAllowed(S1, READ, T0 + 2 hours + 10 minutes));
        assertFalse(reg.wasAllowed(S1, READ, T0 + 2 hours + 40 minutes), "gap between grants");
    }

    // =====================================================================
    // Upgrade freeze
    // =====================================================================

    function test_upgradeReverts_forOwnerAndWallet_withAnyTarget() public {
        UserRegistry stockImpl = new UserRegistry(labelStore, address(namer));
        DriveRegistry driveImpl2 = new DriveRegistry(labelStore, address(namer));
        address[2] memory callers = [K, W];
        for (uint256 i; i < 2; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(DriveRegistry.UpgradesDisabled.selector);
            reg.upgradeToAndCall(address(stockImpl), "");
            vm.prank(callers[i]);
            vm.expectRevert(
                abi.encodeWithSelector(IUUPSProxy.InvalidUpgradeTarget.selector, address(impl), address(driveImpl2))
            );
            reg.upgradeToAndCall(address(driveImpl2), "");
        }
        (, address current) = IUUPSProxy(address(reg)).getVerifiableProxyData();
        assertEq(current, address(impl));
    }

    /// Worst case: a proxy of our implementation set up through the stock `initialize` with every role, upgrade
    /// included. The strip in _getRoles must make the upgrade role inert; drive roles without an end date fail closed.
    function test_upgradeRoleInStorageIsInert() public {
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        DriveRegistry r = DriveRegistry(
            factory.deployProxy(
                address(impl), 1, abi.encodeCall(UserRegistry.initialize, (attacker, EACBaseRolesLib.ALL_ROLES))
            )
        );
        assertFalse(r.hasRootRoles(RegistryRolesLib.ROLE_UPGRADE, attacker));
        assertEq(r.roles(0, attacker) & UPGRADE, 0);
        assertFalse(r.hasRootRoles(READ, attacker), "drive roles without an end date must fail closed");
        vm.prank(attacker);
        vm.expectPartialRevert(IEnhancedAccessControl.EACCannotGrantRoles.selector);
        r.grantRootRoles(RegistryRolesLib.ROLE_UPGRADE, makeAddr("friend"));
    }

    /// A stock UserRegistry can't be upgraded into a DriveRegistry (control: it can be upgraded to stock).
    function test_noProxyCanBeUpgradedIntoDriveRegistry() public {
        UserRegistry stockImpl = new UserRegistry(labelStore, address(namer));
        UserRegistry stockImpl2 = new UserRegistry(labelStore, address(namer));
        vm.prank(K);
        UserRegistry stock = UserRegistry(
            factory.deployProxy(address(stockImpl), 7, abi.encodeCall(UserRegistry.initialize, (K, UPGRADE)))
        );
        vm.prank(K);
        vm.expectRevert(
            abi.encodeWithSelector(IUUPSProxy.InvalidUpgradeTarget.selector, address(stockImpl), address(impl))
        );
        stock.upgradeToAndCall(address(impl), "");

        vm.prank(K);
        stock.upgradeToAndCall(address(stockImpl2), ""); // control
        (, address current) = IUUPSProxy(address(stock)).getVerifiableProxyData();
        assertEq(current, address(stockImpl2));
    }

    // =====================================================================
    // Fuzz
    // =====================================================================

    function testFuzz_expiryMatchesLiveCheck(uint8 roleSel, uint64 duration, uint64 elapsed) public {
        uint256 roles = [VIEWER, EDITOR, MANAGER][roleSel % 3];
        duration = uint64(bound(duration, 1, 10 * 365 days));
        elapsed = uint64(bound(elapsed, 0, 20 * 365 days));
        _grant(K, roles, S1, T0 + duration);
        vm.warp(T0 + elapsed);

        bool expected = elapsed < duration;
        assertEq(reg.hasRootRoles(roles, S1), expected, "live check");
        assertEq(reg.wasAllowed(S1, roles, _now()), expected, "history at now");
        assertTrue(reg.wasAllowed(S1, roles, T0));
        assertTrue(reg.wasAllowed(S1, roles, T0 + duration - 1));
        assertFalse(reg.wasAllowed(S1, roles, T0 + duration));
    }

    function testFuzz_revokeAt(uint64 duration, uint64 revokeAfter, uint64 probe) public {
        duration = uint64(bound(duration, 2, 30 days));
        revokeAfter = uint64(bound(revokeAfter, 1, duration - 1));
        probe = uint64(bound(probe, T0 - 1 days, T0 + duration + 1 days));
        _grant(K, EDITOR, S1, T0 + duration);
        vm.warp(T0 + revokeAfter);
        vm.prank(K);
        reg.revokeRootRoles(EDITOR, S1);
        bool expected = probe >= T0 && probe < T0 + revokeAfter;
        assertEq(reg.wasAllowed(S1, WRITE, probe), expected);
    }

    function testFuzz_historyRecordsExactRoles(uint256 roles) public {
        roles &= ALL_DRIVE;
        if (roles == 0) roles = READ;
        _grant(K, roles, S1, T0 + 1 days);
        assertEq(reg.historyOf(S1)[0].roles, roles, "pack/unpack round trip");
        (uint256 live,,,) = reg.accessOf(S1);
        assertEq(live, roles);
        for (uint256 nybble = 10; nybble <= 12; ++nybble) {
            uint256 bit = 1 << (nybble * 4);
            assertEq(reg.wasAllowed(S1, bit, T0), roles & bit != 0);
            assertEq(reg.wasAllowed(S1, bit << 128, T0), roles & (bit << 128) != 0);
        }
    }

    function testFuzz_outsiderCannotGrant(address caller, uint64 until) public {
        vm.assume(caller != K);
        until = uint64(bound(until, T0 + 1, NO_END));
        vm.prank(caller);
        vm.expectRevert();
        reg.grantRolesUntil(VIEWER, S1, until);
    }

    function testFuzz_upgradeRevertsForAnyCaller(address caller) public {
        UserRegistry stockImpl = new UserRegistry(labelStore, address(namer));
        vm.prank(caller);
        vm.expectRevert(DriveRegistry.UpgradesDisabled.selector);
        reg.upgradeToAndCall(address(stockImpl), "");
    }
}
