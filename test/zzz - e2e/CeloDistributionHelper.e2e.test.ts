import { reset } from "@nomicfoundation/hardhat-network-helpers";
import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import {
    CeloDistributionHelper,
    IStaticOracle,
    Controller,
    ISuperGoodDollar
} from "../../types";
import { createDAO } from "../helpers";
import release from "../../releases/deployment.json"

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 1;

const dao = release["production-celo"]
describe("CeloDistributionHelper E2E (Celo fork)", () => {
    let distHelper: CeloDistributionHelper
    let avatar
    let oracle: IStaticOracle
    const forkReset = async () => {
        await reset("https://rpc.ankr.com/celo");

        avatar = await ethers.getImpersonatedSigner(dao.Avatar)
        distHelper = await upgrades.deployProxy(await ethers.getContractFactory("CeloDistributionHelper"), [dao.NameService, "0x00851A91a3c4E9a4c1B48df827Bacc1f884bdE28"], {
            kind: "uups"
        }) as CeloDistributionHelper
        await distHelper.connect(avatar).setFeeSettings({ maxFee: ethers.utils.parseEther("5"), minBalanceForFees: ethers.utils.parseEther("10"), percentageToSellForFee: 1, maxSlippage: 5 })

    }

    before(forkReset)

    it("should ready oracle when deployed", async () => {
        oracle = (await ethers.getContractAt(
            "IStaticOracle",
            await distHelper.STATIC_ORACLE()
        )) as IStaticOracle;

        const [price, pool] = await oracle.quoteAllAvailablePoolsWithTimePeriod(ethers.utils.parseEther("1"), await distHelper.nativeToken(), await distHelper.CUSD(), 60)
        expect(price).gt(0)
        expect(pool).members(["0x11EeA4c62288186239241cE21F54034006C79B3F", "0x9491d57c5687AB75726423B55AC2d87D1cDa2c3F"])
    })
    it("should deploy disthelper on celo fork", async () => {
        expect(await distHelper.CELO()).not.eq(ethers.constants.AddressZero)
        expect(await distHelper.avatar()).eq(dao.Avatar)
    })
    it("should calc G$ to buy for gas fee using oracle", async () => {
        const [toSell, minReceived] = await distHelper.calcGDToSell(ethers.utils.parseEther("100000"))
        expect(toSell).gt(0)
        expect(minReceived).gt(0).lt(ethers.utils.parseEther("100"))
        expect(toSell).eq(ethers.utils.parseEther("100000"))
    })

    it("should calc G$ to buy for gas fee using oracle, not more than actually required", async () => {
        const [toSell, minReceived] = await distHelper.calcGDToSell(ethers.utils.parseEther("1000000000"))
        expect(toSell).gt(0)
        expect(minReceived).gt(0).lt(ethers.utils.parseEther("100"))
        expect(toSell).lt(ethers.utils.parseEther("1000000000"))
    })

    it("should revert if adding contract recipient on remote chain", async () => {
        expect(await distHelper.mpbBridge()).eq(dao.MpbBridge)
        const ctrl = await ethers.getContractAt("Controller", dao.Controller) as Controller
        await expect(distHelper.connect(avatar).addOrUpdateRecipient({
            transferType: 1,
            addr: dao.UBIScheme,
            bps: 5000,
            chainId: 122
        })).revertedWithCustomError(distHelper, "INVALID_CHAINID");
    })

    it("should on distribute buy Celo for gas", async () => {
        expect(await distHelper.mpbBridge()).eq(dao.MpbBridge)
        const ctrl = await ethers.getContractAt("Controller", dao.Controller) as Controller
        await distHelper.connect(avatar).addOrUpdateRecipient({
            transferType: 1,
            addr: dao.UBIScheme,
            bps: 5000,
            chainId: 4447
        })

        const gd = await ethers.getContractAt("ISuperGoodDollar", dao.GoodDollar) as ISuperGoodDollar
        //mint g$ to distrbute
        await gd.connect(avatar).mint(distHelper.address, ethers.utils.parseEther("10000000"))
        const tx = await distHelper.onDistribution(ethers.utils.parseEther("10000000"))
        const result = await tx.wait()
        const boughtGasEvent = result.events?.find(e => e.address === "0x471EcE3750Da237f93B8E339c536989b8978a438" && e.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef")
        expect(boughtGasEvent).not.undefined
        expect(boughtGasEvent.topics[2]).eq(ethers.utils.hexZeroPad(distHelper.address, 32).toLowerCase()) // transfered some Celo to disthelper (from buying)
        expect(boughtGasEvent.data).not.eq(ethers.constants.HashZero) // transfer value > 0
        expect(tx).not.reverted

    })

    it("should on distribute use lz bridge when have enough Celo for gas", async () => {
        await forkReset()
        expect(await distHelper.mpbBridge()).eq(dao.MpbBridge)
        const ctrl = await ethers.getContractAt("Controller", dao.Controller) as Controller
        await distHelper.connect(avatar).addOrUpdateRecipient({
            transferType: 0, //lz
            addr: dao.UBIScheme,
            bps: 5000,
            chainId: 122
        })

        const gd = await ethers.getContractAt("ISuperGoodDollar", dao.GoodDollar) as ISuperGoodDollar
        //mint g$ to distrbute
        await gd.connect(avatar).mint(distHelper.address, ethers.utils.parseEther("100000000"))
        const hasCelo = await ethers.getImpersonatedSigner("0x5128E3C1f8846724cc1007Af9b4189713922E4BB")
        await hasCelo.sendTransaction({ to: distHelper.address, value: ethers.utils.parseEther("10") })

        const tx = await distHelper.onDistribution(ethers.utils.parseEther("100000000"))
        const balanceAfter = await ethers.provider.getBalance(distHelper.address);
        expect(balanceAfter).lt(ethers.utils.parseEther("10"))
        expect(balanceAfter).gte(ethers.utils.parseEther("10").sub((await distHelper.feeSettings()).maxFee))
        const result = await tx.wait()
        const lzEvent = result.events?.find(e => e.topics[0] === "0xabeeb7182c7294cd8efcd40e9ff952c1b759c2165b3634aac589429de5d55ad0")

        const [targetChainId, normalizedAmount, timestamp, bridge] = ethers.utils.defaultAbiCoder.decode(["uint256", "uint256", "uint256", "uint8"], lzEvent.data)

        expect(targetChainId).eq(122)
        expect(normalizedAmount).eq(ethers.utils.parseEther("100000000").div(2))
        expect(bridge).eq(1) //LZ
        expect(tx).not.reverted

    })
})