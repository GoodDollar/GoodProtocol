import hre, { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import FeeFormulaABI from "@gooddollar/goodcontracts/build/contracts/SenderFeeFormula.json";
import FeeFormulaRecipientABI from "@gooddollar/goodcontracts/build/contracts/FeeFormula.json";
import TransferAndCallMockABI from "@gooddollar/goodcontracts/build/contracts/TransferAndCallMock.json";
import { IIdentity, GoodDollar, ISuperGoodDollar } from "../../types";
import { createDAO, deploySuperGoodDollar } from "../helpers";
import { Contract } from "ethers";

const BN = ethers.BigNumber;

describe("GoodDollar Token", () => {
  let receiver: Contract,
    identity,
    feeFormula,
    newFormula,
    token: ISuperGoodDollar,
    unCappedToken: ISuperGoodDollar,
    cappedToken: ISuperGoodDollar,
    newtoken: ISuperGoodDollar,
    feetoken: ISuperGoodDollar,
    founder,
    outsider,
    whitelisted;
  let signers;

  let avatar, gd: ISuperGoodDollar, Controller, id: IIdentity, superFluid;

  const regularTokenState = async () => {
    const deployedDAO = createDAO("regular");
    const token = (await ethers.getContractAt(
      "GoodDollar",
      (
        await deployedDAO
      ).gd
    )) as GoodDollar;

    await token.mint(founder.address, 100000000);

    return token;
  };

  before(async () => {
    [founder, whitelisted, outsider, ...signers] = await ethers.getSigners();

    let {
      daoCreator,
      controller,
      avatar: av,
      gd: gooddollar,
      identity: idv2,
      sfContracts
    } = await loadFixture(createDAO);

    superFluid = sfContracts;
    avatar = av;
    identity = await ethers.getContractAt("IdentityV2", idv2);

    const FeeFormulaFactory = new ethers.ContractFactory(
      FeeFormulaABI.abi,
      FeeFormulaABI.bytecode,
      founder
    );

    const FeeFormulaRecipientFactory = new ethers.ContractFactory(
      FeeFormulaRecipientABI.abi,
      FeeFormulaRecipientABI.bytecode,
      founder
    );

    receiver = await new ethers.ContractFactory(
      TransferAndCallMockABI.abi,
      TransferAndCallMockABI.bytecode,
      founder
    ).deploy();

    token = (await ethers.getContractAt(
      "ISuperGoodDollar",
      gooddollar
    )) as ISuperGoodDollar;
    feeFormula = FeeFormulaFactory.attach(await token.formula());

    // isProduction ? "GoodDollar" : "GoodDollar Dev",
    //   "G$",
    //   0,
    //   FeeFormula.address,
    //   Identity.address,
    //   ethers.constants.AddressZero,
    //   daoCreator.address
    // unCappedToken = (await upgrades.deployProxy(
    //   await ethers.getContractFactory("GoodDollar"),
    //   [
    //     "Test",
    //     "TDD",
    //     0,
    //     feeFormula.address,
    //     identity.address,
    //     receiver.address,
    //     founder.address
    //   ],
    //   {
    //     initializer:
    //       "initialize(string,string,uint256,address,address,address,address)"
    //   }
    // )) as GoodDollar;

    unCappedToken = (await deploySuperGoodDollar(superFluid, [
      "Test",
      "TDD",
      0,
      feeFormula.address,
      identity.address,
      receiver.address,
      founder.address
    ])) as ISuperGoodDollar;

    cappedToken = (await deploySuperGoodDollar(superFluid, [
      "Test",
      "TDD",
      1000,
      feeFormula.address,
      identity.address,
      receiver.address,
      founder.address
    ])) as ISuperGoodDollar;

    newFormula = await FeeFormulaFactory.deploy(1);
    const newFormulaRecipient = await FeeFormulaRecipientFactory.deploy(1);

    newtoken = (await deploySuperGoodDollar(superFluid, [
      "gd",
      "gd",
      1000000,
      newFormula.address,
      identity.address,
      av,
      founder.address
    ])) as ISuperGoodDollar;

    feetoken = (await deploySuperGoodDollar(superFluid, [
      "gd",
      "gd",
      1000000,
      newFormulaRecipient.address,
      identity.address,
      av,
      founder.address
    ])) as ISuperGoodDollar;

    // cappedToken = (await upgrades.deployProxy(
    //   await ethers.getContractFactory("GoodDollar"),
    //   [
    //     "Test",
    //     "TDD",
    //     1000,
    //     feeFormula.address,
    //     identity.address,
    //     receiver.address,
    //     founder.address
    //   ],
    //   {
    //     initializer:
    //       "initialize(string,string,uint256,address,address,address,address)"
    //   }
    // )) as GoodDollar;

    // newtoken = (await upgrades.deployProxy(
    //   await ethers.getContractFactory("GoodDollar"),
    //   [
    //     "gd",
    //     "gd",
    //     1000000,
    //     newFormula.address,
    //     identity.address,
    //     av,
    //     founder.address
    //   ],
    //   {
    //     initializer:
    //       "initialize(string,string,uint256,address,address,address,address)"
    //   }
    // )) as GoodDollar;

    await token.mint(founder.address, 100000000);

    await newtoken.mint(whitelisted.address, 100000);
    await feetoken.mint(whitelisted.address, 100000);

    await token.transfer(whitelisted.address, 100000);
    await token.transfer(founder.address, 10000);
    await token.transfer(outsider.address, 1000);
    await identity.addWhitelisted(whitelisted.address);
    await identity.addWhitelisted(outsider.address);
  });

  it("should have low gas cost for transfer with regular token", async () => {
    const token = await loadFixture(regularTokenState);
    const firstTime = await (
      await token.transfer(signers[2].address, 1000)
    ).wait();
    const secondTime = await (
      await token.transfer(signers[2].address, 1000)
    ).wait();
    expect(firstTime.gasUsed).lt(70000);
    expect(secondTime.gasUsed).lt(55000);
  });

  it("should have high gas cost for transfer with superfluid token", async () => {
    const firstTime = await (
      await token.transfer(signers[2].address, 1000)
    ).wait();
    const secondTime = await (
      await token.transfer(signers[2].address, 1000)
    ).wait();
    expect(firstTime.gasUsed).gt(160000);
    expect(secondTime.gasUsed).gt(149000);
  });

  it("should have avatar as default pauser", async () => {
    expect(await token.isPauser(avatar)).true;
  });

  it("should let owner set identity and formula", async () => {
    await expect(newtoken.setFormula(ethers.constants.AddressZero)).not
      .reverted;
    await expect(newtoken.setIdentity(ethers.constants.AddressZero)).not
      .reverted;
    expect(await newtoken.identity()).eq(ethers.constants.AddressZero);
    expect(await newtoken.formula()).eq(ethers.constants.AddressZero);
    await newtoken.setIdentity(identity.address);
    await newtoken.setFormula(newFormula.address);
  });

  it("should not let non owner set identity and formula", async () => {
    await expect(
      newtoken.connect(signers[0]).setFormula(ethers.constants.AddressZero)
    ).revertedWith(/not owner/);
    await expect(
      newtoken.connect(signers[0]).setIdentity(ethers.constants.AddressZero)
    ).revertedWith(/not owner/);
  });

  it("should fail transfer", async () => {
    let data = "0x";

    await expect(
      token
        .connect(outsider)
        .transferAndCall(
          receiver.address,
          (await token.balanceOf(outsider.address)).add(100000),
          data
        )
    ).reverted;
  });

  it("should not transfer and not call function", async () => {
    let data = "0x";

    await expect(
      token.transferAndCall(receiver.address, 1000, data)
    ).revertedWith(/Contract Fallback failed/);
    expect(await receiver.wasCalled()).false;
  });

  it("should transfer, not call and return true if not contract", async () => {
    let data = "0x";

    await expect(token.transferAndCall(founder.address, 300, data)).not
      .reverted;
  });

  it("should transfer and call correct function on receiver contract", async () => {
    let data = receiver.interface.encodeFunctionData("mockTransfer", []);

    expect(await token.transferAndCall(receiver.address, 1000, data));
    expect(await receiver.wasCalled()).true;
  });

  it("should increase allowance", async () => {
    expect(await token.increaseAllowance(whitelisted.address, 2000));
  });

  it("should allow to transfer from", async () => {
    await expect(
      token
        .connect(whitelisted)
        .transferFrom(founder.address, whitelisted.address, 1000)
    ).not.reverted;
  });

  it("should decrease allowance", async () => {
    await expect(token.decreaseAllowance(whitelisted.address, 1000)).not
      .reverted;
  });

  it("should allow to burn", async () => {
    expect(token.connect(whitelisted)["burn(uint256)"](1000)).not.reverted;
  });

  it("should allow to burn from", async () => {
    await expect(token.approve(whitelisted.address, 2000)).not.reverted;
    await expect(token.connect(whitelisted).burnFrom(founder.address, 2000)).not
      .reverted;
  });

  it("should not allow to mint beyond cap", async () => {
    await expect(unCappedToken.mint(founder.address, 1000)).not.reverted;

    await expect(cappedToken.mint(founder.address, 1200)).revertedWith(
      /Cannot increase supply beyond cap/
    );
  });

  it("should collect transaction fee", async () => {
    const oldReserve = await newtoken.balanceOf(avatar);
    const initBalance = await newtoken.balanceOf(whitelisted.address);

    await newtoken.connect(whitelisted).transfer(outsider.address, 20000);
    const postBalance = await newtoken.balanceOf(whitelisted.address);

    // Check that reserve has received fees
    const reserve = (await newtoken.balanceOf(avatar)) as any;

    const reserveDiff = reserve.sub(oldReserve);
    const totalFees = await newtoken["getFees(uint256)"](20000).then(
      _ => _["0"]
    );
    expect(totalFees).gt(0);
    expect(postBalance).eq(initBalance.sub(20000).sub(totalFees)); //senderpays
    expect(reserveDiff.toString()).to.be.equal(totalFees.toString());
  });

  it("should collect transaction fee for transferAndCall", async () => {
    const oldReserve = await newtoken.balanceOf(avatar);
    const initBalance = await newtoken.balanceOf(whitelisted.address);

    const tx = await newtoken
      .connect(whitelisted)
      .transferAndCall(outsider.address, 20000, "0x00");
    const postBalance = await newtoken.balanceOf(whitelisted.address);

    const events = (await tx.wait()).events;
    const parser = await ethers.getContractFactory("SuperGoodDollar");
    const parsedEvents = events.map(_ => {
      try {
        return parser.interface.parseLog(_);
      } catch (e) {
        return {};
      }
    }) as any;
    const transferEvents = parsedEvents.filter(
      _ => _.name === "Transfer" && _.args.to === outsider.address
    );
    // Check that reserve has received fees
    const reserve = (await newtoken.balanceOf(avatar)) as any;

    const reserveDiff = reserve.sub(oldReserve);
    const totalFees = await newtoken["getFees(uint256)"](20000).then(
      _ => _["0"]
    );
    expect(totalFees).gt(0);
    expect(reserveDiff.toString()).to.be.equal(totalFees.toString());
    expect(postBalance).eq(initBalance.sub(20000).sub(totalFees)); //senderpays

    expect(transferEvents.length).gt(1); //atleast regular + erc677 Transfer
    transferEvents.forEach(_ => {
      expect(_.args.value || _.args.amount).eq(20000);
    });
  });

  it("should collect transaction fee from recipient for transferAndCall", async () => {
    const oldReserve = await feetoken.balanceOf(avatar);
    const initBalance = await feetoken.balanceOf(whitelisted.address);

    const tx = await feetoken
      .connect(whitelisted)
      .transferAndCall(outsider.address, 5000, "0x00");
    const postBalance = await feetoken.balanceOf(whitelisted.address);

    const events = (await tx.wait()).events;
    const parser = await ethers.getContractFactory("SuperGoodDollar");
    const parsedEvents = events.map(_ => {
      try {
        return parser.interface.parseLog(_);
      } catch (e) {
        return {};
      }
    }) as any;
    const transferEvents = parsedEvents.filter(
      _ => _.name === "Transfer" && _.args.to === outsider.address
    );
    // Check that reserve has received fees
    const reserve = (await feetoken.balanceOf(avatar)) as any;

    const reserveDiff = reserve.sub(oldReserve);
    const totalFees = await feetoken["getFees(uint256)"](5000).then(
      _ => _["0"]
    );
    expect(totalFees).gt(0);
    expect(reserveDiff.toString()).to.be.equal(totalFees.toString());
    expect(postBalance).eq(initBalance.sub(5000)); //recipient pays fee
    expect(transferEvents.length).gt(1); //atleast regular + erc677 Transfer
    transferEvents.forEach(_ => {
      expect(_.args.value || _.args.amount).eq(5000 - totalFees.toNumber());
    });
  });

  it("should get same results from overloaded getFees method", async () => {
    const totalFees = await newtoken["getFees(uint256)"](3000) //fix overload issue
      .then(_ => _["0"]);
    const totalFees2 = await newtoken["getFees(uint256,address,address)"](
      3000,
      whitelisted.address,
      whitelisted.address
    ).then(_ => _["0"]);
    expect(totalFees2.toNumber()).to.be.gt(0);
    expect(totalFees2.toString()).to.be.equal(totalFees.toString());
  });

  it("should collect transaction fee from sender", async () => {
    const oldReserve = await newtoken.balanceOf(avatar);
    const oldFounder = await newtoken.balanceOf(founder.address);
    const newWhitelistedBefore = await newtoken.balanceOf(whitelisted.address);

    await newtoken.connect(whitelisted).transfer(founder.address, 20000);

    // Check that reserve has received fees
    const reserve = (await newtoken.balanceOf(avatar)) as any;
    const newFounder = (await newtoken.balanceOf(founder.address)) as any;
    const newWhitelisted = await newtoken.balanceOf(whitelisted.address);

    const reserveDiff = reserve.sub(oldReserve);
    const founderDiff = newFounder.sub(oldFounder);

    const totalFees = await newtoken["getFees(uint256)"](20000).then(
      _ => _["0"]
    );
    expect(totalFees).gt(0);
    expect(reserveDiff.toString()).to.be.equal(totalFees.toString());
    expect(founderDiff.toString()).to.be.equal("20000");
    expect(newWhitelistedBefore.sub(newWhitelisted)).to.be.equal("20200"); //20000 + 1%
  });
});
