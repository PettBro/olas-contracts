import { network } from "hardhat";
import { isAddress } from "viem";
import type { WalletClient } from "viem";
import { pathToFileURL } from "url";

type Address = `0x${string}`;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" satisfies Address;

const OPTIONAL_ENV_VARS_HELP = "Optional variables:\n" + "  ACTION_REPOSITORY_OWNER - Owner address for ActionRepository (defaults to deployer)\n" + "  PET_ACTIVITY_CHECKER_OWNER - Owner address for PetActivityChecker (defaults to deployer)";

const ENV_VAR_DESCRIPTIONS: Record<string, string> = {
	PET_LIVENESS_RATIO: "Minimum actions per second (18 decimals precision)",
	BASE_MAINNET_PRIVATE_KEY: "Private key for Base mainnet deployment",
};

const NETWORK_CONFIG = {
	baseMainnet: {
		chainType: "op",
		requiredEnvVars: ["PET_LIVENESS_RATIO", "BASE_MAINNET_PRIVATE_KEY"] as const,
		description: "Base mainnet (OP stack)",
	},
	anvil: {
		chainType: "l1",
		requiredEnvVars: ["PET_LIVENESS_RATIO"] as const,
		description: "Local Anvil dev chain",
	},
	// Local L1 simulator inside Hardhat (no external node needed)
	hardhatMainnet: {
		chainType: "l1",
		requiredEnvVars: ["PET_LIVENESS_RATIO"] as const,
		description: "Hardhat local L1 simulator",
	},
	hardhatOp: {
		chainType: "op",
		requiredEnvVars: ["PET_LIVENESS_RATIO"] as const,
		description: "Hardhat local OP simulator",
	},
} as const;

type NetworkName = keyof typeof NETWORK_CONFIG;

const DEFAULT_NETWORK: NetworkName = "baseMainnet";

function isSupportedNetwork(networkName: string): networkName is NetworkName {
	return networkName in NETWORK_CONFIG;
}

function resolveTargetNetwork(override?: NetworkName) {
	const envNetwork = override ?? (process.env.DEPLOY_NETWORK as NetworkName | undefined) ?? (process.env.HARDHAT_NETWORK as NetworkName | undefined) ?? DEFAULT_NETWORK;

	if (!isSupportedNetwork(envNetwork)) {
		const supportedNetworks = Object.keys(NETWORK_CONFIG).join(", ");
		throw new Error(`Unsupported network "${String(envNetwork)}". Set DEPLOY_NETWORK to one of: ${supportedNetworks}`);
	}

	return { name: envNetwork, chainType: NETWORK_CONFIG[envNetwork].chainType };
}

function formatRequiredVars(requiredVars: readonly string[]): string {
	return requiredVars
		.map((varName) => {
			const description = ENV_VAR_DESCRIPTIONS[varName];
			return description ? `  ${varName} - ${description}` : `  ${varName}`;
		})
		.join("\n");
}

// Environment variable validation and sanity checks
function validateEnvironmentVariables(networkName: NetworkName): void {
	const requiredVars = [...NETWORK_CONFIG[networkName].requiredEnvVars];
	const missingVars = requiredVars.filter((varName) => !process.env[varName]);

	if (missingVars.length > 0) {
		throw new Error(`Missing required environment variables for ${networkName}: ${missingVars.join(", ")}\n` + `Required variables:\n` + `${formatRequiredVars(requiredVars)}\n\n` + OPTIONAL_ENV_VARS_HELP);
	}

	// Validate PET_LIVENESS_RATIO is a positive number
	const livenessRatio = process.env.PET_LIVENESS_RATIO;
	if (livenessRatio) {
		try {
			const ratio = BigInt(livenessRatio);
			if (ratio <= 0) {
				throw new Error("PET_LIVENESS_RATIO must be greater than 0");
			}
		} catch (err) {
			throw new Error(`Invalid PET_LIVENESS_RATIO: ${livenessRatio}. Must be a positive integer.`);
		}
	}

	if (networkName === "baseMainnet") {
		// Validate BASE_MAINNET_PRIVATE_KEY format (basic check)
		const privateKey = process.env.BASE_MAINNET_PRIVATE_KEY;
		if (!privateKey) {
			throw new Error("BASE_MAINNET_PRIVATE_KEY must be set for baseMainnet deployments");
		}
		if (!privateKey.startsWith("0x") || privateKey.length !== 66) {
			throw new Error(`Invalid BASE_MAINNET_PRIVATE_KEY format: must be 64 hex characters with 0x prefix`);
		}
	}

	console.log(`✅ Environment variables validation passed for ${networkName}`);
}

