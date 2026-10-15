/**
 * @file SuperGoodDollar pause and blocklist agreement guards on a Celo mainnet fork
 *
 * The local Superfluid test framework has no GDA, so the GDA side of the guards is tested
 * against the live Celo deployment: the G$ proxy is upgraded to the current logic, and the
 * test creates its own pools and flows.
 *
 * Run: npx hardhat test test/token/SuperGoodDollar.celofork.test.ts
 * Note: forks Celo mainnet, needs network access (CELO_RPC_URL, CELO_FORK_BLOCK optional)
 */
import { ethers } from "hardhat";
import { expect } from "chai";
import * as networkHelpers from "@nomicfoundation/hardhat-network-helpers";
import deployments from "../../releases/deployment.json";
import { getSuperGoodDollarFactory } from "../helpers";

const CELO_MAINNET_RPC = process.env.CELO_RPC_URL || "https://forno.celo.org";
// see BuyGDClone.test.ts. Celo has 1s blocks and this suite runs for minutes, so fork far enough
// back that the fork block never crosses the 128 block state window of non-archive RPC nodes
const CELO_FORK_BLOCK_LAG = 1000;
const GDA_FORWARDER = "0x6DA13Bde224A05a288748d857b9e7DDEffd1dE08";
const CFA_FORWARDER = "0xcfA132E353cB4E398080B9700609bb008eceB125";
const { GoodDollar: GOODDOLLAR, Avatar: AVATAR } = deployments["production-celo"];

const gdaForwarderAbi = [
  "function createPool(address token, address admin, (bool,bool) config) returns (bool, address)",
  "function connectPool(address pool, bytes userData) returns (bool)",
  "function distribute(address token, address from, address pool, uint256 amount, bytes userData) returns (bool)",
  "function distributeFlow(address token, address from, address pool, int96 flowRate, bytes userData) returns (bool)",
  "function getFlowDistributionFlowRate(address token, address from, address to) view returns (int96)"
];
const cfaForwarderAbi = [
  "function setFlowrate(address token, address receiver, int96 flowrate) returns (bool)",
  "function getFlowrate(address token, address sender, address receiver) view returns (int96)"
];
const poolAbi = [
  "function updateMemberUnits(address member, uint128 units) returns (bool)",
  "function getClaimableNow(address member) view returns (int256 claimable, uint256 timestamp)",
  "function claimAll(address member) returns (bool)"
];

const flowRate = ethers.utils.parseEther("1").div(3600); // ~1 G$ an hour
const tenDollars = ethers.utils.parseEther("10");
const tx = { gasLimit: 3000000 };
// transferabilityForUnitsOwner, distributionFromAnyAddress
const poolConfig = [false, true];

