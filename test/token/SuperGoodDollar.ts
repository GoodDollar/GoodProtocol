import hre, { ethers } from "hardhat";
import { assert, expect } from "chai";

import TransferAndCallMockABI from "@gooddollar/goodcontracts/build/contracts/TransferAndCallMock.json";

import { Framework } from "@superfluid-finance/sdk-core";
import frameworkDeployer from "@superfluid-finance/ethereum-contracts/scripts/deploy-test-framework";
import TestToken from "@superfluid-finance/ethereum-contracts/build/contracts/TestToken.json";

let contractsFramework,
  sfDeployer, sf,
  founder, alice, bob, eve, bridge,
  sgd, // stands for "SuperGoodDollar"
  feesFormula0PctMock, feesFormula10PctMock, identityMock, receiverMock;

const alotOfDollars = ethers.utils.parseEther("100000");
const tenDollars = ethers.utils.parseEther("10");
const oneDollar = ethers.utils.parseEther("1");
const tenDollarsPerDay = "124378109452730"; // flowrate per second

before(async function () {
  //get accounts from hardhat
  [founder, alice, bob, eve, bridge] = await ethers.getSigners()

  // Superfluid specific init

  // This deploys the whole framework with various contracts
  sfDeployer = await frameworkDeployer.deployTestFramework();
  // returns contract addresses as a struct, see https://github.com/superfluid-finance/protocol-monorepo/blob/dev/packages/ethereum-contracts/contracts/utils/SuperfluidFrameworkDeployer.sol#L48
  contractsFramework = await sfDeployer.getFramework();

  // initialize sdk-core to get a framework handle for more convenient access to Superfluid functionality
  sf = await Framework.create({
    chainId: ethers.provider.network.chainId,
    provider: ethers.provider,
    resolverAddress: contractsFramework.resolver,
    protocolReleaseVersion: "test"
  });

  // GoodDollar specific init
  const FeesFormulaMockFactory = await ethers.getContractFactory("FeesFormulaMock", founder);
  feesFormula0PctMock = await FeesFormulaMockFactory.deploy(0);
  feesFormula10PctMock = await FeesFormulaMockFactory.deploy(100000);

  // the zero address is a placeholder for the dao contract
  const IdentityMockFactory = await ethers.getContractFactory("IdentityMock", founder);
  identityMock = await IdentityMockFactory.deploy("0x0000000000000000000000000000000000000000");

  receiverMock = await new ethers.ContractFactory(
    TransferAndCallMockABI.abi,
    TransferAndCallMockABI.bytecode,
    founder
  ).deploy();
});

beforeEach(async function () {
  const GoodDollarCustomFactory = await ethers.getContractFactory("GoodDollarCustom", founder);
  const goodDollarCustom = await GoodDollarCustomFactory.deploy();

  const GoodDollarProxyFactory = await ethers.getContractFactory("GoodDollarProxy", founder);
  const goodDollarProxy = await GoodDollarProxyFactory.deploy();

  await goodDollarProxy.initialize(
    "SuperGoodDollar",
    "SGD",
    contractsFramework.host,
    goodDollarCustom.address,
    0, // cap
    feesFormula0PctMock.address,
    identityMock.address,
    receiverMock.address,
    founder.address
  );

  sgd = await ethers.getContractAt("ISuperGoodDollar", goodDollarProxy.address, founder);

  await sgd.mint(founder.address, alotOfDollars);
});