function parseBigIntEnv(name: string, fallback?: string): bigint {
	const raw = process.env[name] ?? fallback;
	if (raw === undefined) {
		throw new Error(`Missing required environment variable ${name}`);
	}

	try {
		return BigInt(raw);
	} catch (err) {
		throw new Error(`Environment variable ${name} must be set to an integer string representing a wei amount, received: ${raw}`);
	}
}

function resolveAddress(raw: string | undefined, fallback: Address, label: string): Address {
	if (!raw) {
		return fallback;
	}
	if (!isAddress(raw)) {
		throw new Error(`Invalid ${label} address provided: ${raw}`);
	}
	if (raw.toLowerCase() === ZERO_ADDRESS) {
		throw new Error(`${label} address cannot be the zero address`);
	}
	return raw as Address;
}

function selectDeployer(walletClients: WalletClient[]): WalletClient {
	if (walletClients.length === 0) {
		throw new Error("No wallet clients available. Configure accounts in hardhat.config.ts");
	}

	// Since the wallet clients are already configured with BASE_MAINNET_PRIVATE_KEY in hardhat.config.ts,
	// we can just use the first (and only) wallet client
	const deployer = walletClients[0];

	if (!deployer.account) {
		throw new Error("Deployer account is undefined");
	}

	return deployer;
}

// Main deployment function with error handling
export async function deployContracts(targetNetwork?: NetworkName) {
	try {
		const { name: networkName, chainType } = resolveTargetNetwork(targetNetwork);

		// Validate environment variables before proceeding
		validateEnvironmentVariables(networkName);

		const { viem } = await network.connect({
			network: networkName,
			chainType,
		});

		const walletClients = await viem.getWalletClients();
		const deployer = selectDeployer(walletClients);

		if (!deployer.account) {
			throw new Error("Deployer account is undefined");
		}

		console.log("Using deployer", deployer.account.address);
		console.log(`✅ Network resolved to ${networkName} (${NETWORK_CONFIG[networkName].description})`);

		// Set deployer as the default owner of ActionRepository
		const ownerAddress = resolveAddress(process.env.ACTION_REPOSITORY_OWNER, deployer.account.address, "ACTION_REPOSITORY_OWNER");

		console.log("Deploying ActionRepository with owner", ownerAddress);
		const actionRepository = await viem.deployContract("ActionRepository", [ownerAddress], {
			client: { wallet: deployer as any },
		});
		console.log("✅ ActionRepository deployed at", actionRepository.address);

		const livenessRatio = parseBigIntEnv("PET_LIVENESS_RATIO");

		// Set deployer as the default owner of PetActivityChecker
		const petActivityCheckerOwner = resolveAddress(process.env.PET_ACTIVITY_CHECKER_OWNER, deployer.account.address, "PET_ACTIVITY_CHECKER_OWNER");

		console.log("Deploying PetActivityChecker with owner", petActivityCheckerOwner);
		const activityChecker = await viem.deployContract("PetActivityChecker", [actionRepository.address, livenessRatio, petActivityCheckerOwner] as any, {
			client: { wallet: deployer as any },
		});
		console.log("✅ PetActivityChecker deployed at", activityChecker.address);

		const publicClient = await viem.getPublicClient();
		const chainId = await publicClient.getChainId();

		console.log("\n🎉 Deployment completed successfully!");
		console.log("=".repeat(50));
		console.log("📋 Deployment Summary:");
		console.log("=".repeat(50));
		console.log(`🌐 Network (chain id): ${chainId}`);
		console.log(`👤 Deployer: ${deployer.account.address}`);
		console.log(`👑 ActionRepository owner: ${ownerAddress}`);
		console.log(`📦 ActionRepository: ${actionRepository.address}`);
		console.log(`🔍 PetActivityChecker: ${activityChecker.address}`);
		console.log(`👑 PetActivityChecker owner: ${petActivityCheckerOwner}`);
		console.log(`⚡ Liveness ratio: ${livenessRatio.toString()}`);
		console.log("=".repeat(50));
		console.log("✅ All contracts deployed and configured successfully!");
	} catch (error) {
		console.error("❌ Deployment failed:");
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

// Execute only when invoked directly (not when imported)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	await deployContracts();
}
