import { expect } from "chai";
import { network } from "hardhat";
import { padHex, stringToHex } from "viem";
import { describe, it } from "node:test";

const { viem } = await network.connect();

// (removed legacy direct record tests)

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
		const sig1 = await signPetAction(agent1, actionRepository.address, actionIds[0], padHex("0x5001", { size: 32 }));
		const sig2 = await signPetAction(agent1, actionRepository.address, actionIds[1], padHex("0x5002", { size: 32 }));
		await (actionRepository.write as any).recordActionsBatch([actionIds, [sig1.nonce, sig2.nonce], [sig1.timestamp, sig2.timestamp], [sig1.v, sig2.v], [sig1.r, sig2.r], [sig1.s, sig2.s]], { account: agent2.account });
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
