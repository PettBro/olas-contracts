import type { HardhatUserConfig } from "hardhat/config";

import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import { configVariable } from "hardhat/config";

const config: HardhatUserConfig = {
	plugins: [hardhatToolboxViemPlugin, hardhatNetworkHelpers, hardhatVerify],
	solidity: {
		profiles: {
			default: {
				version: "0.8.28",
				settings: {
					optimizer: {
						enabled: true,
						runs: 200,
					},
					viaIR: true,
				},
			},
			production: {
				version: "0.8.28",
				settings: {
					optimizer: {
						enabled: true,
						runs: 200,
					},
					viaIR: true,
				},
			},
		},
	},
	verify: {
		etherscan: {
			apiKey: configVariable("ETHERSCAN_API_KEY"),
		},
		blockscout: {
			enabled: false,
		},
	},
	networks: {
		hardhatMainnet: {
			type: "edr-simulated",
			chainType: "l1",
		},
		hardhatOp: {
			type: "edr-simulated",
			chainType: "op",
		},
		anvil: {
			type: "http",
			chainType: "l1",
			url: "http://127.0.0.1:8545",
			accounts: [process.env.ANVIL_DEPLOYER_KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"],
		},
		baseMainnet: {
			type: "http",
			chainType: "op",
			url: "https://base-mainnet.g.alchemy.com/v2/WBTUuCNn4NJKPbfgtLAyS",
			accounts: [configVariable("BASE_MAINNET_PRIVATE_KEY")],
		},
		sepolia: {
			type: "http",
			chainType: "l1",
			url: configVariable("SEPOLIA_RPC_URL"),
			accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
		},
	},
};

export default config;
