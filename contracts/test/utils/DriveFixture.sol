// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";

import {RegistryRolesLib} from "@ensv2/registry/libraries/RegistryRolesLib.sol";
import {LabelStore} from "@ensv2/utils/LabelStore.sol";
import {ContractNamer} from "@ensv2/utils/ContractNamer.sol";
import {VerifiableFactory} from "@ensdomains/verifiable-factory/VerifiableFactory.sol";

import {DriveRegistry} from "../../src/DriveRegistry.sol";

/// @dev Deploys the real ENSv2 pieces (ContractNamer, LabelStore, VerifiableFactory) locally, so every test goes
///      through the same proxy and initializer path as Sepolia.
abstract contract DriveFixture is Test {
    uint256 internal constant READ = 1 << 40;
    uint256 internal constant WRITE = 1 << 44;
    uint256 internal constant SHARE = 1 << 48;
    uint256 internal constant DRIVE = READ | WRITE | SHARE;
    uint256 internal constant ALL_DRIVE = DRIVE | (DRIVE << 128);

    uint256 internal constant VIEWER = READ;
    uint256 internal constant EDITOR = READ | WRITE;
    uint256 internal constant MANAGER = ALL_DRIVE;

    uint256 internal constant UPGRADE = RegistryRolesLib.ROLE_UPGRADE | RegistryRolesLib.ROLE_UPGRADE_ADMIN;
    uint256 internal constant DANGEROUS = RegistryRolesLib.ROLE_SET_SUBREGISTRY
        | RegistryRolesLib.ROLE_SET_SUBREGISTRY_ADMIN | RegistryRolesLib.ROLE_SET_PARENT
        | RegistryRolesLib.ROLE_SET_PARENT_ADMIN | RegistryRolesLib.ROLE_UNREGISTER
        | RegistryRolesLib.ROLE_UNREGISTER_ADMIN | RegistryRolesLib.ROLE_CAN_TRANSFER_ADMIN;

    uint64 internal constant NO_END = type(uint64).max;
    uint64 internal constant T0 = 1_793_923_200; // 2026-11-06 00:00:00 UTC; any realistic start time works

    ContractNamer internal namer;
    LabelStore internal labelStore;
    VerifiableFactory internal factory;
    DriveRegistry internal impl;

    address internal K = makeAddr("K");
    address internal W = makeAddr("W");

    uint256 private _salt;

    function setUp() public virtual {
        vm.warp(T0);
        namer = new ContractNamer();
        labelStore = new LabelStore(namer);
        factory = new VerifiableFactory();
        impl = new DriveRegistry(labelStore, address(namer));
    }

    function _deployDrive(address driveKey, address mainWallet) internal returns (DriveRegistry) {
        vm.prank(driveKey);
        return DriveRegistry(
            factory.deployProxy(
                address(impl), ++_salt, abi.encodeCall(DriveRegistry.initializeDrive, (driveKey, mainWallet))
            )
        );
    }

    function _now() internal view returns (uint64) {
        return uint64(block.timestamp);
    }
}
