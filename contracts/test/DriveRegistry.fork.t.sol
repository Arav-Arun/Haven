// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {EACBaseRolesLib} from "@ensv2/access-control/libraries/EACBaseRolesLib.sol";
import {IETHRegistrar} from "@ensv2/registrar/interfaces/IETHRegistrar.sol";
import {UserRegistry} from "@ensv2/registry/UserRegistry.sol";
import {IPermissionedRegistry} from "@ensv2/registry/interfaces/IPermissionedRegistry.sol";
import {IRegistry} from "@ensv2/registry/interfaces/IRegistry.sol";
import {RegistryRolesLib} from "@ensv2/registry/libraries/RegistryRolesLib.sol";
import {ILabelStore} from "@ensv2/utils/interfaces/ILabelStore.sol";
import {VerifiableFactory} from "@ensdomains/verifiable-factory/VerifiableFactory.sol";
import {NameCoder} from "@ens/contracts/utils/NameCoder.sol";

import {DriveRegistry} from "../src/DriveRegistry.sol";

/// The live Sepolia deployment is ENS branch audit-results-19102026 (6aac7c6), newer than our pinned 48b3e2d. These are
/// the few of its interfaces we call, copied from that branch: UserRegistry and PermissionedResolver take a list of
/// grants at initialisation, and the resolver keeps records by DNS-encoded name.
struct Grant {
    address account;
    uint256 roleBitmap;
}

interface ILiveEAC {
    function roles(uint256 resource, address account) external view returns (uint256);
    function hasRootRoles(uint256 roleBitmap, address account) external view returns (bool);
}

interface ILiveResolver is ILiveEAC {
    function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory);
}

interface ITextRead {
    function text(bytes32 node, string calldata key) external view returns (string memory);
}

interface IMintable {
    function mint(address to, uint256 amount) external;
}

interface IRentOracle {
    function isPaymentToken(IERC20 token) external view returns (bool);
}

/// UniversalResolverV2 at the live commit: resolution.
interface IUniversalResolverLike {
    function findResolver(bytes calldata name) external view returns (address resolver, bytes32 node, uint256 offset);
    function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory, address);
}

/// UniversalHelper at the live commit: the registry walk.
interface IUniversalHelper {
    function findExactRegistry(bytes calldata name) external view returns (address);
}

interface IRegistrarExtras {
    function ETH_REGISTRY() external view returns (address);
    function rentPriceOracle() external view returns (address);
    function MIN_COMMITMENT_AGE() external view returns (uint64);
}

