import { expect } from "chai";
import { network } from "hardhat";
import { padHex, stringToHex } from "viem";
import type { WalletClient } from "viem";
import { describe, it } from "node:test";

const { viem } = await network.connect();

async function signPetAction(walletClient: WalletClient, verifyingContract: `0x${string}`, actionId: number, nonce?: `0x${string}`, timestamp?: bigint) {
	const publicClient = await viem.getPublicClient();
	const chainId = await publicClient.getChainId();
	const msgNonce = nonce ?? padHex("0x1234", { size: 32 });
	const msgTimestamp = timestamp ?? BigInt(Math.floor(Date.now() / 1000));
	const domain = {
		name: "PettAIActionVerifier",
		version: "1",
		chainId,
		verifyingContract,
	} as const;
	const types = {
		PetAction: [
			{ name: "action", type: "uint8" },
			{ name: "nonce", type: "bytes32" },
			{ name: "timestamp", type: "uint256" },
		],
	} as const;
	const message = { action: actionId, nonce: msgNonce, timestamp: msgTimestamp } as const;
	const signature: `0x${string}` = await walletClient.signTypedData({ account: walletClient.account!, domain, types, primaryType: "PetAction", message } as any);
	const r = ("0x" + signature.slice(2, 66)) as `0x${string}`;
	const s = ("0x" + signature.slice(66, 130)) as `0x${string}`;
	let v = parseInt(signature.slice(130, 132), 16);
	if (v < 27) v += 27;
	return { v, r, s, nonce: msgNonce, timestamp: msgTimestamp };
}

describe("Pet staking flow", function () {
	const ACTION1_ID = 1;
	const ACTION2_ID = 2;
	const ACTION1_TYPE = padHex("0x01", { size: 32 });
	const ACTION2_TYPE = padHex("0x02", { size: 32 });

	async function deployFixture() {
		const [owner, agent] = await viem.getWalletClients();

		const actionRepository = await viem.deployContract("ActionRepository", [owner.account.address, owner.account.address] as any, {});

		const livenessRatio = 5n * 10n ** 17n; // 0.5 actions per second

		const activityChecker = await viem.deployContract("PetActivityChecker", [actionRepository.address, livenessRatio, owner.account.address], {});

		return { actionRepository, activityChecker, owner, agent, livenessRatio };
	}

	it("tracks per-action counters and totals", async function () {
		const { actionRepository, agent, owner } = await deployFixture();

		// Owner is mainSigner and caller; sign two actions of type 1 and one of type 2
		for (let i = 0; i < 2; i++) {
			const s = await signPetAction(owner, actionRepository.address, ACTION1_ID, padHex(`0x${(0x3000 + i).toString(16)}`, { size: 32 }));
			await actionRepository.write.recordAction([ACTION1_ID, s.nonce, s.timestamp, s.v, s.r, s.s], { account: owner.account });
		}
		{
			const s = await signPetAction(owner, actionRepository.address, ACTION2_ID, padHex("0x4000", { size: 32 }));
			await actionRepository.write.recordAction([ACTION2_ID, s.nonce, s.timestamp, s.v, s.r, s.s], { account: owner.account });
		}

		const walkCount = await actionRepository.read.actionCount([owner.account.address, ACTION1_TYPE]);
		const feedCount = await actionRepository.read.actionCount([owner.account.address, ACTION2_TYPE]);
		const total = await actionRepository.read.totalActions([owner.account.address]);

		expect(walkCount).to.equal(2n);
		expect(feedCount).to.equal(1n);
		expect(total).to.equal(3n);
	});

	it("allows the owner to batch update action counts", async function () {
		const { actionRepository, agent, owner } = await deployFixture();

		// Batch 3x action1 and 2x action2 with per-item signatures
		const actionIds = [ACTION1_ID, ACTION1_ID, ACTION1_ID, ACTION2_ID, ACTION2_ID];
		const sigs = await Promise.all(actionIds.map((aid, i) => signPetAction(owner, actionRepository.address, aid, padHex(`0x${(0x6000 + i).toString(16)}`, { size: 32 }))));
		await (actionRepository.write as any).recordActionsBatch([actionIds, sigs.map((s) => s.nonce), sigs.map((s) => s.timestamp), sigs.map((s) => s.v), sigs.map((s) => s.r), sigs.map((s) => s.s)], { account: owner.account });

		const totals = await actionRepository.read.totalActions([owner.account.address]);
		expect(totals).to.equal(5n);
	});

	it("evaluates activity ratio correctly", async function () {
		const { actionRepository, activityChecker, agent, owner } = await deployFixture();

		for (let i = 0; i < 6; i++) {
			const s = await signPetAction(owner, actionRepository.address, ACTION1_ID, padHex(`0x${(0x1000 + i).toString(16)}`, { size: 32 }));
			await actionRepository.write.recordAction([ACTION1_ID, s.nonce, s.timestamp, s.v, s.r, s.s], { account: owner.account });
		}

		const curNonces = await activityChecker.read.getMultisigNonces([owner.account.address]);
		const lastNonces = [curNonces[0] - 4n, 1n];
		const ts = 12n;

		// diff = 4 actions in 12 seconds -> 0.333 actions/sec < 0.5 requirement
		expect(await activityChecker.read.isRatioPass([curNonces, lastNonces, ts])).to.equal(false);

		const stillFailingLast = [curNonces[0] - 2n, 1n];
		const stillFailingTs = 10n; // diff = 2 actions in 10 seconds -> 0.2 actions/sec < 0.5
		expect(await activityChecker.read.isRatioPass([curNonces, stillFailingLast, stillFailingTs])).to.equal(false);

		const betterLastNonces = [curNonces[0] - 6n, 1n];
		const betterTs = 12n; // diff = 6 actions / 12 seconds = 0.5 -> meets ratio requirement
		expect(await activityChecker.read.isRatioPass([curNonces, betterLastNonces, betterTs])).to.equal(true);
	});

	it("fails the ratio check when agent inactive or throughput too low", async function () {
		const { actionRepository, activityChecker, agent, owner } = await deployFixture();

		for (let i = 0; i < 4; i++) {
			const s = await signPetAction(owner, actionRepository.address, ACTION1_ID, padHex(`0x${(0x2000 + i).toString(16)}`, { size: 32 }));
			await actionRepository.write.recordAction([ACTION1_ID, s.nonce, s.timestamp, s.v, s.r, s.s], { account: owner.account });
		}

		const curNonces = await activityChecker.read.getMultisigNonces([owner.account.address]);
		// Test with inactive agent (curNonces[1] = 0)
		const inactiveNonces = [curNonces[0], 0n];
		const refLastNonces = [curNonces[0] - 4n, 0n];
		expect(await activityChecker.read.isRatioPass([inactiveNonces, refLastNonces, 8n])).to.equal(false);
		const inactiveLast = [curNonces[0], 1n];
		expect(await activityChecker.read.isRatioPass([inactiveNonces, inactiveLast, 8n])).to.equal(false);

		// Small positive delta but overly long window keeps ratio below threshold
		const limitedLast = [curNonces[0] - 1n, 1n];
		const longWindow = 20n; // 1 action across 20 seconds < 0.5 actions/sec
		expect(await activityChecker.read.isRatioPass([curNonces, limitedLast, longWindow])).to.equal(false);
	});

	it("computes required actions for a period", async function () {
		const { activityChecker } = await deployFixture();
		const hour = 3600n;
		const required = await activityChecker.read.computeRequiredActions([hour]);
		expect(required).to.equal(1800n); // 0.5 actions/sec * 3600s
	});
});
