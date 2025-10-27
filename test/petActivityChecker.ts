import { expect } from "chai";
import { network } from "hardhat";
import { padHex, stringToHex } from "viem";
import { describe, it } from "node:test";

const { viem } = await network.connect();

describe("Pet staking flow", function () {
	const WALK = padHex(stringToHex("walk"), { size: 32 });
	const FEED = padHex(stringToHex("feed"), { size: 32 });

	async function deployFixture() {
		const [owner, agent] = await viem.getWalletClients();

		const actionRepository = await viem.deployContract("ActionRepository", [owner.account.address], {});

		const livenessRatio = 5n * 10n ** 17n; // 0.5 actions per second

		const activityChecker = await viem.deployContract("PetActivityChecker", [actionRepository.address, livenessRatio, owner.account.address], {});

		return { actionRepository, activityChecker, owner, agent, livenessRatio };
	}

	it("tracks per-action counters and totals", async function () {
		const { actionRepository, agent, owner } = await deployFixture();

		await actionRepository.write.recordAction([WALK, 2n], { account: owner.account });
		await actionRepository.write.recordAction([FEED, 1n], { account: owner.account });

		const walkCount = await actionRepository.read.actionCount([owner.account.address, WALK]);
		const feedCount = await actionRepository.read.actionCount([owner.account.address, FEED]);
		const total = await actionRepository.read.totalActions([owner.account.address]);

		expect(walkCount).to.equal(2n);
		expect(feedCount).to.equal(1n);
		expect(total).to.equal(3n);
	});

	it("allows the owner to batch update action counts", async function () {
		const { actionRepository, agent, owner } = await deployFixture();

		await actionRepository.write.recordActionsBatch(
			[
				[WALK, FEED],
				[3n, 2n],
			],
			{ account: owner.account }
		);

		const totals = await actionRepository.read.totalActions([owner.account.address]);
		expect(totals).to.equal(5n);
	});

	it("evaluates activity ratio correctly", async function () {
		const { actionRepository, activityChecker, agent, owner } = await deployFixture();

		await actionRepository.write.recordAction([WALK, 6n], { account: owner.account });

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

		await actionRepository.write.recordAction([WALK, 4n], { account: owner.account });

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
