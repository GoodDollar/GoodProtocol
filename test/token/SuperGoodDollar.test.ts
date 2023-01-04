import hre, { ethers } from "hardhat";
import { assert, expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Framework } from "@superfluid-finance/sdk-core";
import TransferAndCallMockABI from "@gooddollar/goodcontracts/build/contracts/TransferAndCallMock.json";
import { createDAO, deploySuperGoodDollar } from "../helpers";
import { ISuperGoodDollar } from "../../types";

let sf,
  founder,
  alice,
  bob,
  eve,
  identityMock,
  receiverMock,
  sgd, // stands for "SuperGoodDollar"
  feesFormula10PctMock;

const alotOfDollars = ethers.utils.parseEther("100000");
const tenDollars = ethers.utils.parseEther("10");
const oneDollar = ethers.utils.parseEther("1");
const tenDollarsPerDay = "124378109452730"; // flowrate per second

const initialState = async () => {};

before(async function () {
  //get accounts from hardhat
  [founder, alice, bob, eve] = await ethers.getSigners();

  // Superfluid specific init

  let { sfContracts } = await loadFixture(createDAO);

  // initialize sdk-core to get a framework handle for more convenient access to Superfluid functionality
  sf = await Framework.create({
    chainId: ethers.provider.network.chainId,
    provider: ethers.provider,
    resolverAddress: sfContracts.resolver,
    protocolReleaseVersion: "test"
  });

  // GoodDollar specific init
  const FeesFormulaMockFactory = await ethers.getContractFactory(
    "FeesFormulaMock",
    founder
  );

  const feesFormula0PctMock = await FeesFormulaMockFactory.deploy(0);

  feesFormula10PctMock = await FeesFormulaMockFactory.deploy(100000);

  // the zero address is a placeholder for the dao contract
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

  sgd = await deploySuperGoodDollar(sfContracts, [
    "SuperGoodDollar",
    "SGD",
    0, // cap
    feesFormula0PctMock.address,
    identityMock.address,
    receiverMock.address,
    founder.address
  ]);

  await sgd.mint(founder.address, alotOfDollars);
  await loadFixture(initialState);
});

describe("SuperGoodDollar", async function () {
  it("check ERC20 metadata", async function () {
    const symbol = await sgd.symbol();
    const name = await sgd.name();
    assert.equal(symbol, "SGD", "symbol mismatch");
    assert.equal(name, "SuperGoodDollar", "name mismatch");
  });

  it("mint to alice", async function () {
    await sgd.mint(alice.address, alotOfDollars);
    const balAfter = await sgd.balanceOf(alice.address);

    assert.equal(
      balAfter.toString(),
      alotOfDollars.toString(),
      "wrong balance after mint"
    );
  });

  it("do ERC20 transfer", async function () {
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
    await sgd.connect(founder).pause();
    await expect(sgd.transfer(bob.address, tenDollars)).revertedWith(
      "Pausable: token transfer while paused"
    );

    await expect(
      sf.cfaV1
        .createFlow({
          superToken: sgd.address,
          sender: alice.address,
          receiver: bob.address,
          flowRate: tenDollarsPerDay
        })
        .exec(alice)
    ).reverted;

    await sgd.connect(founder).unpause();
    await sgd.transfer(bob.address, tenDollars);
  });

  it("non-zero fees are applied", async function () {
    await loadFixture(initialState);

    await sgd.connect(founder).mint(alice.address, tenDollars);
    await sgd.setFormula(feesFormula10PctMock.address);

    await expect(
      sgd.connect(alice).transfer(bob.address, tenDollars)
    ).revertedWith("Not enough balance to pay TX fee");

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

  it("should not be able to initialize again", async () => {
    await expect(
      sgd.initializeAux(
        1,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero
      )
    ).revertedWith("Initializable: contract is already initialized");

    await expect(
      sgd.initialize(ethers.constants.AddressZero, 2, "GD", "GD")
    ).revertedWith("Initializable: contract is already initialized");
  });

  it("update the GoodDollar logic", async function () {
    const sgdProxiable = await ethers.getContractAt(
      "AuxProxiable",
      sgd.address,
      founder.signer
    );

    const auxCodeAddrBefore = await sgdProxiable.getAuxCodeAddress();

    const newLogic = await (
      await ethers.getContractFactory("SuperGoodDollar", founder)
    ).deploy();

    await expect(
      sgdProxiable.connect(eve).updateAuxCode(newLogic.address)
    ).revertedWith("not owner");

    await sgdProxiable.connect(founder).updateAuxCode(newLogic.address);

    const auxCodeAddrAfter = await sgdProxiable.getAuxCodeAddress();

    assert.notEqual(
      auxCodeAddrBefore,
      auxCodeAddrAfter,
      "code address unchanged"
    );
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
        ).revertedWith("ERC20Permit: invalid signature");
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
        ).revertedWith("ERC20Permit: invalid signature");
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
        ).revertedWith("ERC20Permit: expired deadline");
      });
    });
  });
});
