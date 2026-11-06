// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";

import {UserRegistry} from "@ensv2/registry/UserRegistry.sol";
import {ILabelStore} from "@ensv2/utils/interfaces/ILabelStore.sol";

import {DriveRegistry} from "../src/DriveRegistry.sol";

/// @notice Deploys the DriveRegistry implementation to Sepolia. Folder proxies are created later through ENSv2's
///         VerifiableFactory. Addresses come from deployments/sepolia.json; the deployer key from .env.
///
///   cd contracts
///   forge script script/DeployDriveRegistry.s.sol --rpc-url "$SEPOLIA_RPC_URL" --broadcast \
///     --verify --etherscan-api-key "$ETHERSCAN_API_KEY"
///
/// Then record the address, transaction and block under .cloakroom in deployments/sepolia.json.
contract DeployDriveRegistry is Script {
    using stdJson for string;

    function run() external returns (DriveRegistry impl) {
        require(block.chainid == 11155111, "Sepolia only");
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/deployments/sepolia.json"));
        address labelStore = json.readAddress(".ensv2.LabelStore");
        address userRegistryImpl = json.readAddress(".ensv2.UserRegistryImpl");
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        // The implementation's namer (who may give it a reverse name) is our deployer, the way ENS's own
        // UserRegistryImpl names ENS's owner account. Proxies don't inherit it: they are initialized separately.
        address namer = vm.addr(deployerKey);

        // Same wiring check as the fork test, against the live chain, before spending gas.
        require(labelStore.code.length > 0, "LabelStore has no code");
        require(address(UserRegistry(userRegistryImpl).LABEL_STORE()) == labelStore, "LabelStore differs from ENS's");

        vm.startBroadcast(deployerKey);
        impl = new DriveRegistry(ILabelStore(labelStore), namer);
        vm.stopBroadcast();

        console.log("DriveRegistry implementation:", address(impl));
        console.log("block:", block.number);
    }
}