describe("SuperGoodDollar - Celo fork agreement guards", function () {
  this.timeout(600000);
  let gd, gdaForwarder, cfaForwarder, owner, alice, bob, carol, dave, eve;

  before(async function () {
    const forkBlock = process.env.CELO_FORK_BLOCK
      ? parseInt(process.env.CELO_FORK_BLOCK, 10)
      : (await new ethers.providers.JsonRpcProvider(CELO_MAINNET_RPC).getBlockNumber()) - CELO_FORK_BLOCK_LAG;
    await networkHelpers.reset(CELO_MAINNET_RPC, forkBlock);
    [owner, alice, bob, carol, dave, eve] = await ethers.getSigners();
    gd = await ethers.getContractAt("SuperGoodDollar", GOODDOLLAR);
    gdaForwarder = await ethers.getContractAt(gdaForwarderAbi, GDA_FORWARDER);
    cfaForwarder = await ethers.getContractAt(cfaForwarderAbi, CFA_FORWARDER);
  });

  after(async function () {
    await networkHelpers.reset();
  });

  // G$ upgraded to the current logic, alice and bob funded, a pool with carol (connected)
  // and dave (not connected) as members
  async function upgraded() {
    await networkHelpers.setBalance(AVATAR, ethers.utils.parseEther("10"));
    const avatar = await ethers.getImpersonatedSigner(AVATAR);
    const logic = await (await getSuperGoodDollarFactory()).deploy(await gd.getHost());
    await gd.connect(avatar).updateCode(logic.address);
    await gd.connect(avatar).grantRole(await gd.MINTER_ROLE(), owner.address);
    await gd.connect(avatar).grantRole(await gd.PAUSER_ROLE(), owner.address);
    for (const account of [alice, bob]) {
      await gd.mint(account.address, ethers.utils.parseEther("1000"));
    }

    const [, poolAddress] = await gdaForwarder.callStatic.createPool(GOODDOLLAR, owner.address, poolConfig);
    await gdaForwarder.createPool(GOODDOLLAR, owner.address, poolConfig);
    const pool = await ethers.getContractAt(poolAbi, poolAddress);
    await pool.updateMemberUnits(carol.address, 1);
    await pool.updateMemberUnits(dave.address, 1);
    await gdaForwarder.connect(carol).connectPool(pool.address, "0x");
    return { avatar, pool };
  }

  const distributeFlow = (signer, pool, rate) =>
    gdaForwarder.connect(signer).distributeFlow(GOODDOLLAR, signer.address, pool.address, rate, "0x", tx);
  const distribute = (signer, pool, amount) =>
    gdaForwarder.connect(signer).distribute(GOODDOLLAR, signer.address, pool.address, amount, "0x", tx);
  const poolFlowRate = (from, pool) => gdaForwarder.getFlowDistributionFlowRate(GOODDOLLAR, from.address, pool.address);

  it("pool flows, distributions and claims work after the upgrade", async function () {
    const { pool } = await networkHelpers.loadFixture(upgraded);
    await distributeFlow(alice, pool, flowRate);
    const carolBefore = await gd.balanceOf(carol.address);
    await networkHelpers.time.increase(3600);
    expect(await gd.balanceOf(carol.address)).gt(carolBefore);

    await distribute(alice, pool, tenDollars);
    const [claimable] = await pool.getClaimableNow(dave.address);
    expect(claimable).gt(0);
    await pool.claimAll(dave.address);
    expect(await gd.balanceOf(dave.address)).gte(claimable);
  });

  it("paused: can not open or increase a pool flow, can decrease and close it", async function () {
    const { pool } = await networkHelpers.loadFixture(upgraded);
    await distributeFlow(alice, pool, flowRate);
    await gd.pause();

    await expect(distributeFlow(alice, pool, flowRate.mul(2))).revertedWithCustomError(gd, "SUPER_GOODDOLLAR_PAUSED");
    await expect(distributeFlow(bob, pool, flowRate)).revertedWithCustomError(gd, "SUPER_GOODDOLLAR_PAUSED");

    const rateBefore = await poolFlowRate(alice, pool);
    await distributeFlow(alice, pool, flowRate.div(2));
    const rateAfter = await poolFlowRate(alice, pool);
    expect(rateAfter).gt(0);
    expect(rateAfter).lt(rateBefore);

    await distributeFlow(alice, pool, 0);
    expect(await poolFlowRate(alice, pool)).equal(0);
  });

  it("paused: no instant distributions, and pools can not pay claims", async function () {
    const { pool } = await networkHelpers.loadFixture(upgraded);
    await distribute(alice, pool, tenDollars);
    await gd.pause();

    await expect(distribute(alice, pool, tenDollars)).revertedWithCustomError(gd, "SUPER_GOODDOLLAR_PAUSED");
    await expect(pool.claimAll(dave.address, tx)).revertedWithCustomError(gd, "SUPER_GOODDOLLAR_PAUSED");
  });

  it("paused: a critical pool distributor can be liquidated", async function () {
    const { pool } = await networkHelpers.loadFixture(upgraded);
    await gd.mint(eve.address, ethers.utils.parseEther("100"));
    await distributeFlow(eve, pool, flowRate);
    const [available] = await gd.realtimeBalanceOfNow(eve.address);
    // just past critical, the buffer still covers it
    await networkHelpers.time.increase(available.div(await poolFlowRate(eve, pool)).add(60));
    expect(await gd.isAccountCriticalNow(eve.address)).equal(true);
    await gd.pause();

    await gdaForwarder.connect(owner).distributeFlow(GOODDOLLAR, eve.address, pool.address, 0, "0x", tx);
    expect(await poolFlowRate(eve, pool)).equal(0);
  });

  it("paused: pools can still be created and units updated", async function () {
    const { pool } = await networkHelpers.loadFixture(upgraded);
    await gd.pause();

    await gdaForwarder.createPool(GOODDOLLAR, owner.address, poolConfig);
    await pool.updateMemberUnits(eve.address, 1);
  });

  it("blocked distributor can not open or increase a pool flow, nor distribute, but can close", async function () {
    const { avatar, pool } = await networkHelpers.loadFixture(upgraded);
    await distributeFlow(alice, pool, flowRate);
    await gd.connect(avatar).setBlocked([alice.address, bob.address], true);

    await expect(distributeFlow(alice, pool, flowRate.mul(2))).revertedWithCustomError(gd, "SUPER_GOODDOLLAR_BLOCKED");
    await expect(distributeFlow(bob, pool, flowRate)).revertedWithCustomError(gd, "SUPER_GOODDOLLAR_BLOCKED");
    await expect(distribute(alice, pool, tenDollars)).revertedWithCustomError(gd, "SUPER_GOODDOLLAR_BLOCKED");

    await distributeFlow(alice, pool, 0);
    expect(await poolFlowRate(alice, pool)).equal(0);
  });

  it("blocked distributor can decrease an accrued GDA flow; unblocking restores distribution", async function () {
    const { avatar, pool } = await networkHelpers.loadFixture(upgraded);
    await distributeFlow(alice, pool, flowRate);
    await networkHelpers.time.increase(3600);
    await gd.connect(avatar).setBlocked([alice.address], true);
    const before = await poolFlowRate(alice, pool);
    await distributeFlow(alice, pool, flowRate.div(2));
    expect(await poolFlowRate(alice, pool)).lt(before);
    expect(await poolFlowRate(alice, pool)).gt(0);
    await distributeFlow(alice, pool, 0);
    await gd.connect(avatar).setBlocked([alice.address], false);
    await distribute(alice, pool, tenDollars);
    await distributeFlow(alice, pool, flowRate);
    expect(await poolFlowRate(alice, pool)).gt(0);
  });

  it("blocked GDA pool can not pay a pending claim; unblocking restores claims", async function () {
    const { avatar, pool } = await networkHelpers.loadFixture(upgraded);
    await distribute(alice, pool, tenDollars);
    const [claimable] = await pool.getClaimableNow(dave.address);
    expect(claimable).gt(0);
    await gd.connect(avatar).setBlocked([pool.address], true);
    const before = await gd.balanceOf(dave.address);
    await expect(pool.claimAll(dave.address, tx)).revertedWithCustomError(gd, "SUPER_GOODDOLLAR_BLOCKED");
    expect(await gd.balanceOf(dave.address)).equal(before);
    await gd.connect(avatar).setBlocked([pool.address], false);
    await pool.claimAll(dave.address, tx);
    expect(await gd.balanceOf(dave.address)).equal(before.add(claimable));
  });

  it("blocked critical GDA distributor can still be liquidated", async function () {
    const { avatar, pool } = await networkHelpers.loadFixture(upgraded);
    await gd.mint(eve.address, ethers.utils.parseEther("100"));
    await distributeFlow(eve, pool, flowRate);
    const [available] = await gd.realtimeBalanceOfNow(eve.address);
    await networkHelpers.time.increase(available.div(await poolFlowRate(eve, pool)).add(60));
    expect(await gd.isAccountCriticalNow(eve.address)).equal(true);
    await gd.connect(avatar).setBlocked([eve.address], true);
    await gdaForwarder.connect(owner).distributeFlow(GOODDOLLAR, eve.address, pool.address, 0, "0x", tx);
    expect(await poolFlowRate(eve, pool)).equal(0);
  });

  it("CFA: blocked sender can not open a stream, nothing opens while paused, closing works", async function () {
    const { avatar } = await networkHelpers.loadFixture(upgraded);
    await cfaForwarder.connect(alice).setFlowrate(GOODDOLLAR, carol.address, flowRate, tx);
    await gd.connect(avatar).setBlocked([alice.address], true);

    await expect(
      cfaForwarder.connect(alice).setFlowrate(GOODDOLLAR, dave.address, flowRate, tx)
    ).revertedWithCustomError(gd, "SUPER_GOODDOLLAR_BLOCKED");

    await gd.pause();
    await expect(cfaForwarder.connect(bob).setFlowrate(GOODDOLLAR, dave.address, flowRate, tx)).revertedWithCustomError(
      gd,
      "SUPER_GOODDOLLAR_PAUSED"
    );

    await cfaForwarder.connect(alice).setFlowrate(GOODDOLLAR, carol.address, 0, tx);
    expect(await cfaForwarder.getFlowrate(GOODDOLLAR, alice.address, carol.address)).equal(0);
  });
});
