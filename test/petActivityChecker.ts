import { expect } from "chai";
import { network } from "hardhat";
import { padHex, stringToHex } from "viem";
import { describe, it } from "node:test";

const { viem, networkHelpers } = await network.connect();

describe("Pet staking flow", function () {
	const WALK = padHex(stringToHex("walk"), { size: 32 });
	const FEED = padHex(stringToHex("feed"), { size: 32 });

	async function deployFixture() {
		const [owner, agent, recorder] = await viem.getWalletClients();

		const actionRepository = await viem.deployContract("ActionRepository", [owner.account.address], {});

		await actionRepository.write.setRecorder([recorder.account.address, true], {
			account: owner.account,
		});

		const livenessRatio = 5n * 10n ** 17n; // 0.5 actions per second
		const minActionsPerPeriod = 3n;
		const maxInactivity = 0n; // disabled

		const activityChecker = await viem.deployContract("PetActivityChecker", [actionRepository.address, livenessRatio, minActionsPerPeriod, maxInactivity], {});

		return { actionRepository, activityChecker, owner, agent, recorder, livenessRatio, minActionsPerPeriod };
	}

	it("tracks per-action counters and totals", async function () {
		const { actionRepository, owner, agent } = await deployFixture();

		await actionRepository.write.recordAction([agent.account.address, WALK, 2n], { account: owner.account });
		await actionRepository.write.recordAction([agent.account.address, FEED, 1n], { account: owner.account });

		const walkCount = await actionRepository.read.actionCount([agent.account.address, WALK]);
		const feedCount = await actionRepository.read.actionCount([agent.account.address, FEED]);
		const total = await actionRepository.read.totalActions([agent.account.address]);

		expect(walkCount).to.equal(2n);
		expect(feedCount).to.equal(1n);
		expect(total).to.equal(3n);
	});

	it("allows authorized recorders to batch update action counts", async function () {
		const { actionRepository, agent, recorder } = await deployFixture();

		await actionRepository.write.recordActionsBatch([agent.account.address, [WALK, FEED], [3n, 2n]], { account: recorder.account });

		const totals = await actionRepository.read.totalActions([agent.account.address]);
		expect(totals).to.equal(5n);
	});

	it("evaluates activity ratio correctly", async function () {
		const { actionRepository, activityChecker, owner, agent } = await deployFixture();

		await actionRepository.write.recordAction([agent.account.address, WALK, 6n], { account: owner.account });

		const curNonces = await activityChecker.read.getMultisigNonces([agent.account.address]);
		const lastNonces = [curNonces[0] - 4n, curNonces[1] - 12n, 1n];
		const ts = 12n;

		// diff = 4 actions in 12 seconds -> 0.333 actions/sec < 0.5 requirement
		expect(await activityChecker.read.isRatioPass([curNonces, lastNonces, ts])).to.equal(false);

		const stillFailingLast = [curNonces[0] - 2n, curNonces[1] - 10n, 1n];
		const stillFailingTs = 10n; // diff = 2 actions in 10 seconds -> 0.2 actions/sec < 0.5
		expect(await activityChecker.read.isRatioPass([curNonces, stillFailingLast, stillFailingTs])).to.equal(false);

		const betterLastNonces = [curNonces[0] - 6n, curNonces[1] - 12n, 1n];
		const betterTs = 12n; // diff = 6 actions / 12 seconds = 0.5 -> meets ratio and minimum actions
		expect(await activityChecker.read.isRatioPass([curNonces, betterLastNonces, betterTs])).to.equal(true);
	});

	it("fails the ratio check when activity flag is false or agent idle", async function () {
		const { actionRepository, activityChecker, owner, agent } = await deployFixture();

		await actionRepository.write.recordAction([agent.account.address, WALK, 4n], { account: owner.account });

		// Mark agent inactive
		await actionRepository.write.setAgentStatus([agent.account.address, false], {
			account: agent.account,
		});

		let curNonces = await activityChecker.read.getMultisigNonces([agent.account.address]);
		const refLastNonces = [curNonces[0] - 4n, curNonces[1] - 8n, 0n];
		expect(await activityChecker.read.isRatioPass([curNonces, refLastNonces, 8n])).to.equal(false);

		// Reactivate and advance time enough to violate inactivity limit by redeploying with maxInactivity
		const maxInactivity = 5n;
		const newChecker = await viem.deployContract("PetActivityChecker", [actionRepository.address, 10n ** 17n, 1n, maxInactivity], {});

		await actionRepository.write.setAgentStatus([agent.account.address, true], {
			account: owner.account,
		});

		await networkHelpers.time.increase(Number(maxInactivity + 1n));

		curNonces = await newChecker.read.getMultisigNonces([agent.account.address]);
		const lastNonces = [curNonces[0] - 1n, curNonces[1] - (maxInactivity + 1n), 1n];

		expect(await newChecker.read.isRatioPass([curNonces, lastNonces, maxInactivity + 1n])).to.equal(false);
	});

	it("computes required actions for a period", async function () {
		const { activityChecker } = await deployFixture();
		const hour = 3600n;
		const required = await activityChecker.read.computeRequiredActions([hour]);
		expect(required).to.equal(1800n); // 0.5 actions/sec * 3600s
	});
});