describe("GoodDollar", async function () {
  it("check ERC20 metadata", async function() {
    const symbol = await sgd.symbol();
    const name = await sgd.name();
    assert.equal(symbol, "SGD", "symbol mismatch");
    assert.equal(name, "SuperGoodDollar", "ame mismatch");
  });

  it("mint to alice", async function() {
    await sgd.mint(alice.address, alotOfDollars);
    const balAfter = await sgd.balanceOf(alice.address);

    assert.equal(
      balAfter.toString(),
      alotOfDollars.toString(),
      "wrong balance after mint"
    );
  });

  it("do ERC20 transfer", async function() {
    await sgd.mint(alice.address, tenDollars);
    await sgd.connect(alice).transfer(bob.address, tenDollars);
    const balAfter = await sgd.balanceOf(bob.address);

    assert.equal(
      balAfter.toString(),
      tenDollars.toString(),
      "wrong balance after transfer"
    );
  });

  it("do ERC20 transferFrom", async function() {
    await sgd.approve(alice.address, tenDollars);
    await sgd.connect(alice).transferFrom(founder.address, bob.address, tenDollars);
    assert.equal(
      (await sgd.balanceOf(bob.address)).toString(),
      tenDollars.toString(),
      "wrong balance after transferFrom"
    );
  });

  it("start stream", async function() {
    await sgd.mint(alice.address, alotOfDollars);

    await sf.cfaV1.createFlow({
      superToken: sgd.address,
      sender: alice.address,
      receiver: bob.address,
      flowRate: tenDollarsPerDay
    }).exec(alice);

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

  it("pauseable", async function() {
    await sgd.pause();
    await expect(sgd.transfer(bob.address, tenDollars))
      .revertedWith("Pausable: token transfer while paused");

    await expect(sf.cfaV1.createFlow({
        superToken: sgd.address,
        sender: alice.address,
        receiver: bob.address,
        flowRate: tenDollarsPerDay
      }).exec(alice)
    ).reverted;

    await sgd.unpause();
    await sgd.transfer(bob.address, tenDollars);
  });

  it("non-zero fees are applied", async function() {
    await sgd.mint(alice.address, tenDollars);
    await sgd.setFormula(feesFormula10PctMock.address);

    await expect(sgd.connect(alice).transfer(bob.address, tenDollars))
      .revertedWith("Not enough balance to pay TX fee");

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

  it("allow the bridge to mint", async function() {
    await expect(sgd.connect(bridge).mint(alice.address, tenDollars))
      .revertedWith("not minter");

    await expect(sgd.connect(eve).addMinter(eve.address))
      .reverted;
    await sgd.addMinter(bridge.address);
    await sgd.connect(bridge).mint(alice.address, tenDollars);
    assert.equal(
      (await sgd.balanceOf(alice.address)).toString(),
      tenDollars.toString(),
      "alice: wrong balance after bridge mint"
    );

    // syntax "sgd.burn()" doesn't work because it exists with different signatures
    // in ISuperToken and in IGoodDollarCustom
    await sgd.connect(bridge)["burn(address,uint256)"](alice.address, oneDollar);

    assert.equal(
      (await sgd.balanceOf(alice.address)).toString(),
      ethers.utils.parseEther("9").toString(),
      "alice: wrong balance after bridge burn"
    );

    // eve doesn't have the minter role, thus fails
    await expect(sgd.connect(eve)["burn(address,uint256)"](alice.address, oneDollar))
      .revertedWith("not minter");

    // make sure role renouncing works
    await sgd.connect(bridge).renounceMinter();
    await expect(sgd.connect(bridge)["burn(address,uint256)"](alice.address, oneDollar))
      .revertedWith("not minter");
  });

  it("update the GoodDollar logic", async function() {
    const sgdProxiable = await ethers.getContractAt("AuxProxiable", sgd.address, founder.signer);

    const auxCodeAddrBefore = await sgdProxiable.getAuxCodeAddress();

    const newLogic =
      await ((await ethers.getContractFactory("GoodDollarCustom", founder)).deploy());

    await expect(sgdProxiable.connect(eve).updateAuxCode(newLogic.address))
      .revertedWith("not owner");

    await sgdProxiable.updateAuxCode(newLogic.address);

    const auxCodeAddrAfter = await sgdProxiable.getAuxCodeAddress();

    assert.notEqual(auxCodeAddrBefore, auxCodeAddrAfter, "code address unchanged");
  });
});
