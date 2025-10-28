import { expect } from "chai";
import { network } from "hardhat";
import { padHex, stringToHex } from "viem";
import { describe, it } from "node:test";

const { viem } = await network.connect();

describe.skip("ActionRepository (legacy direct record)", function () {
	const WALK = padHex(stringToHex("walk"), { size: 32 });
	const FEED = padHex(stringToHex("feed"), { size: 32 });
	const PLAY = padHex(stringToHex("play"), { size: 32 });

	async function deployFixture() {
		const [owner, agent1, agent2] = await viem.getWalletClients();

		const actionRepository = await viem.deployContract("ActionRepository", [owner.account.address, owner.account.address] as any, {});

		return { actionRepository, owner, agent1, agent2 };
	}

	describe("recordAction", function () {
		it("should record a single action successfully", async function () {
			const { actionRepository, agent1 } = await deployFixture();

			const result = await actionRepository.write.recordAction([WALK, 5n], { account: agent1.account });
			expect(result).to.be.a("string");

			const actionCount = await actionRepository.read.actionCount([agent1.account.address, WALK]);
			const totalActions = await actionRepository.read.totalActions([agent1.account.address]);
			const lastActionTimestamp = await actionRepository.read.lastActionTimestamp([agent1.account.address]);
			const isActive = await actionRepository.read.isAgentActive([agent1.account.address]);

			expect(actionCount).to.equal(5n);
			expect(totalActions).to.equal(5n);
			expect(Number(lastActionTimestamp)).to.be.greaterThan(0);
			expect(isActive).to.equal(true);
		});

		it("should accumulate actions of the same type", async function () {
			const { actionRepository, agent1 } = await deployFixture();

			await actionRepository.write.recordAction([WALK, 3n], { account: agent1.account });
			await actionRepository.write.recordAction([WALK, 2n], { account: agent1.account });

			const actionCount = await actionRepository.read.actionCount([agent1.account.address, WALK]);
			const totalActions = await actionRepository.read.totalActions([agent1.account.address]);

			expect(actionCount).to.equal(5n);
			expect(totalActions).to.equal(5n);
		});

		it("should track different action types separately", async function () {
			const { actionRepository, agent1 } = await deployFixture();

			await actionRepository.write.recordAction([WALK, 3n], { account: agent1.account });
			await actionRepository.write.recordAction([FEED, 2n], { account: agent1.account });
			await actionRepository.write.recordAction([PLAY, 1n], { account: agent1.account });

			const walkCount = await actionRepository.read.actionCount([agent1.account.address, WALK]);
			const feedCount = await actionRepository.read.actionCount([agent1.account.address, FEED]);
			const playCount = await actionRepository.read.actionCount([agent1.account.address, PLAY]);
			const totalActions = await actionRepository.read.totalActions([agent1.account.address]);

			expect(walkCount).to.equal(3n);
			expect(feedCount).to.equal(2n);
			expect(playCount).to.equal(1n);
			expect(totalActions).to.equal(6n);
		});

		it("should revert when amount is zero", async function () {
			const { actionRepository, agent1 } = await deployFixture();

			try {
				await actionRepository.write.recordAction([WALK, 0n], { account: agent1.account });
				expect.fail("Expected transaction to revert");
			} catch (error) {
				expect((error as any).message).to.include("ZeroAmount");
			}
		});

		it("should emit ActionRecorded event", async function () {
			const { actionRepository, agent1 } = await deployFixture();

			const tx = await actionRepository.write.recordAction([WALK, 5n], { account: agent1.account });
			// Note: Event verification would require more complex setup with proper viem client
			// For now, we just verify the transaction was successful
			expect(tx).to.be.a("string");
		});
	});

	describe("recordActionsBatch", function () {
		it("should record multiple action types in a single call", async function () {
			const { actionRepository, agent1 } = await deployFixture();

			const actionTypes = [WALK, FEED, PLAY];
			const amounts = [3n, 2n, 1n];

			await actionRepository.write.recordActionsBatch([actionTypes, amounts], { account: agent1.account });

			const walkCount = await actionRepository.read.actionCount([agent1.account.address, WALK]);
			const feedCount = await actionRepository.read.actionCount([agent1.account.address, FEED]);
			const playCount = await actionRepository.read.actionCount([agent1.account.address, PLAY]);
			const totalActions = await actionRepository.read.totalActions([agent1.account.address]);

			expect(walkCount).to.equal(3n);
			expect(feedCount).to.equal(2n);
			expect(playCount).to.equal(1n);
			expect(totalActions).to.equal(6n);
		});

		it("should revert when array lengths don't match", async function () {
			const { actionRepository, agent1 } = await deployFixture();

			const actionTypes = [WALK, FEED];
			const amounts = [3n, 2n, 1n]; // Different length

			try {
				await actionRepository.write.recordActionsBatch([actionTypes, amounts], { account: agent1.account });
				expect.fail("Expected transaction to revert");
			} catch (error) {
				expect((error as any).message).to.include("ArrayLengthMismatch");
			}
		});

		it("should revert when any amount is zero", async function () {
			const { actionRepository, agent1 } = await deployFixture();

			const actionTypes = [WALK, FEED];
			const amounts = [3n, 0n]; // One amount is zero

			try {
				await actionRepository.write.recordActionsBatch([actionTypes, amounts], { account: agent1.account });
				expect.fail("Expected transaction to revert");
			} catch (error) {
				expect((error as any).message).to.include("ZeroAmount");
			}
		});

		it("should not update state when all amounts are zero", async function () {
			const { actionRepository, agent1 } = await deployFixture();

			// First record some actions
			await actionRepository.write.recordAction([WALK, 5n], { account: agent1.account });
			const initialTotal = await actionRepository.read.totalActions([agent1.account.address]);

			// Try to record batch with zero amounts (this should revert)
			const actionTypes = [WALK, FEED];
			const amounts = [0n, 0n];

			try {
				await actionRepository.write.recordActionsBatch([actionTypes, amounts], { account: agent1.account });
				expect.fail("Expected transaction to revert");
			} catch (error) {
				expect(error.message).to.include("ZeroAmount");
			}

			// Verify state wasn't changed
			const finalTotal = await actionRepository.read.totalActions([agent1.account.address]);
			expect(finalTotal).to.equal(initialTotal);
		});
	});

	describe("totalActions", function () {
		it("should return zero for new agent", async function () {
			const { actionRepository, agent1 } = await deployFixture();

			const total = await actionRepository.read.totalActions([agent1.account.address]);
			expect(total).to.equal(0n);
		});

		it("should return correct total after multiple actions", async function () {
			const { actionRepository, agent1 } = await deployFixture();

			await actionRepository.write.recordAction([WALK, 3n], { account: agent1.account });
			await actionRepository.write.recordAction([FEED, 2n], { account: agent1.account });
			await actionRepository.write.recordAction([WALK, 1n], { account: agent1.account });

			const total = await actionRepository.read.totalActions([agent1.account.address]);
			expect(total).to.equal(6n);
		});

		it("should work with msg.sender overload", async function () {
			const { actionRepository, agent1 } = await deployFixture();

			await actionRepository.write.recordAction([WALK, 5n], { account: agent1.account });

			const total = await (actionRepository.read as any).totalActions([], { account: agent1.account });
			expect(total).to.equal(5n);
		});
	});

	describe("actionCount", function () {
		it("should return zero for new action type", async function () {
			const { actionRepository, agent1 } = await deployFixture();

			const count = await actionRepository.read.actionCount([agent1.account.address, WALK]);
			expect(count).to.equal(0n);
		});

		it("should return correct count for specific action type", async function () {
			const { actionRepository, agent1 } = await deployFixture();

			await actionRepository.write.recordAction([WALK, 3n], { account: agent1.account });
			await actionRepository.write.recordAction([FEED, 2n], { account: agent1.account });
			await actionRepository.write.recordAction([WALK, 1n], { account: agent1.account });

			const walkCount = await actionRepository.read.actionCount([agent1.account.address, WALK]);
			const feedCount = await actionRepository.read.actionCount([agent1.account.address, FEED]);

			expect(walkCount).to.equal(4n);
			expect(feedCount).to.equal(2n);
		});

		it("should work with msg.sender overload", async function () {
			const { actionRepository, agent1 } = await deployFixture();

			await actionRepository.write.recordAction([WALK, 5n], { account: agent1.account });

			const count = await actionRepository.read.actionCount([WALK], { account: agent1.account });
			expect(count).to.equal(5n);
		});
	});

	describe("lastActionTimestamp", function () {
		it("should return zero for new agent", async function () {
			const { actionRepository, agent1 } = await deployFixture();

			const timestamp = await actionRepository.read.lastActionTimestamp([agent1.account.address]);
			expect(timestamp).to.equal(0n);
		});

		it("should update timestamp when action is recorded", async function () {
			const { actionRepository, agent1 } = await deployFixture();

			const beforeTime = BigInt(Math.floor(Date.now() / 1000));
			await actionRepository.write.recordAction([WALK, 1n], { account: agent1.account });
			const afterTime = BigInt(Math.floor(Date.now() / 1000)) + 60n; // Add 60 second buffer

			const timestamp = await actionRepository.read.lastActionTimestamp([agent1.account.address]);
			expect(Number(timestamp)).to.be.greaterThanOrEqual(Number(beforeTime));
			expect(Number(timestamp)).to.be.lessThanOrEqual(Number(afterTime));
		});

		it("should work with msg.sender overload", async function () {
			const { actionRepository, agent1 } = await deployFixture();

			await actionRepository.write.recordAction([WALK, 1n], { account: agent1.account });

			const timestamp = await (actionRepository.read as any).lastActionTimestamp([], { account: agent1.account });
			expect(Number(timestamp)).to.be.greaterThan(0);
		});
	});

	describe("isAgentActive", function () {
		it("should return false for new agent", async function () {
			const { actionRepository, agent1 } = await deployFixture();

			const isActive = await actionRepository.read.isAgentActive([agent1.account.address]);
			expect(isActive).to.equal(false);
		});

		it("should return true after recording action", async function () {
			const { actionRepository, agent1 } = await deployFixture();

			await actionRepository.write.recordAction([WALK, 1n], { account: agent1.account });

			const isActive = await actionRepository.read.isAgentActive([agent1.account.address]);
			expect(isActive).to.equal(true);
		});

		it("should work with msg.sender overload", async function () {
			const { actionRepository, agent1 } = await deployFixture();

			await actionRepository.write.recordAction([WALK, 1n], { account: agent1.account });

			const isActive = await (actionRepository.read as any).isAgentActive([], { account: agent1.account });
			expect(isActive).to.equal(true);
		});
	});

	describe("multiple agents", function () {
		it("should track actions independently for different agents", async function () {
			const { actionRepository, agent1, agent2 } = await deployFixture();

			await actionRepository.write.recordAction([WALK, 3n], { account: agent1.account });
			await actionRepository.write.recordAction([WALK, 2n], { account: agent2.account });

			const agent1WalkCount = await actionRepository.read.actionCount([agent1.account.address, WALK]);
			const agent2WalkCount = await actionRepository.read.actionCount([agent2.account.address, WALK]);
			const agent1Total = await actionRepository.read.totalActions([agent1.account.address]);
			const agent2Total = await actionRepository.read.totalActions([agent2.account.address]);

			expect(agent1WalkCount).to.equal(3n);
			expect(agent2WalkCount).to.equal(2n);
			expect(agent1Total).to.equal(3n);
			expect(agent2Total).to.equal(2n);
		});

		it("should maintain separate active status for different agents", async function () {
			const { actionRepository, agent1, agent2 } = await deployFixture();

			await actionRepository.write.recordAction([WALK, 1n], { account: agent1.account });

			const agent1Active = await actionRepository.read.isAgentActive([agent1.account.address]);
			const agent2Active = await actionRepository.read.isAgentActive([agent2.account.address]);

			expect(agent1Active).to.equal(true);
			expect(agent2Active).to.equal(false);
		});
	});

	describe("edge cases", function () {
		it("should handle large amounts", async function () {
			const { actionRepository, agent1 } = await deployFixture();

			const largeAmount = 2n ** 100n; // Very large number
			await actionRepository.write.recordAction([WALK, largeAmount], { account: agent1.account });

			const count = await actionRepository.read.actionCount([agent1.account.address, WALK]);
			expect(count).to.equal(largeAmount);
		});

		it("should handle empty batch arrays", async function () {
			const { actionRepository, agent1 } = await deployFixture();

			// Empty arrays should succeed but return 0 total added
			const result = await actionRepository.write.recordActionsBatch([[], []], { account: agent1.account });
			expect(result).to.be.a("string");

			// Verify no actions were recorded
			const totalActions = await actionRepository.read.totalActions([agent1.account.address]);
			expect(totalActions).to.equal(0n);
		});
	});
});

