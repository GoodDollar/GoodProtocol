// import { GReputationInstance } from "../types/GReputation";
import MerkleTree, { checkProofOrdered } from "merkle-tree-solidity";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { BigNumber, Signer } from "ethers";
import { sign } from "crypto";
import { expect } from "chai";
import { GReputation } from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { advanceBlocks, createDAO, increaseTime } from "../helpers";
import { TextDecoder } from "util";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;

type BlockChainState = {
  stateHash: string;
  hashType: BigNumber;
  totalSupply: BigNumber;
  blockNumber: BigNumber;
};

let grep: GReputation, grepWithOwner: GReputation, identity, gd, bounty;
let signers: SignerWithAddress[],
  founder,
  repOwner,
  rep1,
  rep2,
  rep3,
  repTarget,
  delegator,
  setDAOAddress,
  avatar;

const fuseHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("fuse"));
describe("GReputation Merkle V2", () => {
  let merkleRoot: any, proof: any;
  let avatarGenericCall;

  before(async () => {
    let {
      reputation,
      setDAOAddress: sda,
      avatar: av,
      genericCall
    } = await loadFixture(createDAO);

    setDAOAddress = sda;
    avatar = av;
    avatarGenericCall = genericCall;

    grep = (await ethers.getContractAt(
      "GReputation",
      reputation
    )) as GReputation;

    signers = await ethers.getSigners();
    [founder, repOwner, rep1, rep2, rep3, repTarget] = signers.map(
      _ => _.address
    );
    delegator = ethers.Wallet.createRandom().connect(ethers.provider);

    grepWithOwner = await grep.connect(ethers.provider.getSigner(repOwner));
  });

  describe("legacy with positions", async () => {
    it("should set rootState", async () => {
      let encodedCall = grep.interface.encodeFunctionData(
        "setBlockchainStateHash",
        [
          "rootState",
          "0x20fff2ba627e4337c2bd82aff0cb20cdce809bd9675f149edc32598a85e464e4",
          100
        ]
      );

      await avatarGenericCall(grep.address, encodedCall);
      const rootState = await grep.blockchainStates(await grep.ROOT_STATE(), 0);
      expect(rootState[0]).to.be.equal(
        "0x20fff2ba627e4337c2bd82aff0cb20cdce809bd9675f149edc32598a85e464e4"
      );
    });

    it("should prove leaf with positions", async () => {
      await grep.proveBalanceOfAtBlockchainLegacy(
        "rootState",
        "0x73cbb02cafe29bfda5235ed98edec5406b6512e5",
        "0x8343be193b694ab0",
        [
          "0x460fc64aad90fbc82a7471281bbc55c1fc8f9ca1e21d08584148066181a74f0f",
          "0x2a6ee6e717ff88922a7b7c803e4295bf30f8623dfe140945f7a5eb4315458a9a",
          "0xeadd77f612cf2e56c7a807e98f40a629efb34ba03821a12cac514b094d25a926",
          "0x2b2bd1954c065e583e7396b070773a89e87ee858485276dafd86456d354f6b12",
          "0x77b313fea73f4e4c07737540a3c0acedc329961a91e28c59d1730baec8468e4e",
          "0x516284aa8d3550d2057e334e8a5c28e98bcea77d87210c4c150777275c7c8725",
          "0x6429086161f7f0e20c01b70392e282a2b23b36a8d008044288f11dfa0d3b9884",
          "0x2173e73454370bbfd1fc631a4a9d2e0c137b4dbf2de143588d1c6ee252c3b3a4",
          "0x7f1cee84605832c9be1a547f6591e209c1116206a14b2f99e56696c550622af2",
          "0xb13201fa214c25b8c72f3076b4ad27ce9a734328671545c9b76f350f63779549"
        ],
        [false, true, false, false, false, false, false, false, false, false],
        275342
      );

      expect(
        await grep.balanceOf("0x73cbb02cafe29bfda5235ed98edec5406b6512e5")
      ).to.eq("0x8343be193b694ab0");
    });
  });

  describe("v2 sorted pairs", async () => {
    it("should set sorted rootState", async () => {
      let { reputation, genericCall } = await loadFixture(createDAO);

      let avatarGenericCall = genericCall;

      grep = (await ethers.getContractAt(
        "GReputation",
        reputation
      )) as GReputation;
      let encodedCall = grep.interface.encodeFunctionData(
        "setBlockchainStateHash",
        [
          "rootState",
          "0x7a0be1cac756f662e1c04672fc6d4e6fc348a083d59eccad463c4729197aafc4", //root generated from original airdrop using airdropCalculationSorted
          100
        ]
      );

      await avatarGenericCall(grep.address, encodedCall);
      const rootState = await grep.blockchainStates(await grep.ROOT_STATE(), 0);
      expect(rootState[0]).to.be.equal(
        "0x7a0be1cac756f662e1c04672fc6d4e6fc348a083d59eccad463c4729197aafc4"
      );
    });

    it("should prove short proof without positions", async () => {
      await grep.proveBalanceOfAtBlockchain(
        "rootState",
        "0x73cbb02cafe29bfda5235ed98edec5406b6512e5",
        "0x8343be193b694ab0",
        [
          "0x16b4477cc04a024bf3505f6a04f7bca76a2ddec2107502b66da5e71b91d76d61",
          "0x4f7623e2249c2a3916a23be21df536eb9a34eadf9cb10be39b426fe9800c28f2",
          "0x6814dbe4325de04981883400281fb0913ca4221c66616320588ff4a5d13b87c0",
          "0x302d117bdfd5fc86fc9e42ed39edbd4306f8c247d171d9cee6aec1aa0936fa6d",
          "0x64b3c1913ccd4d0c32627e08b55bc9df1640b93a351f1806dd381344d3f8117d",
          "0xebac0d3e42de13b283926dd841f99ad160764f4bf7df0bd27f9d27e1fc575e28",
          "0x9f228b6657ab294880377a0084efac1c0cf0769a881ab2580f8e140285264ef8",
          "0x958adc0fd01418770b5214bc253228f2eaf025685d96e96fadcf228d112ebb5d",
          "0x3389f783d56926987e6f54bd257eafe4a1c6c17e86eb2c686bd4b7cd3726956e",
          "0x4ba8453af6dc5f85a5bb758cddff71de67735af8688f19ae436c964d12383434"
        ]
      );

      expect(
        await grep.balanceOf("0x73cbb02cafe29bfda5235ed98edec5406b6512e5")
      ).to.eq("0x8343be193b694ab0");
    });

    it("should prove long proof without positions", async () => {
      await grep.proveBalanceOfAtBlockchain(
        "rootState",
        "0xe0326d833fa61bf4a37108d00c77a700a8276c0b",
        "0x07d517539148",
        [
          "0xb213cae084b76277ba2ff96258ced405d9d69904b932e54017879cc2a17039ce",
          "0xa592de93f8aa839606caaf8e5c6c7c80e7f5aeccfd9e9b01cdb3c6d302b995f2",
          "0xda4ec40bfbf97695170491a63ecf40d56b4bd9ccb4ff4b6449fbabfb90c1d6d5",
          "0x5f0020fc15d953bbfbf8ff642a5d516e23e53e69cc602f5180da269825e03cb7",
          "0xb5fbae38ef9aa4af85d9f9b3d79e2080d0aae03c0bdc1063ec719524937d4617",
          "0x9652e4f02994100d797cd62f2102fb2010299f9228745c924a895f6a3b4c82a3",
          "0xc8e7219998db3fc584b0c9c38a23a1bd0d89bfbfb409f970565182733cbaef8b",
          "0x7cbe12dea3c97e7af5872b9a2b4b9ab17eda9d32758836c56c62be6d7bc37a81",
          "0xe3313f60cd92e011d28528863b42dee27bb5501a9e2da5328325ac4e85fae3fc",
          "0x62a7c34c32351d3ec8b97bf636df52db61d2689cfa422498bb4d11c269cdb42d",
          "0xb611c79fb268c7a4a46833850a18246b301bf5c2f9922b76ec812dbb378b4af1",
          "0x22c12c49e96fbad43dbd595b50f499599d6f187fce1d7441f723eb7988268bed",
          "0x32ddaba430296ba4ba670862a96395a5a31017976a49f5c7d35a444078347264",
          "0x1db8774ee444f0e8424f8c6e3295e3c4b4313d0b7b0c7789a5c63df985119c51",
          "0x4ba8453af6dc5f85a5bb758cddff71de67735af8688f19ae436c964d12383434"
        ]
      );

      expect(
        await grep.balanceOf("0xe0326d833fa61bf4a37108d00c77a700a8276c0b")
      ).to.eq(8611800781128);
    });
  });
});