/// @dev Runs against the real ENSv2 deployment on Sepolia at a pinned block, so the whole Cloakroom bootstrap and the
///      API's claim and room flows are rehearsed on the live contracts before any funds are spent. Needs
///      SEPOLIA_RPC_URL; the block comes from SEPOLIA_FORK_BLOCK or deployments/sepolia.json. Skips with a reason when
///      there is no RPC. Addresses come from deployments/sepolia.json only.
///
///   SEPOLIA_RPC_URL=… forge test --match-path test/DriveRegistry.fork.t.sol -vv
contract DriveRegistryForkTest is Test {
    using stdJson for string;

    uint256 internal constant READ = 1 << 40;
    uint256 internal constant WRITE = 1 << 44;
    uint64 internal constant NO_END = type(uint64).max;
    uint256 internal constant UPGRADE_ROLES = RegistryRolesLib.ROLE_UPGRADE | RegistryRolesLib.ROLE_UPGRADE_ADMIN;
    // PermissionedResolverLib at the live commit: ROLE_SET_TEXT = 1 << 4, ROLE_UPGRADE = 1 << 124 (+ admin bits).
    uint256 internal constant RESOLVER_SET_TEXT = 1 << 4;
    uint256 internal constant RESOLVER_UPGRADE_ROLES = (1 << 124) | (1 << 252);
    /// Token roles the claimed name's owner gets: point the name elsewhere, change its resolver, transfer it.
    uint256 internal constant NAME_OWNER_ROLES = RegistryRolesLib.ROLE_SET_SUBREGISTRY
        | RegistryRolesLib.ROLE_SET_SUBREGISTRY_ADMIN | RegistryRolesLib.ROLE_SET_RESOLVER
        | RegistryRolesLib.ROLE_SET_RESOLVER_ADMIN | RegistryRolesLib.ROLE_CAN_TRANSFER_ADMIN;

    bool internal forked;
    string internal json;
    VerifiableFactory internal factory;
    IETHRegistrar internal registrar;
    IUniversalResolverLike internal ur;
    IUniversalHelper internal helper;
    address internal labelStore;
    address internal userRegistryImpl;
    address internal resolverImpl;
    IERC20 internal usdc;

    // Fresh labels: a well-known label like makeAddr("K") can have code on a public chain (an EIP-7702 delegation),
    // and minting an ERC-1155 name to it then calls its fallback.
    address internal deployer = makeAddr("cloakroom/fork/deployer");
    address internal relayer = makeAddr("cloakroom/fork/relayer");
    address internal K = makeAddr("cloakroom/fork/K");
    address internal W = makeAddr("cloakroom/fork/W");
    address internal S = makeAddr("cloakroom/fork/S");
    address internal kRoom = makeAddr("cloakroom/fork/K_room");

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        json = vm.readFile(string.concat(vm.projectRoot(), "/deployments/sepolia.json"));
        uint256 blockNumber = vm.envOr("SEPOLIA_FORK_BLOCK", json.readUint(".forkBlock"));
        vm.createSelectFork(rpc, blockNumber);
        forked = true;
        factory = VerifiableFactory(json.readAddress(".ensv2.VerifiableFactory"));
        registrar = IETHRegistrar(json.readAddress(".ensv2.ETHRegistrar"));
        ur = IUniversalResolverLike(json.readAddress(".ensv2.UniversalResolverV2"));
        helper = IUniversalHelper(json.readAddress(".ensv2.UniversalHelper"));
        labelStore = json.readAddress(".ensv2.LabelStore");
        userRegistryImpl = json.readAddress(".ensv2.UserRegistryImpl");
        resolverImpl = json.readAddress(".ensv2.PermissionedResolverImpl");
        usdc = IERC20(json.readAddress(".ensv2.MockUSDC"));
        for (uint256 i; i < 6; ++i) {
            address a = [deployer, relayer, K, W, S, kRoom][i];
            assertEq(a.code.length, 0, "test account has code on Sepolia");
        }
    }

    modifier onlyFork() {
        if (!forked) {
            emit log("skipped: set SEPOLIA_RPC_URL to run the fork tests");
            vm.skip(true);
        }
        _;
    }

    /// Re-checks the address table onchain, and that the live contracts are wired the way we assume.
    function test_fork_addressesAndWiring() public onlyFork {
        string[13] memory names = [
            "ETHRegistrar",
            "ETHRegistry",
            "RootRegistry",
            "UserRegistryImpl",
            "PermissionedResolverImpl",
            "VerifiableFactory",
            "UniversalResolverV2",
            "UniversalHelper",
            "LabelStore",
            "ContractNamer",
            "StandardRentPriceOracle",
            "MockUSDC",
            "MockDAI"
        ];
        for (uint256 i; i < names.length; ++i) {
            address a = json.readAddress(string.concat(".ensv2.", names[i]));
            assertGt(a.code.length, 0, string.concat("no code at ", names[i]));
        }
        IRegistrarExtras extras = IRegistrarExtras(address(registrar));
        assertEq(extras.ETH_REGISTRY(), json.readAddress(".ensv2.ETHRegistry"), "registrar's ETHRegistry");
        address oracle = extras.rentPriceOracle();
        assertEq(oracle, json.readAddress(".ensv2.StandardRentPriceOracle"), "registrar's oracle");
        assertTrue(IRentOracle(oracle).isPaymentToken(usdc), "MockUSDC accepted");
        assertTrue(IRentOracle(oracle).isPaymentToken(IERC20(json.readAddress(".ensv2.MockDAI"))), "MockDAI accepted");
        assertEq(address(UserRegistry(userRegistryImpl).LABEL_STORE()), labelStore, "LabelStore differs from ENS's");
    }

    // State shared by the stages of the rehearsal (one test, split to keep the stack small).
    DriveRegistry internal impl;
    IPermissionedRegistry internal app;
    IPermissionedRegistry internal rooms;
    DriveRegistry internal root;
    DriveRegistry internal folder;

    /// The whole Cloakroom setup and every onchain flow, on the live contracts.
    function test_fork_bootstrapClaimRoomMountExpiry() public onlyFork {
        impl = new DriveRegistry(ILabelStore(labelStore), deployer);
        _stageAppNames();
        _stageClaim();
        _stageFolderAndRoom();
        _stageAliasingAndExpiry();
        _stageAccessThatEnds();
    }

    /// Check 1: cloakroom.eth through the real ETHRegistrar (commit, wait, register, paid in MockUSDC), then
    /// rooms.cloakroom.eth, with the relayer as registrar of both and nothing else.
    function _stageAppNames() internal {
        (app, rooms) = _registerAppNames(365 days);
        assertEq(helper.findExactRegistry(NameCoder.encode("cloakroom.eth")), address(app));
        assertEq(helper.findExactRegistry(NameCoder.encode("rooms.cloakroom.eth")), address(rooms));
        assertEq(app.roles(0, relayer), RegistryRolesLib.ROLE_REGISTRAR, "relayer holds only ROLE_REGISTRAR");
        assertEq(rooms.roles(0, relayer), RegistryRolesLib.ROLE_REGISTRAR, "relayer holds only ROLE_REGISTRAR");
    }

    /// Check 3 / POST /claim: the relayer deploys the resolver (cloak.key set at initialisation) and the drive root,
    /// and registers the name; it keeps no role on either.
    function _stageClaim() internal {
        string memory cloakKey = "0x04aabbcc";
        uint256 g = gasleft();
        ILiveResolver resolver;
        (resolver, root) = _claim("alice", cloakKey);
        console.log("gas: claim (resolver proxy + drive root proxy + register):", g - gasleft());
        bytes memory alice = NameCoder.encode("alice.cloakroom.eth");
        assertEq(helper.findExactRegistry(alice), address(root), "registry walk finds the drive root");
        (address foundResolver, bytes32 node,) = ur.findResolver(alice);
        assertEq(foundResolver, address(resolver));
        bytes memory textCall = abi.encodeCall(ITextRead.text, (node, "cloak.key"));
        assertEq(abi.decode(resolver.resolve(alice, textCall), (string)), cloakKey, "cloak.key set at initialisation");
        (bytes memory result,) = ur.resolve(alice, textCall);
        assertEq(abi.decode(result, (string)), cloakKey, "cloak.key through UniversalResolverV2.resolve");
        assertEq(resolver.roles(0, relayer), 0, "the API keeps no role on the resolver");
        assertEq(root.roles(0, relayer), 0, "the API keeps no role on the drive root");
        assertEq(resolver.roles(0, W) & RESOLVER_UPGRADE_ROLES, 0, "nobody can upgrade the user's resolver");
        assertTrue(resolver.hasRootRoles(RESOLVER_SET_TEXT, W), "W can update cloak.key");
    }

    /// A folder in the drive (created by K), and POST /room: a room deployed by the relayer with root K_room.
    function _stageFolderAndRoom() internal {
        uint256 g = gasleft();
        folder = _folder(root, "f-forkfolder");
        console.log("gas: folder (DriveRegistry proxy + register):", g - gasleft());
        assertEq(
            helper.findExactRegistry(NameCoder.encode("f-forkfolder.alice.cloakroom.eth")),
            address(folder),
            "registry walk through our DriveRegistry"
        );

        g = gasleft();
        vm.startPrank(relayer);
        DriveRegistry room = _deploy(kRoom, address(0));
        rooms.register("r-forkroom", kRoom, IRegistry(address(room)), address(0), 0, uint64(block.timestamp + 365 days));
        vm.stopPrank();
        console.log("gas: room (DriveRegistry proxy + register):", g - gasleft());
        assertEq(helper.findExactRegistry(NameCoder.encode("r-forkroom.rooms.cloakroom.eth")), address(room));
        assertEq(room.driveOwner(), kRoom);
    }

    /// Check 4: namespace aliasing through a mount, and an expired subname that stops resolving.
    function _stageAliasingAndExpiry() internal {
        DriveRegistry sub = _folder(folder, "f-forksub");
        vm.prank(K);
        root.register("m-forkmount", K, IRegistry(address(folder)), address(0), 0, NO_END);
        assertEq(helper.findExactRegistry(NameCoder.encode("m-forkmount.alice.cloakroom.eth")), address(folder));
        assertEq(
            helper.findExactRegistry(NameCoder.encode("f-forksub.m-forkmount.alice.cloakroom.eth")), address(sub), "aliased path"
        );
        assertEq(
            helper.findExactRegistry(NameCoder.encode("f-forksub.f-forkfolder.alice.cloakroom.eth")), address(sub), "canonical path"
        );

        vm.prank(K);
        folder.register("l-forklink", K, IRegistry(address(sub)), address(0), 0, uint64(block.timestamp + 1 hours));
        bytes memory link = NameCoder.encode("l-forklink.f-forkfolder.alice.cloakroom.eth");
        assertEq(helper.findExactRegistry(link), address(sub), "live link resolves");
        vm.warp(block.timestamp + 1 hours);
        assertEq(helper.findExactRegistry(link), address(0), "expired link stops resolving");
    }

    /// A2 demo: grant → wasAllowed → time passes → false, interval still readable; neither K nor W can upgrade.
    function _stageAccessThatEnds() internal {
        uint64 t0 = uint64(block.timestamp);
        uint256 g = gasleft();
        vm.prank(K);
        folder.grantRolesUntil(READ | WRITE, S, t0 + 2 minutes);
        console.log("gas: grantRolesUntil (new editor):", g - gasleft());
        assertTrue(folder.wasAllowed(S, WRITE, t0));
        vm.warp(t0 + 2 minutes);
        assertFalse(folder.hasRootRoles(READ, S));
        assertFalse(folder.wasAllowed(S, READ, t0 + 2 minutes));
        assertTrue(folder.wasAllowed(S, READ, t0), "history lost after expiry");
        assertEq(folder.historyLength(S), 1);
        vm.prank(K);
        vm.expectRevert(DriveRegistry.UpgradesDisabled.selector);
        folder.upgradeToAndCall(userRegistryImpl, "");
        vm.prank(W);
        vm.expectRevert(DriveRegistry.UpgradesDisabled.selector);
        folder.upgradeToAndCall(userRegistryImpl, "");
    }

    // ---------------------------------------------------------------- helpers

    function _registerAppNames(uint64 duration) internal returns (IPermissionedRegistry appReg, IPermissionedRegistry roomsReg) {
        vm.startPrank(deployer);
        appReg = IPermissionedRegistry(_userRegistry());
        roomsReg = IPermissionedRegistry(_userRegistry());
        assertTrue(registrar.isAvailable("cloakroom"), "cloakroom.eth taken at the fork block");
        (uint256 base, uint256 premium) = registrar.getRegisterPrice("cloakroom", duration, usdc);
        IMintable(address(usdc)).mint(deployer, base + premium);
        usdc.approve(address(registrar), base + premium);
        bytes32 secret = keccak256("cloakroom/fork/secret");
        bytes32 commitment =
            registrar.makeCommitment("cloakroom", deployer, secret, IRegistry(address(appReg)), address(0), duration, bytes32(0));
        registrar.commit(commitment);
        vm.warp(block.timestamp + IRegistrarExtras(address(registrar)).MIN_COMMITMENT_AGE() + 1);
        uint256 g = gasleft();
        registrar.register("cloakroom", deployer, secret, IRegistry(address(appReg)), address(0), duration, usdc, bytes32(0));
        console.log("gas: ETHRegistrar.register(cloakroom):", g - gasleft());
        console.log("price of cloakroom.eth for a year, MockUSDC (6 decimals):", base + premium);
        uint64 expiry = uint64(block.timestamp) + duration;
        appReg.register("rooms", deployer, IRegistry(address(roomsReg)), address(0), 0, expiry);
        appReg.grantRootRoles(RegistryRolesLib.ROLE_REGISTRAR, relayer);
        roomsReg.grantRootRoles(RegistryRolesLib.ROLE_REGISTRAR, relayer);
        vm.stopPrank();
    }

    /// A stock UserRegistry proxy owned (every role) by the caller: the team's registries for cloakroom.eth and rooms.
    function _userRegistry() internal returns (address) {
        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant(deployer, EACBaseRolesLib.ALL_ROLES);
        return factory.deployProxy(
            userRegistryImpl,
            uint256(keccak256(abi.encode("cloakroom/fork/registry", gasleft()))),
            abi.encodeWithSignature("initialize((address,uint256)[])", grants)
        );
    }

    function _claim(string memory label, string memory cloakKey)
        internal
        returns (ILiveResolver resolver, DriveRegistry driveRoot)
    {
        bytes memory name = NameCoder.encode(string.concat(label, ".cloakroom.eth"));
        bytes[] memory setters = new bytes[](1);
        setters[0] = abi.encodeWithSignature("setText(bytes,string,string)", name, "cloak.key", cloakKey);
        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant(W, EACBaseRolesLib.ALL_ROLES & ~RESOLVER_UPGRADE_ROLES);
        vm.startPrank(relayer);
        resolver = ILiveResolver(
            factory.deployProxy(
                resolverImpl,
                uint256(keccak256(abi.encode("cloakroom/fork/resolver", label))),
                abi.encodeWithSignature("initialize((address,uint256)[],bytes[])", grants, setters)
            )
        );
        driveRoot = _deploy(K, W);
        // A user name lives as long as cloakroom.eth does.
        uint64 appExpiry = IPermissionedRegistry(json.readAddress(".ensv2.ETHRegistry")).getExpiry(uint256(keccak256("cloakroom")));
        app.register(label, W, IRegistry(address(driveRoot)), address(resolver), NAME_OWNER_ROLES, appExpiry);
        vm.stopPrank();
    }

    function _deploy(address driveKey, address mainWallet) internal returns (DriveRegistry) {
        return DriveRegistry(
            factory.deployProxy(
                address(impl),
                uint256(keccak256(abi.encode("cloakroom/fork/drive", driveKey, gasleft()))),
                abi.encodeCall(DriveRegistry.initializeDrive, (driveKey, mainWallet))
            )
        );
    }

    /// A folder created by K: a DriveRegistry proxy (K everyday roles, W dangerous ones) registered in `parent`.
    function _folder(DriveRegistry parent, string memory label) internal returns (DriveRegistry created) {
        vm.startPrank(K);
        created = _deploy(K, W);
        parent.register(label, K, IRegistry(address(created)), address(0), 0, NO_END);
        vm.stopPrank();
    }
}
