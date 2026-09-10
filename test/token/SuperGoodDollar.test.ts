import hre, { ethers } from "hardhat";
import { assert, expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Framework } from "@superfluid-finance/sdk-core";
import TransferAndCallMockABI from "@gooddollar/goodcontracts/build/contracts/TransferAndCallMock.json";
import { createDAO, deploySuperGoodDollar } from "../helpers";
import { ISuperGoodDollar } from "../../types";

let sf,
  sfHost,
  founder,
  alice,
  bob,
  eve,
  newHost,
  identityMock,
  receiverMock,
  sgd: ISuperGoodDollar, // stands for "SuperGoodDollar"
  feesFormula10PctMock;

const alotOfDollars = ethers.utils.parseEther("100000");
const tenDollars = ethers.utils.parseEther("10");
const oneDollar = ethers.utils.parseEther("1");
const tenDollarsPerDay = "124378109452730"; // flowrate per second

const initialState = async () => {};

describe("SuperGoodDollar", async function () {
  before(async function () {
    [founder, alice, bob, eve, newHost] = await ethers.getSigners();

    let { sfContracts } = await createDAO();

    sfHost = sfContracts.host;
    sf = await Framework.create({
      chainId: 4447,
      provider: ethers.provider,
      resolverAddress: sfContracts.resolver,
      protocolReleaseVersion: "test"
    });

    const FeesFormulaMockFactory = await ethers.getContractFactory(
      "FeesFormulaMock",
      founder
    );

    const feesFormula0PctMock = await FeesFormulaMockFactory.deploy(0);

    feesFormula10PctMock = await FeesFormulaMockFactory.deploy(100000);

    const IdentityMockFactory = await ethers.getContractFactory(
      "IdentityMock",
      founder
    );
    identityMock = await IdentityMockFactory.deploy(
      "0x0000000000000000000000000000000000000000"
    );

    receiverMock = await new ethers.ContractFactory(
      TransferAndCallMockABI.abi,
      TransferAndCallMockABI.bytecode,
      founder
    ).deploy();

    console.log("deploying test supergooddollar...");
    sgd = (await deploySuperGoodDollar(sfContracts, [
      "SuperGoodDollar",
      "SGD",
      0,
      feesFormula0PctMock.address,
      identityMock.address,
      receiverMock.address,
      founder.address
    ])) as ISuperGoodDollar;

    await sgd.mint(founder.address, alotOfDollars);
  });

  it("check superfluid host", async () => {
    expect(await sgd.getHost()).equal(sfHost);
  });

  it("check ERC20 metadata", async function () {
    await loadFixture(initialState);
    const symbol = await sgd.symbol();
    const name = await sgd.name();
    assert.equal(symbol, "SGD", "symbol mismatch");
    assert.equal(name, "SuperGoodDollar", "name mismatch");
  });

  it("mint to alice", async function () {
    await loadFixture(initialState);
    await sgd.mint(alice.address, alotOfDollars);
    const balAfter = await sgd.balanceOf(alice.address);

    assert.equal(
      balAfter.toString(),
      alotOfDollars.toString(),
      "wrong balance after mint"
    );
  });

  it("do ERC20 transfer", async function () {
    await loadFixture(initialState);
    await sgd.mint(alice.address, tenDollars);
    await sgd.connect(alice).transfer(bob.address, tenDollars);
    const balAfter = await sgd.balanceOf(bob.address);

    assert.equal(
      balAfter.toString(),
      tenDollars.toString(),
      "wrong balance after transfer"
    );
  });

  it("do ERC20 transferFrom", async function () {
    await loadFixture(initialState);
    await sgd.approve(alice.address, tenDollars);
    await sgd
      .connect(alice)
      .transferFrom(founder.address, bob.address, tenDollars);
    assert.equal(
      (await sgd.balanceOf(bob.address)).toString(),
      tenDollars.toString(),
      "wrong balance after transferFrom"
    );
  });

  it("start stream", async function () {
    await loadFixture(initialState);
    await sgd.mint(alice.address, alotOfDollars);

    await sf.cfaV1
      .createFlow({
        superToken: sgd.address,
        sender: alice.address,
        receiver: bob.address,
        flowRate: tenDollarsPerDay
      })
      .exec(alice);

    const bobNetFlow = await sf.cfaV1.getNetFlow({
      superToken: sgd.address,
      account: bob.address,
      providerOrSigner: ethers.provider
    });

    assert.equal(
      bobNetFlow,
      tenDollarsPerDay,
      "bob net flowrate not as expected"
    );
  });

  it("pauseable", async function () {
    await loadFixture(initialState);
    await sgd.connect(founder).pause();

    await expect(sgd.transfer(bob.address, tenDollars)).revertedWithCustomError(
      sgd,
      "SUPER_GOODDOLLAR_PAUSED"
    );

    await expect(
      sf.cfaV1
        .createFlow({
          superToken: sgd.address,
          sender: alice.address,
          receiver: bob.address,
          flowRate: tenDollarsPerDay,
          overrides: { gasLimit: 1000000 }
        })
        .exec(alice)
    ).reverted; // createflow should revert when paused

    await sgd.connect(founder).unpause();

    await sgd.transfer(bob.address, tenDollars);
  });

  it("adminBurn destroys illegitimate funds and reduces total supply", async function () {
    await loadFixture(initialState);
    await sgd.mint(eve.address, tenDollars);
    const supplyBefore = await sgd.totalSupply();

    await expect(sgd.connect(founder).adminBurn(eve.address, tenDollars))
      .emit(sgd, "Burned")
      .withArgs(founder.address, eve.address, tenDollars, "0x", "0x");

    expect(await sgd.balanceOf(eve.address)).equal(0);
    expect(await sgd.totalSupply()).equal(supplyBefore.sub(tenDollars));
  });

  it("adminBurn is only callable by the owner", async function () {
    await loadFixture(initialState);
    await sgd.mint(eve.address, tenDollars);

    await expect(
      sgd.connect(eve).adminBurn(eve.address, tenDollars)
    ).revertedWith("not owner");
    await expect(
      sgd.connect(alice).adminBurn(eve.address, tenDollars)
    ).revertedWith("not owner");
  });

  it("adminBurn works while paused", async function () {
    await loadFixture(initialState);
    await sgd.mint(eve.address, tenDollars);
    await sgd.connect(founder).pause();

    await sgd.connect(founder).adminBurn(eve.address, tenDollars);
    expect(await sgd.balanceOf(eve.address)).equal(0);

    await sgd.connect(founder).unpause();
  });

  it("adminBurn reverts when exceeding the available balance", async function () {
    await loadFixture(initialState);
    await sgd.mint(eve.address, tenDollars);

    await expect(
      sgd.connect(founder).adminBurn(eve.address, tenDollars.mul(2))
    ).reverted;
  });

  it("owner can block and unblock addresses in batch", async function () {
    await loadFixture(initialState);

    expect(await sgd.isBlocked(eve.address)).equal(false);

    await expect(
      sgd.connect(founder).setBlocked([eve.address, bob.address], true)
    )
      .emit(sgd, "BlockedUpdated")
      .withArgs(eve.address, true)
      .emit(sgd, "BlockedUpdated")
      .withArgs(bob.address, true);
    expect(await sgd.isBlocked(eve.address)).equal(true);
    expect(await sgd.isBlocked(bob.address)).equal(true);

    await expect(
      sgd.connect(founder).setBlocked([eve.address, bob.address], false)
    )
      .emit(sgd, "BlockedUpdated")
      .withArgs(eve.address, false);
    expect(await sgd.isBlocked(eve.address)).equal(false);
    expect(await sgd.isBlocked(bob.address)).equal(false);
  });

  it("setBlocked accepts an empty array", async function () {
    await loadFixture(initialState);
    await sgd.connect(founder).setBlocked([], true);
  });

  it("setBlocked is only callable by the owner", async function () {
    await loadFixture(initialState);

    await expect(sgd.connect(eve).setBlocked([eve.address], false)).revertedWith(
      "not owner"
    );
    await expect(
      sgd.connect(alice).setBlocked([bob.address], true)
    ).revertedWith("not owner");
  });

  it("blocked address (eg. a known pool) can not receive or send", async function () {
    await loadFixture(initialState);
    // the "pool" holds funds from before it was blocked
    await sgd.mint(bob.address, tenDollars);
    await sgd.mint(alice.address, tenDollars);
    await sgd.connect(founder).setBlocked([bob.address], true);

    // to the pool
    await expect(
      sgd.connect(alice).transfer(bob.address, oneDollar)
    ).revertedWithCustomError(sgd, "SUPER_GOODDOLLAR_BLOCKED");
    // from the pool
    await expect(
      sgd.connect(bob).transfer(alice.address, oneDollar)
    ).revertedWithCustomError(sgd, "SUPER_GOODDOLLAR_BLOCKED");

    // unrelated transfers are unaffected
    const eveBefore = await sgd.balanceOf(eve.address);
    await sgd.connect(alice).transfer(eve.address, oneDollar);
    expect(await sgd.balanceOf(eve.address)).equal(eveBefore.add(oneDollar));
  });

  it("blocking covers transferFrom, send and transferAndCall", async function () {
    await loadFixture(initialState);
    await sgd.mint(alice.address, tenDollars);
    await sgd.mint(bob.address, tenDollars);
    await sgd.connect(alice).approve(founder.address, tenDollars);
    await sgd.connect(bob).approve(founder.address, tenDollars);
    await sgd.connect(founder).setBlocked([bob.address], true);

    await expect(
      sgd.connect(founder).transferFrom(alice.address, bob.address, oneDollar)
    ).revertedWithCustomError(sgd, "SUPER_GOODDOLLAR_BLOCKED");
    await expect(
      sgd.connect(founder).transferFrom(bob.address, alice.address, oneDollar)
    ).revertedWithCustomError(sgd, "SUPER_GOODDOLLAR_BLOCKED");

    // erc777
    await expect(
      sgd
        .connect(alice)
        ["send(address,uint256,bytes)"](bob.address, oneDollar, "0x")
    ).revertedWithCustomError(sgd, "SUPER_GOODDOLLAR_BLOCKED");
    await expect(
      sgd
        .connect(bob)
        ["send(address,uint256,bytes)"](alice.address, oneDollar, "0x")
    ).revertedWithCustomError(sgd, "SUPER_GOODDOLLAR_BLOCKED");

    // erc677
    await sgd.connect(founder).setBlocked([receiverMock.address], true);
    await expect(
      sgd.connect(alice).transferAndCall(receiverMock.address, oneDollar, "0x")
    ).revertedWithCustomError(sgd, "SUPER_GOODDOLLAR_BLOCKED");
  });

  it("unblocking restores transfers", async function () {
    await loadFixture(initialState);
    await sgd.mint(bob.address, tenDollars);
    await sgd.connect(founder).setBlocked([bob.address], true);
    await expect(
      sgd.connect(bob).transfer(alice.address, oneDollar)
    ).revertedWithCustomError(sgd, "SUPER_GOODDOLLAR_BLOCKED");

    await sgd.connect(founder).setBlocked([bob.address], false);
    const aliceBefore = await sgd.balanceOf(alice.address);
    await sgd.connect(bob).transfer(alice.address, oneDollar);
    expect(await sgd.balanceOf(alice.address)).equal(
      aliceBefore.add(oneDollar)
    );
  });

  it("adminBurn works on a blocked address", async function () {
    await loadFixture(initialState);
    await sgd.mint(eve.address, tenDollars);
    await sgd.connect(founder).setBlocked([eve.address], true);

    await sgd.connect(founder).adminBurn(eve.address, tenDollars);
    expect(await sgd.balanceOf(eve.address)).equal(0);
  });

  it("non-zero fees are applied", async function () {
    await loadFixture(initialState);

    await sgd.connect(founder).mint(alice.address, tenDollars);
    await sgd.setFormula(feesFormula10PctMock.address);

    await expect(
      sgd.connect(alice).transfer(bob.address, tenDollars)
    ).revertedWithCustomError(sgd, "SUPER_GOODDOLLAR_FEE_EXCEEDS_BALANCE");

    // mint the extra amount needed for 10% fees
    await sgd.mint(alice.address, oneDollar);
    await sgd.connect(alice).transfer(bob.address, tenDollars);

    // since the sender pays the fee, alice should have spent 11$ and bob received 10$
    assert.equal(
      (await sgd.balanceOf(alice.address)).toString(),
      "0",
      "alice: wrong balance after transfer"
    );
    assert.equal(
      (await sgd.balanceOf(bob.address)).toString(),
      tenDollars.toString(),
      "bob: wrong balance after transfer"
    );
  });

  it("non-zero fees are applied for transferFrom (verify override of _transferForm)", async function () {
    await loadFixture(initialState);

    await sgd.connect(founder).mint(alice.address, tenDollars);
    await sgd.setFormula(feesFormula10PctMock.address);

    await sgd.connect(alice).approve(founder.address, tenDollars.mul(2));

    await expect(
      sgd.connect(founder).transferFrom(alice.address, bob.address, tenDollars)
    ).revertedWithCustomError(sgd, "SUPER_GOODDOLLAR_FEE_EXCEEDS_BALANCE");

    // mint the extra amount needed for 10% fees
    await sgd.connect(founder).mint(alice.address, oneDollar);
    assert.equal(
      (await sgd.balanceOf(alice.address)).toString(),
      tenDollars.add(oneDollar).toString(),
      "alice: wrong balance after mint"
    );

    await sgd
      .connect(founder)
      .transferFrom(alice.address, bob.address, tenDollars);

    // since the sender pays the fee, alice should have spent 11$ and bob received 10$
    assert.equal(
      (await sgd.balanceOf(alice.address)).toString(),
      "0",
      "alice: wrong balance after transfer"
    );
    assert.equal(
      (await sgd.balanceOf(bob.address)).toString(),
      tenDollars.toString(),
      "bob: wrong balance after transfer"
    );
  });

  it("should not be able to initialize again", async () => {
    await loadFixture(initialState);
    await expect(
      sgd["initialize(string,string,uint256,address,address,address,address)"](
        "x",
        "y",
        1,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero
      )
    ).revertedWith(/Initializable: contract is already initialized/);

    await expect(
      sgd["initialize(address,uint8,string,string)"](
        ethers.constants.AddressZero,
        2,
        "GD",
        "GD"
      )
    ).revertedWith(/Initializable: contract is not initializing/);
  });

  it("update the GoodDollar logic", async function () {
    await loadFixture(initialState);
    const sgdProxiable = await ethers.getContractAt(
      "contracts/token/superfluid/UUPSProxiable.sol:UUPSProxiable",
      sgd.address,
      founder.signer
    );

    const auxCodeAddrBefore = await sgdProxiable.getCodeAddress();

    const newLogic = await (
      await ethers.getContractFactory("SuperGoodDollar", founder)
    ).deploy(newHost.address);

    await expect(
      sgdProxiable.connect(eve).updateCode(newLogic.address)
    ).revertedWith(/not owner/);

    await sgdProxiable.connect(founder).updateCode(newLogic.address);

    const auxCodeAddrAfter = await sgdProxiable.getCodeAddress();

    assert.notEqual(
      auxCodeAddrBefore,
      auxCodeAddrAfter,
      "code address unchanged"
    );

    expect(await sgd.getHost()).equal(newHost.address);
    await expect(
      sgd["initialize(string,string,uint256,address,address,address,address)"](
        "x",
        "y",
        1,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero
      )
    ).revertedWith(/Initializable: contract is already initialized/);
  });

  describe("ERC20Permit", () => {
    const name = "SuperGoodDollar";
    const version = "1";

    const Permit = [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" }
    ];

    it("initial nonce is 0", async function () {
      expect(await sgd.nonces(alice.address)).to.equal(0);
    });

    it("domain separator", async function () {
      const hashedDomain = await ethers.utils._TypedDataEncoder.hashDomain({
        name,
        version,
        chainId: 4447,
        verifyingContract: sgd.address
      });
      expect(await sgd.DOMAIN_SEPARATOR()).to.equal(hashedDomain);
    });

    describe("permit", function () {
      const wallet = ethers.Wallet.createRandom();

      const chainId = 4447;
      const owner = wallet.address;
      const value = 42;
      const nonce = 0;
      const maxDeadline = ethers.constants.MaxUint256;

      const buildData = (
        chainId,
        verifyingContract,
        deadline = maxDeadline
      ) => ({
        primaryType: "Permit",
        types: { Permit },
        domain: { name, version, chainId, verifyingContract },
        message: { owner, spender: bob.address, value, nonce, deadline }
      });

      it("accepts owner signature", async function () {
        const data = buildData(chainId, sgd.address);
        const signature = await wallet._signTypedData(
          data.domain,
          data.types,
          data.message
        );
        const { v, r, s } = ethers.utils.splitSignature(signature);

        await sgd.permit(owner, bob.address, value, maxDeadline, v, r, s);

        expect(await sgd.nonces(owner)).to.equal(1);
        expect(await sgd.allowance(owner, bob.address)).to.equal(value);
      });

      it("rejects reused signature", async function () {
        await loadFixture(initialState);

        const data = buildData(chainId, sgd.address);
        const signature = await wallet._signTypedData(
          data.domain,
          data.types,
          data.message
        );
        const { v, r, s } = ethers.utils.splitSignature(signature);

        await sgd.permit(owner, bob.address, value, maxDeadline, v, r, s);

        await expect(
          sgd.permit(owner, bob.address, value, maxDeadline, v, r, s)
        ).revertedWith(/ERC20Permit: invalid signature/);
      });

      it("rejects other signature", async function () {
        const otherWallet = ethers.Wallet.createRandom();
        const data = buildData(chainId, sgd.address);
        const signature = await otherWallet._signTypedData(
          data.domain,
          data.types,
          data.message
        );
        const { v, r, s } = ethers.utils.splitSignature(signature);

        await expect(
          sgd.permit(owner, bob.address, value, maxDeadline, v, r, s)
        ).revertedWith(/ERC20Permit: invalid signature/);
      });

      it("rejects expired permit", async function () {
        const block = await ethers.provider.getBlock("latest");
        const deadline = ethers.BigNumber.from(block.timestamp.toFixed(0));

        const data = buildData(chainId, sgd.address, deadline);
        const signature = await wallet._signTypedData(
          data.domain,
          data.types,
          data.message
        );
        const { v, r, s } = ethers.utils.splitSignature(signature);

        await expect(
          sgd.permit(owner, bob.address, value, deadline, v, r, s)
        ).revertedWith(/ERC20Permit: expired deadline/);
      });
    });
  });
});
