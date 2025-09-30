import { network } from "hardhat";
import { isAddress } from "viem";
import type { WalletClient } from "viem";

type Address = `0x${string}`;

// Environment variable validation and sanity checks
function validateEnvironmentVariables(): void {
	const requiredVars = ["PET_LIVENESS_RATIO", "BASE_MAINNET_PRIVATE_KEY"];

	const missingVars = requiredVars.filter((varName) => !process.env[varName]);

	if (missingVars.length > 0) {
		throw new Error(
			`Missing required environment variables: ${missingVars.join(", ")}\n` +
				`Required variables:\n` +
				`  PET_LIVENESS_RATIO - Minimum actions per second (18 decimals precision)\n` +
				`  BASE_MAINNET_PRIVATE_KEY - Private key for Base mainnet deployment\n\n` +
				`Optional variables:\n` +
				`  ACTION_REPOSITORY_OWNER - Owner address for ActionRepository (defaults to deployer)\n` +
				`  ACTION_REPOSITORY_RECORDERS - Comma-separated list of recorder addresses\n` +
				`  PET_ACTIVITY_CHECKER_OWNER - Owner address for PetActivityChecker (defaults to deployer)`
		);
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

	// Validate BASE_MAINNET_PRIVATE_KEY format (basic check)
	const privateKey = process.env.BASE_MAINNET_PRIVATE_KEY;
	if (privateKey) {
		if (!privateKey.startsWith("0x") || privateKey.length !== 66) {
			throw new Error(`Invalid BASE_MAINNET_PRIVATE_KEY format: must be 64 hex characters with 0x prefix`);
		}
	}

	console.log("✅ Environment variables validation passed");
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
	return raw as Address;
}

function requireAddress(raw: string, label: string): Address {
	if (!isAddress(raw)) {
		throw new Error(`Invalid ${label} address provided: ${raw}`);
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
async function deployContracts() {
	try {
		// Validate environment variables before proceeding
		validateEnvironmentVariables();

		const { viem } = await network.connect({
			network: "baseMainnet",
			chainType: "op",
		});

		const walletClients = await viem.getWalletClients();
		const deployer = selectDeployer(walletClients);

		if (!deployer.account) {
			throw new Error("Deployer account is undefined");
		}

		console.log("Using deployer", deployer.account.address);
		console.log("✅ Deployer address from BASE_MAINNET_PRIVATE_KEY:", deployer.account.address);

		// Set deployer as the default owner of ActionRepository
		const ownerAddress = resolveAddress(process.env.ACTION_REPOSITORY_OWNER, deployer.account.address, "ACTION_REPOSITORY_OWNER");

		console.log("Deploying ActionRepository with owner", ownerAddress);
		const actionRepository = await viem.deployContract("ActionRepository", [ownerAddress], {
			client: { wallet: deployer as any },
		});
		console.log("✅ ActionRepository deployed at", actionRepository.address);

		// Set up recorders if specified
		const recordersEnv = process.env.ACTION_REPOSITORY_RECORDERS;
		let recorders: string[] = [];
		if (recordersEnv) {
			recorders = recordersEnv
				.split(",")
				.map((entry) => entry.trim())
				.filter(Boolean);

			console.log(`Setting up ${recorders.length} recorder(s)...`);
			for (const recorder of recorders) {
				const recorderAddress = requireAddress(recorder, "ACTION_REPOSITORY_RECORDERS entry");
				console.log("Granting recorder permissions to", recorderAddress);
				await actionRepository.write.setRecorder([recorderAddress, true], {
					account: deployer.account,
				});
			}
			console.log("✅ All recorders configured");
		}

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
		if (recordersEnv && recorders.length > 0) {
			console.log(`🎯 Recorders configured: ${recorders.length}`);
		}
		console.log("=".repeat(50));
		console.log("✅ All contracts deployed and configured successfully!");
	} catch (error) {
		console.error("❌ Deployment failed:");
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

// Execute deployment
await deployContracts();