// New EIP-712 verified-only tests
import type { WalletClient } from "viem";

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
	return { v, r, s, nonce: msgNonce, timestamp: msgTimestamp, signerAddress: walletClient.account!.address };
}

describe("ActionRepository (verified-only)", function () {
	const ACTION1_ID = 1;
	const ACTION2_ID = 2;
	const ACTION1_TYPE = padHex("0x01", { size: 32 });
	const ACTION2_TYPE = padHex("0x02", { size: 32 });

	async function deployFixture() {
		const [owner, agent1, agent2] = await viem.getWalletClients();
		// Set main signer to agent1 for verified action tests
		const actionRepository = await viem.deployContract("ActionRepository", [owner.account.address, agent1.account.address], {});
		return { actionRepository, owner, agent1, agent2 };
	}

	it("recordAction increments for caller with valid signature", async function () {
		const { actionRepository, agent1, agent2 } = await deployFixture();
		// mainSigner is agent1; caller will be agent2
		const signed = await signPetAction(agent1, actionRepository.address, ACTION1_ID);
		await actionRepository.write.recordAction([ACTION1_ID, signed.nonce, signed.timestamp, signed.v, signed.r, signed.s], { account: agent2.account });
		const count = await actionRepository.read.actionCount([agent2.account.address, ACTION1_TYPE]);
		const total = await actionRepository.read.totalActions([agent2.account.address]);
		expect(count).to.equal(1n);
		expect(total).to.equal(1n);
	});

	it("recordAction rejects invalid signer", async function () {
		const [owner, wrongSigner, caller] = await viem.getWalletClients();
		// Deploy with mainSigner set to owner
		const actionRepository = await viem.deployContract("ActionRepository", [owner.account.address, owner.account.address], {});
		// Sign with wrongSigner instead of mainSigner (owner)
		const s = await signPetAction(wrongSigner, actionRepository.address, ACTION1_ID);
		try {
			await actionRepository.write.recordAction([ACTION1_ID, s.nonce, s.timestamp, s.v, s.r, s.s], { account: caller.account });
			expect.fail("Expected InvalidSignature");
		} catch (e: any) {
			expect(e.message).to.include("InvalidSignature");
		}
	});

	it("recordActionsBatch increments for caller with valid signature", async function () {
		const { actionRepository, agent1, agent2 } = await deployFixture();
		const actionIds = [ACTION1_ID, ACTION2_ID];
		// Sign using the first action id (contract verifies against actionIds[0])
		const signed = await signPetAction(agent1, actionRepository.address, actionIds[0]);
		await actionRepository.write.recordActionsBatch([actionIds, signed.nonce, signed.timestamp, signed.v, signed.r, signed.s], { account: agent2.account });
		const c1 = await actionRepository.read.actionCount([agent2.account.address, ACTION1_TYPE]);
		const c2 = await actionRepository.read.actionCount([agent2.account.address, ACTION2_TYPE]);
		const total = await actionRepository.read.totalActions([agent2.account.address]);
		expect(c1).to.equal(1n);
		expect(c2).to.equal(1n);
		expect(total).to.equal(2n);
	});

	it("updates lastActionTimestamp via verified action", async function () {
		const { actionRepository, agent1 } = await deployFixture();
		const before = BigInt(Math.floor(Date.now() / 1000));
		const s = await signPetAction(agent1, actionRepository.address, ACTION1_ID);
		await actionRepository.write.recordAction([ACTION1_ID, s.nonce, s.timestamp, s.v, s.r, s.s], { account: agent1.account });
		const after = BigInt(Math.floor(Date.now() / 1000)) + 60n;
		const ts = await actionRepository.read.lastActionTimestamp([agent1.account.address]);
		expect(Number(ts)).to.be.greaterThanOrEqual(Number(before));
		expect(Number(ts)).to.be.lessThanOrEqual(Number(after));
	});
});
