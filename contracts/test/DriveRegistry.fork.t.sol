// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";

import {UserRegistry} from "@ensv2/registry/UserRegistry.sol";
import {IRegistry} from "@ensv2/registry/interfaces/IRegistry.sol";
import {ILabelStore} from "@ensv2/utils/interfaces/ILabelStore.sol";
import {VerifiableFactory} from "@ensdomains/verifiable-factory/VerifiableFactory.sol";

import {DriveRegistry} from "../src/DriveRegistry.sol";

/// @dev Runs against the real ENSv2 deployment on Sepolia, at a pinned block. Needs SEPOLIA_RPC_URL and
///      SEPOLIA_FORK_BLOCK (configuration, from .env); skips with a reason when either is missing.
///      Addresses come from deployments/sepolia.json only.
contract DriveRegistryForkTest is Test {
    using stdJson for string;

    uint256 internal constant READ = 1 << 40;
    uint64 internal constant NO_END = type(uint64).max;

    bool internal forked;
    string internal json;
    VerifiableFactory internal factory;
    address internal labelStore;
    address internal namer;
    address internal userRegistryImpl;

    address internal K = makeAddr("K");
    address internal W = makeAddr("W");
    address internal S = makeAddr("S");

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string(""));
        uint256 blockNumber = vm.envOr("SEPOLIA_FORK_BLOCK", uint256(0));
        if (bytes(rpc).length == 0 || blockNumber == 0) return;
        vm.createSelectFork(rpc, blockNumber);
        forked = true;
        json = vm.readFile(string.concat(vm.projectRoot(), "/deployments/sepolia.json"));
        factory = VerifiableFactory(json.readAddress(".ensv2.VerifiableFactory"));
        labelStore = json.readAddress(".ensv2.LabelStore");
        namer = json.readAddress(".ensv2.ContractNamer");
        userRegistryImpl = json.readAddress(".ensv2.UserRegistryImpl");
    }

    modifier onlyFork() {
        if (!forked) {
            emit log("skipped: set SEPOLIA_RPC_URL and SEPOLIA_FORK_BLOCK to run the fork tests");
            vm.skip(true);
        }
        _;
    }

    /// Re-checks the address table onchain, and that our constructor arguments match how ENS deployed
    /// its own UserRegistry implementation.
    function test_fork_ensv2AddressesHaveCode_andMatchOurWiring() public onlyFork {
        string[9] memory names = [
            "ETHRegistrar",
            "ETHRegistry",
            "RootRegistry",
            "UserRegistryImpl",
            "PermissionedResolverImpl",
            "VerifiableFactory",
            "UniversalResolverV2",
            "LabelStore",
            "ContractNamer"
        ];
        for (uint256 i; i < names.length; ++i) {
            address a = json.readAddress(string.concat(".ensv2.", names[i]));
            assertGt(a.code.length, 0, string.concat("no code at ", names[i]));
        }
        assertEq(address(UserRegistry(userRegistryImpl).LABEL_STORE()), labelStore, "LabelStore differs from ENS's");
        assertTrue(UserRegistry(userRegistryImpl).isContractNamer(namer), "ContractNamer differs from ENS's");
    }

    /// The whole folder lifecycle through the real VerifiableFactory and LabelStore.
    function test_fork_folderLifecycleThroughRealFactory() public onlyFork {
        DriveRegistry impl = new DriveRegistry(ILabelStore(labelStore), namer);
        vm.prank(K);
        DriveRegistry reg = DriveRegistry(
            factory.deployProxy(address(impl), uint256(keccak256("fork")), abi.encodeCall(DriveRegistry.initializeDrive, (K, W)))
        );
        assertEq(factory.verifyContract(address(reg)), address(impl));
        assertEq(reg.driveOwner(), K);

        // a subfolder label goes through the real LabelStore
        vm.prank(K);
        reg.register("f-fork", K, IRegistry(address(0)), address(0), 0, uint64(block.timestamp + 365 days));

        uint64 t0 = uint64(block.timestamp);
        vm.prank(K);
        reg.grantRolesUntil(READ, S, t0 + 2 minutes);
        assertTrue(reg.wasAllowed(S, READ, t0));
        vm.warp(t0 + 2 minutes);
        assertFalse(reg.hasRootRoles(READ, S));
        assertFalse(reg.wasAllowed(S, READ, t0 + 2 minutes));
        assertTrue(reg.wasAllowed(S, READ, t0), "history lost after expiry");

        vm.prank(K);
        vm.expectRevert(DriveRegistry.UpgradesDisabled.selector);
        reg.upgradeToAndCall(userRegistryImpl, "");
    }
}
