// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AttentionOracle} from "../src/AttentionOracle.sol";
import {LiquidityVault} from "../src/LiquidityVault.sol";
import {ParloPool} from "../src/ParloPool.sol";
import {MockUSDT} from "../src/mocks/MockUSDT.sol";
import {MockVerifier7} from "../src/mocks/MockVerifier7.sol";
import {MockVerifier56} from "../src/mocks/MockVerifier56.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {IAttentionOracle} from "../src/interfaces/IAttentionOracle.sol";
import {ILiquidityVault} from "../src/interfaces/ILiquidityVault.sol";
import {IVerifier7} from "../src/interfaces/IVerifier7.sol";
import {IVerifier56} from "../src/interfaces/IVerifier56.sol";

/// @notice Deploys Parlo. Env:
///   PRIVATE_KEY      (optional; otherwise use --private-key / --account)
///   USDT_ADDRESS     (default: BSC USDT on 56, fresh MockUSDT on 31337, required elsewhere)
///   EPOCH_LENGTH     (default 300)
///   REPORTER_ADDRESS (optional; authorized as oracle reporter)
/// Real verifiers are used if src/verifiers/{Transact,Open,Close}Verifier.sol exist; mocks only on chainId 31337.
contract Deploy is Script {
    address constant COMPANY = 0xB34296465F18F55003100e925aBc70656E224035;
    address constant BSC_USDT = 0x55d398326f99059fF775485246999027B3197955;

    struct Deployed {
        address usdt;
        address oracle;
        address vault;
        address pool;
        address transactVerifier;
        address openVerifier;
        address closeVerifier;
        bool mockVerifiers;
        uint256 epochLength;
        address reporter;
        uint256 startBlock;
    }

    function run() external returns (Deployed memory d) {
        uint256 chainId = block.chainid;
        d.epochLength = vm.envOr("EPOCH_LENGTH", uint256(300));
        d.reporter = vm.envOr("REPORTER_ADDRESS", address(0));
        d.usdt = vm.envOr("USDT_ADDRESS", address(0));
        d.startBlock = block.number;

        bool realVerifiers = vm.exists("src/verifiers/TransactVerifier.sol")
            && vm.exists("src/verifiers/OpenVerifier.sol") && vm.exists("src/verifiers/CloseVerifier.sol");
        if (!realVerifiers && chainId != 31337) {
            revert("Parlo Deploy: real verifiers missing in src/verifiers/ (mock verifiers only allowed on chainId 31337)");
        }
        if (d.usdt == address(0) && chainId != 56 && chainId != 31337) {
            revert("Parlo Deploy: USDT_ADDRESS env required on this chain");
        }

        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        if (pk != 0) vm.startBroadcast(pk);
        else vm.startBroadcast();

        if (d.usdt == address(0)) {
            d.usdt = chainId == 56 ? BSC_USDT : address(new MockUSDT());
        }

        if (realVerifiers) {
            d.transactVerifier = _deployArtifact("TransactVerifier.sol:TransactVerifier");
            d.openVerifier = _deployArtifact("OpenVerifier.sol:OpenVerifier");
            d.closeVerifier = _deployArtifact("CloseVerifier.sol:CloseVerifier");
        } else {
            d.mockVerifiers = true;
            d.transactVerifier = address(new MockVerifier7());
            d.openVerifier = address(new MockVerifier7());
            d.closeVerifier = address(new MockVerifier56());
        }

        address deployer = _sender(pk);

        AttentionOracle oracle = new AttentionOracle(deployer, d.epochLength);
        oracle.addMarket(1, "$BNB");
        oracle.addMarket(2, "$PEPE");
        oracle.addMarket(3, "#AIAgents");
        oracle.addMarket(4, "#Memecoins");
        oracle.addMarket(5, "@cz_binance");
        oracle.addMarket(6, "#RWA");
        if (d.reporter != address(0)) oracle.setReporter(d.reporter, true);

        LiquidityVault vault =
            new LiquidityVault(deployer, IERC20(d.usdt), IAttentionOracle(address(oracle)), COMPANY);
        ParloPool pool = new ParloPool(
            deployer,
            IERC20(d.usdt),
            IAttentionOracle(address(oracle)),
            ILiquidityVault(address(vault)),
            IVerifier7(d.transactVerifier),
            IVerifier7(d.openVerifier),
            IVerifier56(d.closeVerifier)
        );
        vault.setPool(address(pool));

        if (deployer != COMPANY) {
            oracle.transferOwnership(COMPANY);
            vault.transferOwnership(COMPANY);
            pool.transferOwnership(COMPANY);
        }
        vm.stopBroadcast();

        d.oracle = address(oracle);
        d.vault = address(vault);
        d.pool = address(pool);

        _write(chainId, d);
        console2.log("AttentionOracle", d.oracle);
        console2.log("LiquidityVault ", d.vault);
        console2.log("ParloPool      ", d.pool);
        console2.log("USDT           ", d.usdt);
        console2.log("mock verifiers ", d.mockVerifiers);
    }

    function _sender(uint256 pk) internal view returns (address) {
        return pk != 0 ? vm.addr(pk) : msg.sender;
    }

    function _deployArtifact(string memory artifact) internal returns (address addr) {
        bytes memory code = vm.getCode(artifact);
        assembly {
            addr := create(0, add(code, 0x20), mload(code))
        }
        require(addr != address(0), string.concat("Parlo Deploy: failed to deploy ", artifact));
    }

    function _write(uint256 chainId, Deployed memory d) internal {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", chainId);
        vm.serializeUint(k, "startBlock", d.startBlock);
        vm.serializeUint(k, "epochLength", d.epochLength);
        vm.serializeAddress(k, "owner", COMPANY);
        vm.serializeAddress(k, "treasury", COMPANY);
        vm.serializeAddress(k, "reporter", d.reporter);
        vm.serializeAddress(k, "usdt", d.usdt);
        vm.serializeAddress(k, "transactVerifier", d.transactVerifier);
        vm.serializeAddress(k, "openVerifier", d.openVerifier);
        vm.serializeAddress(k, "closeVerifier", d.closeVerifier);
        vm.serializeBool(k, "mockVerifiers", d.mockVerifiers);
        vm.serializeAddress(k, "oracle", d.oracle);
        vm.serializeAddress(k, "vault", d.vault);
        string memory json = vm.serializeAddress(k, "pool", d.pool);
        vm.writeJson(json, string.concat(vm.projectRoot(), "/deployments/", vm.toString(chainId), ".json"));
    }
}
