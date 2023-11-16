import hre, { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { Faucet, FuseFaucetV2, IGoodDollar, IIdentity } from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { createDAO } from "../helpers";

const BN = ethers.BigNumber;
["FuseFaucetV2", "Faucet"].forEach(factory => {
  describe(factory, () => {
    let faucet: FuseFaucetV2 | Faucet,
      founder: SignerWithAddress,
      fuseFaucet: FuseFaucetV2,
      faucets;
    let user1 = ethers.Wallet.createRandom().connect(ethers.provider);
    let user2 = ethers.Wallet.createRandom().connect(ethers.provider);
    let signers;

    let avatar, gd: IGoodDollar, Controller, id: IIdentity;

    const cleanFixture = async () => {};
    before(async () => {
      [founder, ...signers] = await ethers.getSigners();

      const FuseFaucetF = await ethers.getContractFactory(factory);

      let {
        daoCreator,
        controller,
        avatar: av,
        gd: gooddollar,
        identity,
        nameService
      } = await loadFixture(createDAO);

      Controller = controller;
      avatar = av;

      // await daoCreator.setSchemes(
      //   avatar,
      //   [identity],
      //   [ethers.constants.HashZero],
      //   ["0x0000001F"],
      //   ""
      // );

      // faucet = (await upgrades.deployProxy(
      //   FuseFaucetF,
      //   [nameService.address, 1e10, signers[0].address, founder.address],
      //   {
      //     kind: "uups"
      //   }
      // )) as Faucet;

      faucet = (await upgrades.deployProxy(
        await ethers.getContractFactory("FuseFaucetV2"),
        [nameService.address, 1e10, signers[0].address, 1000000],
        {
          kind: "transparent"
        }
      )) as FuseFaucetV2;

      gd = (await ethers.getContractAt(
        "IGoodDollar",
        gooddollar,
        founder
      )) as IGoodDollar;
      id = (await ethers.getContractAt(
        "IIdentity",
        identity,
        founder
      )) as IIdentity;

      await founder.sendTransaction({
        value: ethers.utils.parseEther("1"),
        to: faucet.address
      });
      faucets = [fuseFaucet, faucet];
      await loadFixture(cleanFixture);
    });

    it("should have balance", async () => {
      const balance = await ethers.provider.getBalance(faucet.address);
      expect(balance).to.equal(ethers.utils.parseEther("1"));
    });

    it("should not unauthorized to top new user", async () => {
      expect(await faucet.canTop(user1.address)).to.true;
      await expect(faucet.topWallet(user1.address)).revertedWith(
        /not authorized/
      );
    });

    it("should let new user top once", async () => {
      expect(await faucet.canTop(user1.address)).to.true;
      const tx = await (
        await faucet.connect(signers[0]).topWallet(user1.address)
      ).wait();
      const balance = await ethers.provider.getBalance(user1.address);
      expect(balance).to.equal(await faucet.getToppingAmount());
    });

    it("should not let new user top more than once", async () => {
      await user1.sendTransaction({
        to: ethers.constants.AddressZero,
        value: ethers.utils.parseUnits("400000", "gwei")
      });
      expect(await faucet.canTop(user1.address)).to.false;
      await expect(
        faucet.connect(signers[0]).topWallet(user1.address)
      ).to.revertedWith(/User not whitelisted or not first time/);
    });

    it("should not refund gas when reverted", async () => {
      const balance = await ethers.provider.getBalance(founder.address);
      const faucetBalance = await ethers.provider.getBalance(faucet.address);
      expect(await faucet.canTop(user1.address)).to.false;
      await expect(faucet.topWallet(user1.address)).to.revertedWith(
        /User not whitelisted or not first time/
      );
      const balanceAfter = await ethers.provider.getBalance(founder.address);
      const faucetBalanceAfter = await ethers.provider.getBalance(
        faucet.address
      );
      expect(faucetBalanceAfter).to.eq(faucetBalance);
      expect(balanceAfter).to.lt(balance);
    });

    it("should let user top again once identified", async () => {
      await user1.sendTransaction({
        to: ethers.constants.AddressZero,
        value: (
          await ethers.provider.getBalance(user1.address)
        ).sub(ethers.utils.parseUnits("100000", "gwei"))
      });
      await id.addWhitelistedWithDID(user1.address, "did:1");
      expect(await faucet.canTop(user1.address)).to.true;
      const tx = await (await faucet.topWallet(user1.address)).wait();
      console.log(tx.gasUsed.toString());
      const balance = await ethers.provider.getBalance(user1.address);
      expect(balance).to.equal(await faucet.getToppingAmount());
    });

    it("should not let identified user top over daily limit", async () => {
      await user1.sendTransaction({
        to: ethers.constants.AddressZero,
        value: (
          await ethers.provider.getBalance(user1.address)
        ).sub(ethers.utils.parseUnits("100000", "gwei"))
      });
      const tx = await (await faucet.topWallet(user1.address)).wait();
      await user1.sendTransaction({
        to: ethers.constants.AddressZero,
        value: ethers.utils.parseUnits("400000", "gwei")
      });
      expect(await faucet.canTop(user1.address)).to.false;
      await expect(faucet.topWallet(user1.address)).to.revertedWith(
        /max daily toppings/
      );
    });

    // it("should not top if wallet not half empty", async () => {
    //   expect(await faucet.canTop(founder.address)).to.false;
    //   await expect(faucet.topWallet(founder.address)).to.revertedWith(
    //     "User balance above minimum"
    //   );
    // });

    it("should not let user top over weekly limit", async () => {
      const toppingAmount = await faucet.getToppingAmount();
      await user1.sendTransaction({
        to: ethers.constants.AddressZero,
        value: toppingAmount.mul(80).div(100)
      });
      for (let i = 0; i < 2; i++) {
        await ethers.provider.send("evm_increaseTime", [60 * 60 * 24]);
        await (await faucet.topWallet(user1.address)).wait();
        await user1.sendTransaction({
          to: ethers.constants.AddressZero,
          value: toppingAmount.mul(80).div(100)
        });
        console.log(toppingAmount.toString(), { i });
      }
      // await ethers.provider.send("evm_increaseTime", [60 * 60 * 24]);

      await expect(faucet.topWallet(user1.address)).to.revertedWith(
        /User wallet has been topped too many times this week/
      );
      expect(await faucet.canTop(user1.address)).to.false;

      //should be able to top again after some days passed
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 5]);
      await ethers.provider.send("evm_mine", []);

      expect(await faucet.canTop(user1.address)).to.true;
    });

    it("should not top below minTopping", async () => {
      await id.addWhitelistedWithDID(user2.address, "did:2");

      const toppingAmount = await faucet.getToppingAmount();
      console.log(toppingAmount.toString(), "topping amount");
      const minTopping = await faucet.minTopping();
      const balance = await ethers.provider.getBalance(founder.address);
      await founder.sendTransaction({
        to: user2.address,
        value: toppingAmount.mul(100 - minTopping + 1).div(100)
      });

      expect(await faucet.canTop(user2.address)).to.be.false;
      await expect(faucet.topWallet(user2.address)).to.revertedWith(
        /low toTop/
      );
      await user2.sendTransaction({
        to: founder.address,
        value: toppingAmount.mul(2).div(100)
      });
      expect(await faucet.canTop(user2.address)).to.be.true;
      await expect(faucet.topWallet(user2.address)).not.reverted;
    });

    it("should reimburse gas costs", async () => {
      const tempUser = ethers.Wallet.createRandom().connect(ethers.provider);

      const balance = await ethers.provider.getBalance(founder.address);
      const tx = await (
        await faucet
          .connect(signers[0])
          .topWallet(tempUser.address, { gasPrice: 1e9 })
      ).wait();
      // const gasCosts = tx.gasUsed.mul(1e9);
      // const afterRefund = gasCosts.sub(await faucet["gasRefund()"]());
      const balanceAfter = await ethers.provider.getBalance(founder.address);
      const diff = balance.sub(balanceAfter).toNumber();
      expect(diff).to.lt(10000);
    });
  });
});
