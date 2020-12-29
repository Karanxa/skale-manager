import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { ConstantsHolderInstance,
         ContractManagerInstance,
         KeyStorageInstance,
         NodesInstance,
         SchainsInternalInstance,
         SchainsInstance,
         SkaleDKGTesterInstance,
         SkaleManagerInstance,
         ValidatorServiceInstance,
         NodeRotationInstance} from "../types/truffle-contracts";

import BigNumber from "bignumber.js";
import { skipTime, currentTime } from "./tools/time";

import * as elliptic from "elliptic";
const EC = elliptic.ec;
const ec = new EC("secp256k1");
import { privateKeys } from "./tools/private-keys";

import { deployConstantsHolder } from "./tools/deploy/constantsHolder";
import { deployContractManager } from "./tools/deploy/contractManager";
import { deployKeyStorage } from "./tools/deploy/keyStorage";
import { deployValidatorService } from "./tools/deploy/delegation/validatorService";
import { deployNodes } from "./tools/deploy/nodes";
import { deploySchainsInternal } from "./tools/deploy/schainsInternal";
import { deploySchains } from "./tools/deploy/schains";
import { deploySkaleDKGTester } from "./tools/deploy/test/skaleDKGTester";
import { deploySkaleManager } from "./tools/deploy/skaleManager";
import { deployNodeRotation } from "./tools/deploy/nodeRotation";

chai.should();
chai.use(chaiAsPromised);

contract("Schains", ([owner, holder, validator, nodeAddress, nodeAddress2, nodeAddress3]) => {
    let constantsHolder: ConstantsHolderInstance;
    let contractManager: ContractManagerInstance;
    let schains: SchainsInstance;
    let schainsInternal: SchainsInternalInstance;
    let nodes: NodesInstance;
    let validatorService: ValidatorServiceInstance;
    let skaleDKG: SkaleDKGTesterInstance;
    let skaleManager: SkaleManagerInstance;
    let keyStorage: KeyStorageInstance;
    let nodeRotation: NodeRotationInstance;

    beforeEach(async () => {
        contractManager = await deployContractManager();

        constantsHolder = await deployConstantsHolder(contractManager);
        nodes = await deployNodes(contractManager);
        schainsInternal = await deploySchainsInternal(contractManager);
        schains = await deploySchains(contractManager);
        validatorService = await deployValidatorService(contractManager);
        skaleDKG = await deploySkaleDKGTester(contractManager);
        await contractManager.setContractsAddress("SkaleDKG", skaleDKG.address);
        keyStorage = await deployKeyStorage(contractManager);
        skaleManager = await deploySkaleManager(contractManager);
        nodeRotation = await deployNodeRotation(contractManager);

        await validatorService.registerValidator("D2", "D2 is even", 0, 0, {from: validator});
        const validatorIndex = await validatorService.getValidatorId(validator);
        await validatorService.enableValidator(validatorIndex, {from: owner});
        let signature = await web3.eth.sign(web3.utils.soliditySha3(validatorIndex.toString()), nodeAddress);
        signature = (signature.slice(130) === "00" ? signature.slice(0, 130) + "1b" :
            (signature.slice(130) === "01" ? signature.slice(0, 130) + "1c" : signature));
        await validatorService.linkNodeAddress(nodeAddress, signature, {from: validator});
        let signature2 = await web3.eth.sign(web3.utils.soliditySha3(validatorIndex.toString()), nodeAddress2);
        signature2 = (signature2.slice(130) === "00" ? signature2.slice(0, 130) + "1b" :
            (signature2.slice(130) === "01" ? signature2.slice(0, 130) + "1c" : signature2));
        await validatorService.linkNodeAddress(nodeAddress2, signature2, {from: validator});
        let signature3 = await web3.eth.sign(web3.utils.soliditySha3(validatorIndex.toString()), nodeAddress3);
        signature3 = (signature3.slice(130) === "00" ? signature3.slice(0, 130) + "1b" :
            (signature3.slice(130) === "01" ? signature3.slice(0, 130) + "1c" : signature3));
        await validatorService.linkNodeAddress(nodeAddress3, signature3, {from: validator});
        await constantsHolder.setMSR(0);
    });

    describe("should add schain", async () => {
        it("should fail when money are not enough", async () => {
            await schains.addSchain(
                holder,
                5,
                web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 1, 0, "d2"]),
                {from: owner})
                .should.be.eventually.rejectedWith("Not enough money to create Schain");
        });

        it("should not allow everyone to create schains as the foundation", async () => {
            await schains.addSchainByFoundation(5, 1, 0, "d2")
                .should.be.eventually.rejectedWith("Sender is not authorized to create schain");
        })

        it("should fail when schain type is wrong", async () => {
            await schains.addSchain(
                holder,
                5,
                web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 6, 0, "d2"]),
                {from: owner})
                .should.be.eventually.rejectedWith("Bad schain type");
        });

        it("should fail when data parameter is too short", async () => {
            await schains.addSchain(
                holder,
                5,
                web3.eth.abi.encodeParameters(["uint", "uint8", "uint16"], [5, 6, 0]),
                {from: owner}).
                should.be.eventually.rejected;
        });

        it("should fail when schain name is Mainnet", async () => {
            const price = new BigNumber(await schains.getSchainPrice(1, 5));
            await schains.addSchain(
                holder,
                price.toString(),
                web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 1, 0, "Mainnet"]),
                {from: owner})
                .should.be.eventually.rejectedWith("Schain name is not available");
        });

        it("should fail when nodes count is too low", async () => {
            const price = new BigNumber(await schains.getSchainPrice(1, 5));
            await schains.addSchain(
                holder,
                price.toString(),
                web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 1, 0, "d2"]),
                {from: owner})
                .should.be.eventually.rejectedWith("Not enough nodes to create Schain");
        });

        describe("when 2 nodes are registered (Ivan test)", async () => {
            it("should create 2 nodes, and play with schains", async () => {
                const nodesCount = 2;
                const pubKey = ec.keyFromPrivate(String(privateKeys[3]).slice(2)).getPublic();
                for (const index of Array.from(Array(nodesCount).keys())) {
                    const hexIndex = ("0" + index.toString(16)).slice(-2);
                    await skaleManager.createNode(
                        8545, // port
                        0, // nonce
                        "0x7f0000" + hexIndex, // ip
                        "0x7f0000" + hexIndex, // public ip
                        ["0x" + pubKey.x.toString('hex'), "0x" + pubKey.y.toString('hex')], // public key
                        "D2-" + hexIndex, // name
                        {from: nodeAddress});
                }

                const deposit = await schains.getSchainPrice(4, 5);

                await schains.addSchain(
                    owner,
                    deposit,
                    web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 4, 0, "d2"]),
                    {from: owner});

                await schains.addSchain(
                    owner,
                    deposit,
                    web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 4, 0, "d3"]),
                    {from: owner});

                await schains.deleteSchain(
                    owner,
                    "d2",
                    {from: owner});

                await schains.deleteSchain(
                    owner,
                    "d3",
                    {from: owner});
                await schainsInternal.getActiveSchains(0).should.be.eventually.empty;
                await schainsInternal.getActiveSchains(1).should.be.eventually.empty;

                await nodes.initExit(0, {from: owner});
                await nodes.completeExit(0, {from: owner});
                await nodes.initExit(1, {from: owner});
                await nodes.completeExit(1, {from: owner});

                for (const index of Array.from(Array(nodesCount).keys())) {
                    const hexIndex = ("1" + index.toString(16)).slice(-2);
                    await skaleManager.createNode(
                        8545, // port
                        0, // nonce
                        "0x7f0000" + hexIndex, // ip
                        "0x7f0000" + hexIndex, // public ip
                        ["0x" + pubKey.x.toString('hex'), "0x" + pubKey.y.toString('hex')], // public key
                        "D2-" + hexIndex, // name
                        {from: nodeAddress});
                }

                await schains.addSchain(
                    holder,
                    deposit,
                    web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 4, 0, "d4"]),
                    {from: owner});
            });
        });

        describe("when 2 nodes are registered (Node rotation test)", async () => {
            it("should create 2 nodes, and play with schains", async () => {
                const nodesCount = 2;
                const pubKey = ec.keyFromPrivate(String(privateKeys[3]).slice(2)).getPublic();
                for (const index of Array.from(Array(nodesCount).keys())) {
                    const hexIndex = ("0" + index.toString(16)).slice(-2);
                    await skaleManager.createNode(
                        8545, // port
                        0, // nonce
                        "0x7f0000" + hexIndex, // ip
                        "0x7f0000" + hexIndex, // public ip
                        ["0x" + pubKey.x.toString('hex'), "0x" + pubKey.y.toString('hex')], // public key
                        "D2-" + hexIndex, // name
                        {from: nodeAddress});
                }

                const deposit = await schains.getSchainPrice(4, 5);

                const verificationVector = [{
                    x: {
                        a: "0x02c2b888a23187f22195eadadbc05847a00dc59c913d465dbc4dfac9cfab437d",
                        b: "0x2695832627b9081e77da7a3fc4d574363bf051700055822f3d394dc3d9ff7417",
                    },
                    y: {
                        a: "0x24727c45f9322be756fbec6514525cbbfa27ef1951d3fed10f483c23f921879d",
                        b: "0x03a7a3e6f3b539dad43c0eca46e3f889b2b2300815ffc4633e26e64406625a99"
                    }
                }];

                const encryptedSecretKeyContribution = [
                    {
                        share: "0x937c9c846a6fa7fd1984fe82e739ae37fcaa555c1dc0e8597c9f81b6a12f232f",
                        publicKey: [
                            "0xfdf8101e91bd658fa1cea6fdd75adb8542951ce3d251cdaa78f43493dad730b5",
                            "0x9d32d2e872b36aa70cdce544b550ebe96994de860b6f6ebb7d0b4d4e6724b4bf"
                        ]
                    },
                    {
                        share: "0x7232f27fdfe521f3c7997dbb1c15452b7f196bd119d915ce76af3d1a008e1810",
                        publicKey: [
                            "0x086ff076abe442563ae9b8938d483ae581f4de2ee54298b3078289bbd85250c8",
                            "0xdf956450d32f671e4a8ec1e584119753ff171e80a61465246bfd291e8dac3d77"
                        ]
                    }
                ];

                await schains.addSchain(
                    owner,
                    deposit,
                    web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 4, 0, "d2"]),
                    {from: owner});
                let res1 = await schainsInternal.getNodesInGroup(web3.utils.soliditySha3("d2"));
                let res = await skaleDKG.isBroadcastPossible(web3.utils.soliditySha3("d2"), res1[0], {from: nodeAddress});
                assert.equal(res, true);
                await skaleDKG.broadcast(
                    web3.utils.soliditySha3("d2"),
                    res1[0],
                    verificationVector,
                    // the last symbol is spoiled in parameter below
                    encryptedSecretKeyContribution,
                    {from: nodeAddress},
                );
                res = await skaleDKG.isBroadcastPossible(web3.utils.soliditySha3("d2"), res1[1], {from: nodeAddress});
                assert.equal(res, true);
                await skaleDKG.broadcast(
                    web3.utils.soliditySha3("d2"),
                    res1[1],
                    verificationVector,
                    // the last symbol is spoiled in parameter below
                    encryptedSecretKeyContribution,
                    {from: nodeAddress},
                );

                res = await skaleDKG.isChannelOpened(web3.utils.soliditySha3("d2"));
                assert.equal(res, true);

                res = await skaleDKG.isAlrightPossible(
                    web3.utils.soliditySha3("d2"),
                    res1[0],
                    {from: nodeAddress},
                );
                assert.equal(res, true);

                await skaleDKG.alright(
                    web3.utils.soliditySha3("d2"),
                    res1[0],
                    {from: nodeAddress},
                );

                res = await skaleDKG.isChannelOpened(web3.utils.soliditySha3("d2"));
                assert.equal(res, true);

                res = await skaleDKG.isAlrightPossible(
                    web3.utils.soliditySha3("d2"),
                    res1[1],
                    {from: nodeAddress},
                );
                assert.equal(res, true);

                await skaleDKG.alright(
                    web3.utils.soliditySha3("d2"),
                    res1[1],
                    {from: nodeAddress},
                );

                await skaleManager.createNode(
                    8545, // port
                    0, // nonce
                    "0x7f000011", // ip
                    "0x7f000011", // public ip
                    ["0x" + pubKey.x.toString('hex'), "0x" + pubKey.y.toString('hex')], // public key
                    "D2-11", // name
                    {from: nodeAddress});

                res = await skaleDKG.isChannelOpened(web3.utils.soliditySha3("d2"));
                assert.equal(res, false);

                await skaleManager.nodeExit(0, {from: nodeAddress});
                res1 = await schainsInternal.getNodesInGroup(web3.utils.soliditySha3("d2"));
                const nodeRot = res1[1];
                res = await skaleDKG.isBroadcastPossible(web3.utils.soliditySha3("d2"), nodeRot, {from: nodeAddress});
                assert.equal(res, true);
                res = await skaleDKG.isBroadcastPossible(web3.utils.soliditySha3("d2"), res1[0], {from: nodeAddress});
                assert.equal(res, true);
                await skaleDKG.broadcast(
                    web3.utils.soliditySha3("d2"),
                    res1[0],
                    verificationVector,
                    // the last symbol is spoiled in parameter below
                    encryptedSecretKeyContribution,
                    {from: nodeAddress},
                );
                res = await skaleDKG.isBroadcastPossible(web3.utils.soliditySha3("d2"), res1[1], {from: nodeAddress});
                assert.equal(res, true);
                await skaleDKG.broadcast(
                    web3.utils.soliditySha3("d2"),
                    res1[1],
                    verificationVector,
                    // the last symbol is spoiled in parameter below
                    encryptedSecretKeyContribution,
                    {from: nodeAddress},
                );

                res = await skaleDKG.isChannelOpened(web3.utils.soliditySha3("d2"));
                assert.equal(res, true);

                res = await skaleDKG.isAlrightPossible(
                    web3.utils.soliditySha3("d2"),
                    res1[0],
                    {from: nodeAddress},
                );
                assert.equal(res, true);

                await skaleDKG.alright(
                    web3.utils.soliditySha3("d2"),
                    res1[0],
                    {from: nodeAddress},
                );

                res = await skaleDKG.isChannelOpened(web3.utils.soliditySha3("d2"));
                assert.equal(res, true);

                res = await skaleDKG.isAlrightPossible(
                    web3.utils.soliditySha3("d2"),
                    res1[1],
                    {from: nodeAddress},
                );
                assert.equal(res, true);

                await skaleDKG.alright(
                    web3.utils.soliditySha3("d2"),
                    res1[1],
                    {from: nodeAddress},
                );
            });
        });

        describe("when 4 nodes are registered", async () => {
            beforeEach(async () => {
                const nodesCount = 4;
                const pubKey = ec.keyFromPrivate(String(privateKeys[3]).slice(2)).getPublic();
                for (const index of Array.from(Array(nodesCount).keys())) {
                    const hexIndex = ("0" + index.toString(16)).slice(-2);
                    await skaleManager.createNode(
                        8545, // port
                        0, // nonce
                        "0x7f0000" + hexIndex, // ip
                        "0x7f0000" + hexIndex, // public ip
                        ["0x" + pubKey.x.toString('hex'), "0x" + pubKey.y.toString('hex')], // public key
                        "D2-" + hexIndex, // name
                        {from: nodeAddress});
                }
            });

            it("should create 4 node schain", async () => {
                const deposit = await schains.getSchainPrice(5, 5);

                await schains.addSchain(
                    holder,
                    deposit,
                    web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 5, 0, "d2"]),
                    {from: owner});

                const sChains = await schainsInternal.getSchains();
                sChains.length.should.be.equal(1);
                const schainId = sChains[0];

                await schainsInternal.isOwnerAddress(holder, schainId).should.be.eventually.true;
            });

            it("should not create 4 node schain with 1 deleted node", async () => {
                await nodes.initExit(1);
                await nodes.completeExit(1);

                const deposit = await schains.getSchainPrice(5, 5);

                await schains.addSchain(
                    holder,
                    deposit,
                    web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 5, 0, "d2"]),
                    {from: owner}).should.be.eventually.rejectedWith("Not enough nodes to create Schain");
            });

            it("should not create 4 node schain with 1 In Maintenance node", async () => {
                await nodes.setNodeInMaintenance(2);

                const deposit = await schains.getSchainPrice(5, 5);

                await schains.addSchain(
                    holder,
                    deposit,
                    web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 5, 0, "d2"]),
                    {from: owner}).should.be.eventually.rejectedWith("Not enough nodes to create Schain");
            });

            it("should create 4 node schain with 1 From In Maintenance node", async () => {
                await nodes.setNodeInMaintenance(2);

                const deposit = await schains.getSchainPrice(5, 5);

                await schains.addSchain(
                    holder,
                    deposit,
                    web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 5, 0, "d2"]),
                    {from: owner}).should.be.eventually.rejectedWith("Not enough nodes to create Schain");

                await nodes.removeNodeFromInMaintenance(2);

                await schains.addSchain(
                    holder,
                    deposit,
                    web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 5, 0, "d2"]),
                    {from: owner});

                const sChains = await schainsInternal.getSchains();
                sChains.length.should.be.equal(1);
                const schainId = sChains[0];

                await schainsInternal.isOwnerAddress(holder, schainId).should.be.eventually.true;
            });

            it("should not create 4 node schain on deleted node", async () => {
                let data = await nodes.getNodesWithFreeSpace(32);
                const removedNode = 1;
                await nodes.initExit(removedNode);
                await nodes.completeExit(removedNode);

                data = await nodes.getNodesWithFreeSpace(32);

                const pubKey = ec.keyFromPrivate(String(privateKeys[3]).slice(2)).getPublic();
                await skaleManager.createNode(
                    8545, // port
                    0, // nonce
                    "0x7f000028", // ip
                    "0x7f000028", // public ip
                    ["0x" + pubKey.x.toString('hex'), "0x" + pubKey.y.toString('hex')], // public key
                    "D2-28", // name
                    {from: nodeAddress});

                const deposit = await schains.getSchainPrice(5, 5);

                data = await nodes.getNodesWithFreeSpace(32);

                await schains.addSchain(
                    holder,
                    deposit,
                    web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 5, 0, "d2"]),
                    {from: owner});

                let nodesInGroup = await schainsInternal.getNodesInGroup(web3.utils.soliditySha3("d2"));

                for (const node of nodesInGroup) {
                    expect(web3.utils.toBN(node).toNumber()).to.be.not.equal(removedNode);
                }

                data = await nodes.getNodesWithFreeSpace(32);

                await schains.addSchain(
                    holder,
                    deposit,
                    web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 5, 0, "d3"]),
                    {from: owner});

                nodesInGroup = await schainsInternal.getNodesInGroup(web3.utils.soliditySha3("d3"));

                for (const node of nodesInGroup) {
                    expect(web3.utils.toBN(node).toNumber()).to.be.not.equal(removedNode);
                }

                data = await nodes.getNodesWithFreeSpace(32);

                await schains.addSchain(
                    holder,
                    deposit,
                    web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 5, 0, "d4"]),
                    {from: owner});

                nodesInGroup = await schainsInternal.getNodesInGroup(web3.utils.soliditySha3("d4"));

                for (const node of nodesInGroup) {
                    expect(web3.utils.toBN(node).toNumber()).to.be.not.equal(removedNode);
                }

                data = await nodes.getNodesWithFreeSpace(32);

                await schains.addSchain(
                    holder,
                    deposit,
                    web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 5, 0, "d5"]),
                    {from: owner});

                nodesInGroup = await schainsInternal.getNodesInGroup(web3.utils.soliditySha3("d5"));

                for (const node of nodesInGroup) {
                    expect(web3.utils.toBN(node).toNumber()).to.be.not.equal(removedNode);
                }
            });

            it("should create & delete 4 node schain", async () => {
                const deposit = await schains.getSchainPrice(5, 5);

                await schains.addSchain(
                    holder,
                    deposit,
                    web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 5, 0, "d2"]),
                    {from: owner});

                const sChains = await schainsInternal.getSchains();
                sChains.length.should.be.equal(1);
                const schainId = sChains[0];

                await schainsInternal.isOwnerAddress(holder, schainId).should.be.eventually.true;

                await schains.deleteSchain(
                    holder,
                    "d2",
                    {from: owner});

                await schainsInternal.getSchains().should.be.eventually.empty;
            });

            it("should allow the foundation to create schain without tokens", async () => {
                const schainCreator = holder;
                await schains.grantRole(await schains.SCHAIN_CREATOR_ROLE(), schainCreator);
                await schains.addSchainByFoundation(5, 5, 0, "d2", {from: schainCreator});

                const sChains = await schainsInternal.getSchains();
                sChains.length.should.be.equal(1);
                const schainId = sChains[0];

                await schainsInternal.isOwnerAddress(schainCreator, schainId).should.be.eventually.true;
            });

            it("should assign schain creator on different address", async () => {
                await schains.grantRole(await schains.SCHAIN_CREATOR_ROLE(), holder, {from: owner});
                await schains.addSchainByFoundation(5, 5, 0, "d2", {from: holder});

                const sChains = await schainsInternal.getSchains();
                sChains.length.should.be.equal(1);
                const schainId = sChains[0];

                await schainsInternal.isOwnerAddress(holder, schainId).should.be.eventually.true;
            });

        });

        describe("when 20 nodes are registered", async () => {
            beforeEach(async () => {
                const nodesCount = 20;
                const pubKey = ec.keyFromPrivate(String(privateKeys[3]).slice(2)).getPublic();
                for (const index of Array.from(Array(nodesCount).keys())) {
                    const hexIndex = ("0" + index.toString(16)).slice(-2);
                    await skaleManager.createNode(
                        8545, // port
                        0, // nonce
                        "0x7f0000" + hexIndex, // ip
                        "0x7f0000" + hexIndex, // public ip
                        ["0x" + pubKey.x.toString('hex'), "0x" + pubKey.y.toString('hex')], // public key
                        "D2-" + hexIndex, // name
                        {from: nodeAddress});
                }
            });

            it("should create Medium schain", async () => {
                const deposit = await schains.getSchainPrice(3, 5);

                await schains.addSchain(
                    holder,
                    deposit,
                    web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 3, 0, "d2"]),
                    {from: owner});

                const sChains = await schainsInternal.getSchains();
                sChains.length.should.be.equal(1);
            });

            it("should not create another Medium schain", async () => {
                const deposit = await schains.getSchainPrice(3, 5);

                await schains.addSchain(
                    holder,
                    deposit,
                    web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 3, 0, "d2"]),
                    {from: owner});

                await schains.addSchain(
                    holder,
                    deposit,
                    web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 3, 0, "d3"]),
                    {from: owner},
                ).should.be.eventually.rejectedWith("Not enough nodes to create Schain");
            });

            it("should assign schain creator on different address and create small schain", async () => {
                await schains.grantRole(await schains.SCHAIN_CREATOR_ROLE(), holder, {from: owner});
                await schains.addSchainByFoundation(5, 1, 0, "d2", {from: holder});

                const sChains = await schainsInternal.getSchains();
                sChains.length.should.be.equal(1);
                const schainId = sChains[0];

                await schainsInternal.isOwnerAddress(holder, schainId).should.be.eventually.true;
            });

            it("should assign schain creator on different address and create medium schain", async () => {
                await schains.grantRole(await schains.SCHAIN_CREATOR_ROLE(), holder, {from: owner});
                await schains.addSchainByFoundation(5, 2, 0, "d2", {from: holder});

                const sChains = await schainsInternal.getSchains();
                sChains.length.should.be.equal(1);
                const schainId = sChains[0];

                await schainsInternal.isOwnerAddress(holder, schainId).should.be.eventually.true;
            });

            it("should assign schain creator on different address and create large schain", async () => {
                await schains.grantRole(await schains.SCHAIN_CREATOR_ROLE(), holder, {from: owner});
                await schains.addSchainByFoundation(5, 3, 0, "d2", {from: holder});

                const sChains = await schainsInternal.getSchains();
                sChains.length.should.be.equal(1);
                const schainId = sChains[0];

                await schainsInternal.isOwnerAddress(holder, schainId).should.be.eventually.true;
            });
        });

        describe("when nodes are registered", async () => {

            beforeEach(async () => {
                const nodesCount = 16;
                const pubKey = ec.keyFromPrivate(String(privateKeys[3]).slice(2)).getPublic();
                for (const index of Array.from(Array(nodesCount).keys())) {
                    const hexIndex = ("0" + index.toString(16)).slice(-2);
                    await skaleManager.createNode(
                        8545, // port
                        0, // nonce
                        "0x7f0000" + hexIndex, // ip
                        "0x7f0000" + hexIndex, // public ip
                        ["0x" + pubKey.x.toString('hex'), "0x" + pubKey.y.toString('hex')], // public key
                        "D2-" + hexIndex, // name
                        {from: nodeAddress});
                }
            });

            it("successfully create 1 type Of Schain", async () => {
                const deposit = await schains.getSchainPrice(1, 5);

                await schains.addSchain(
                    holder,
                    deposit,
                    web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 1, 0, "d2"]),
                    {from: owner});

                const sChains = await schainsInternal.getSchains();
                sChains.length.should.be.equal(1);
                const schainId = sChains[0];

                await schainsInternal.isOwnerAddress(holder, schainId).should.be.eventually.true;

                const obtainedSchains = await schainsInternal.schains(schainId);
                const schainsArray = Array(8);
                for (const index of Array.from(Array(8).keys())) {
                    schainsArray[index] = obtainedSchains[index];
                }

                const [obtainedSchainName,
                       obtainedSchainOwner,
                       obtainedIndexInOwnerList,
                       obtainedPart,
                       obtainedLifetime,
                       obtainedStartDate,
                       obtainedBlock,
                       obtainedDeposit,
                       obtainedIndex] = schainsArray;

                obtainedSchainName.should.be.equal("d2");
                obtainedSchainOwner.should.be.equal(holder);
                expect(obtainedPart.eq(web3.utils.toBN(1))).be.true;
                expect(obtainedLifetime.eq(web3.utils.toBN(5))).be.true;
                expect(obtainedDeposit.eq(web3.utils.toBN(deposit))).be.true;
            });

            it("should add new type of Schain and create Schain", async () => {
                await schainsInternal.addSchainType(8, 16, {from: owner});
                const deposit = await schains.getSchainPrice(6, 5);

                await schains.addSchain(
                    holder,
                    deposit,
                    web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 6, 0, "d2"]),
                    {from: owner});

                const sChains = await schainsInternal.getSchains();
                sChains.length.should.be.equal(1);
                const schainId = sChains[0];

                await schainsInternal.isOwnerAddress(holder, schainId).should.be.eventually.true;

                const obtainedSchains = await schainsInternal.schains(schainId);
                const schainsArray = Array(8);
                for (const index of Array.from(Array(8).keys())) {
                    schainsArray[index] = obtainedSchains[index];
                }

                const [obtainedSchainName,
                       obtainedSchainOwner,
                       obtainedIndexInOwnerList,
                       obtainedPart,
                       obtainedLifetime,
                       obtainedStartDate,
                       obtainedBlock,
                       obtainedDeposit,
                       obtainedIndex] = schainsArray;

                obtainedSchainName.should.be.equal("d2");
                obtainedSchainOwner.should.be.equal(holder);
                expect(obtainedPart.eq(web3.utils.toBN(8))).be.true;
                expect(obtainedLifetime.eq(web3.utils.toBN(5))).be.true;
                expect(obtainedDeposit.eq(web3.utils.toBN(deposit))).be.true;
            });

            it("should add another new type of Schain and create Schain", async () => {
                await schainsInternal.addSchainType(32, 16, {from: owner});
                const deposit = await schains.getSchainPrice(6, 5);

                await schains.addSchain(
                    holder,
                    deposit,
                    web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 6, 0, "d2"]),
                    {from: owner});

                const sChains = await schainsInternal.getSchains();
                sChains.length.should.be.equal(1);
                const schainId = sChains[0];

                await schainsInternal.isOwnerAddress(holder, schainId).should.be.eventually.true;

                const obtainedSchains = await schainsInternal.schains(schainId);
                const schainsArray = Array(8);
                for (const index of Array.from(Array(8).keys())) {
                    schainsArray[index] = obtainedSchains[index];
                }

                const [obtainedSchainName,
                       obtainedSchainOwner,
                       obtainedIndexInOwnerList,
                       obtainedPart,
                       obtainedLifetime,
                       obtainedStartDate,
                       obtainedBlock,
                       obtainedDeposit,
                       obtainedIndex] = schainsArray;

                obtainedSchainName.should.be.equal("d2");
                obtainedSchainOwner.should.be.equal(holder);
                expect(obtainedPart.eq(web3.utils.toBN(32))).be.true;
                expect(obtainedLifetime.eq(web3.utils.toBN(5))).be.true;
                expect(obtainedDeposit.eq(web3.utils.toBN(deposit))).be.true;
            });

            describe("when schain is created", async () => {

                beforeEach(async () => {
                    const deposit = await schains.getSchainPrice(1, 5);
                    await schains.addSchain(
                        holder,
                        deposit,
                        web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 1, 0, "D2"]),
                        {from: owner});
                });

                it("should failed when create another schain with the same name", async () => {
                    const deposit = await schains.getSchainPrice(1, 5);
                    await schains.addSchain(
                        holder,
                        deposit,
                        web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 1, 0, "D2"]),
                        {from: owner})
                        .should.be.eventually.rejectedWith("Schain name is not available");
                });

                it("should be able to delete schain", async () => {
                    await schains.deleteSchain(
                        holder,
                        "D2",
                        {from: owner});
                    await schainsInternal.getSchains().should.be.eventually.empty;
                });

                it("should check group", async () => {
                    const res = await schainsInternal.getNodesInGroup(web3.utils.soliditySha3("D2"));
                    res.length.should.be.equal(16);
                });

                it("should check node addresses", async () => {
                    expect(await schainsInternal.isNodeAddressesInGroup(web3.utils.soliditySha3("D2"), nodeAddress)).be.true;
                    expect(await schainsInternal.isNodeAddressesInGroup(web3.utils.soliditySha3("D2"), nodeAddress2)).be.false;
                });

                it("should delete group", async () => {
                    await schainsInternal.deleteGroup(web3.utils.soliditySha3("D2"));
                    const res = await schainsInternal.getNodesInGroup(web3.utils.soliditySha3("D2"));
                    res.length.should.be.equal(0);
                    await schainsInternal.getNodesInGroup(web3.utils.soliditySha3("D2")).should.be.eventually.empty;
                });

                it("should fail on deleting schain if owner is wrong", async () => {
                    await schains.deleteSchain(
                        nodeAddress,
                        "D2",
                        {from: owner})
                        .should.be.eventually.rejectedWith("Message sender is not the owner of the Schain");
                });

            });

            describe("when test schain is created", async () => {

                beforeEach(async () => {
                    const deposit = await schains.getSchainPrice(4, 5);
                    await schains.addSchain(
                        holder,
                        deposit,
                        web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 4, 0, "D2"]),
                        {from: owner});
                });

                it("should failed when create another schain with the same name", async () => {
                    const deposit = await schains.getSchainPrice(4, 5);
                    await schains.addSchain(
                        holder,
                        deposit,
                        web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 4, 0, "D2"]),
                        {from: owner})
                        .should.be.eventually.rejectedWith("Schain name is not available");
                });

                it("should be able to delete schain", async () => {

                    await schains.deleteSchain(
                        holder,
                        "D2",
                        {from: owner});
                    await schainsInternal.getSchains().should.be.eventually.empty;
                });

                it("should fail on deleting schain if owner is wrong", async () => {

                    await schains.deleteSchain(
                        nodeAddress,
                        "D2",
                        {from: owner})
                        .should.be.eventually.rejectedWith("Message sender is not the owner of the Schain");
                });

            });

        });
    });

    describe("should calculate schain price", async () => {
        it("of tiny schain", async () => {
            const price = web3.utils.toBN(await schains.getSchainPrice(1, 5));
            const correctPrice = web3.utils.toBN(3952894150981);

            expect(price.eq(correctPrice)).to.be.true;
        });

        it("of small schain", async () => {
            const price = web3.utils.toBN(await schains.getSchainPrice(2, 5));
            const correctPrice = web3.utils.toBN(15811576603926);

            expect(price.eq(correctPrice)).to.be.true;
        });

        it("of medium schain", async () => {
            const price = web3.utils.toBN(await schains.getSchainPrice(3, 5));
            const correctPrice = web3.utils.toBN(505970451325642);

            expect(price.eq(correctPrice)).to.be.true;
        });

        it("of test schain", async () => {
            const price = web3.utils.toBN(await schains.getSchainPrice(4, 5));
            const correctPrice = web3.utils.toBN(1000000000000000000);

            expect(price.eq(correctPrice)).to.be.true;
        });

        it("of medium test schain", async () => {
            const price = web3.utils.toBN(await schains.getSchainPrice(5, 5));
            const correctPrice = web3.utils.toBN(31623153207852);

            expect(price.eq(correctPrice)).to.be.true;
        });

        it("should revert on wrong schain type", async () => {
            await schains.getSchainPrice(6, 5).should.be.eventually.rejectedWith("Bad schain type");
        });
    });

    describe("when 4 nodes, 2 schains and 2 additional nodes created", async () => {
        const ACTIVE = 0;
        const LEAVING = 1;
        const LEFT = 2;
        let nodeStatus;
        beforeEach(async () => {
            const deposit = await schains.getSchainPrice(5, 5);
            const nodesCount = 4;
            const pubKey = ec.keyFromPrivate(String(privateKeys[3]).slice(2)).getPublic();
            for (const index of Array.from(Array(nodesCount).keys())) {
                const hexIndex = ("0" + index.toString(16)).slice(-2);
                await skaleManager.createNode(
                    8545, // port
                    0, // nonce
                    "0x7f0000" + hexIndex, // ip
                    "0x7f0000" + hexIndex, // public ip
                    ["0x" + pubKey.x.toString('hex'), "0x" + pubKey.y.toString('hex')], // public key
                    "D2-" + hexIndex, // name
                    {from: nodeAddress});
            }
            await schains.addSchain(
                holder,
                deposit,
                web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 5, 0, "d2"]),
                {from: owner});
            await skaleDKG.setSuccesfulDKGPublic(
                web3.utils.soliditySha3("d2"),
            );

            await schains.addSchain(
                holder,
                deposit,
                web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 5, 0, "d3"]),
                {from: owner});
            await skaleDKG.setSuccesfulDKGPublic(
                web3.utils.soliditySha3("d3"),
            );
            await skaleManager.createNode(
                8545, // port
                0, // nonce
                "0x7f000010", // ip
                "0x7f000010", // public ip
                ["0x" + pubKey.x.toString('hex'), "0x" + pubKey.y.toString('hex')], // public key
                "D2-10", // name
                {from: nodeAddress});
            await skaleManager.createNode(
                8545, // port
                0, // nonce
                "0x7f000011", // ip
                "0x7f000011", // public ip
                ["0x" + pubKey.x.toString('hex'), "0x" + pubKey.y.toString('hex')], // public key
                "D2-11", // name
                {from: nodeAddress});

        });

        it("should reject if node in maintenance call nodeExit", async () => {
            await nodes.setNodeInMaintenance(0);
            await skaleManager.nodeExit(0, {from: nodeAddress})
                .should.be.eventually.rejectedWith("Node should be Leaving");

        });

        it("should rotate 2 nodes consistently", async () => {
            const res1 = await schainsInternal.getNodesInGroup(web3.utils.soliditySha3("d2"));
            const res2 = await schainsInternal.getNodesInGroup(web3.utils.soliditySha3("d3"));
            await skaleManager.nodeExit(0, {from: nodeAddress});
            const leavingTimeOfNode = new BigNumber(
                (await nodeRotation.getLeavingHistory(0))[0].finishedRotation
            ).toNumber();
            const _12hours = 43200;
            assert.equal(await currentTime(web3), leavingTimeOfNode-_12hours);
            const rotatedSchain = (await nodeRotation.getLeavingHistory(0))[0].schainIndex;
            const rotationForRotatedSchain = await nodeRotation.getRotation(rotatedSchain);
            assert.notEqual(rotationForRotatedSchain.newNodeIndex, new BigNumber(0));
            assert.notEqual(rotationForRotatedSchain.freezeUntil, new BigNumber(0));
            assert.notEqual(rotationForRotatedSchain.rotationCounter, new BigNumber(0));

            const activeSchain = await schainsInternal.getActiveSchain(0);
            const rotationForActiveSchain = await nodeRotation.getRotation(activeSchain);
            assert.equal(rotationForActiveSchain.nodeIndex, new BigNumber(0));
            assert.equal(rotationForActiveSchain.newNodeIndex, new BigNumber(0));
            assert.notEqual(rotationForActiveSchain.freezeUntil, new BigNumber(0));
            assert.equal(rotationForActiveSchain.rotationCounter, new BigNumber(0));

            const nodeRot = res1[3];
            const res = await skaleDKG.isBroadcastPossible(
                web3.utils.soliditySha3("d3"), nodeRot);
            await skaleDKG.setSuccesfulDKGPublic(
                web3.utils.soliditySha3("d3"),
            );
            await skaleManager.nodeExit(1, {from: nodeAddress})
                .should.be.eventually.rejectedWith("Node cannot rotate on Schain d3, occupied by Node 0");
            await skaleManager.nodeExit(0, {from: nodeAddress});
            await skaleDKG.setSuccesfulDKGPublic(
                web3.utils.soliditySha3("d2"),
            );

            const rotationForSecondRotatedSchain = await nodeRotation.getRotation(activeSchain);
            assert.notEqual(rotationForSecondRotatedSchain.newNodeIndex, new BigNumber(0));
            assert.notEqual(rotationForSecondRotatedSchain.freezeUntil, new BigNumber(0));
            assert.notEqual(rotationForSecondRotatedSchain.rotationCounter, new BigNumber(0));

            nodeStatus = (await nodes.getNodeStatus(0)).toNumber();
            assert.equal(nodeStatus, LEFT);
            await skaleManager.nodeExit(0, {from: nodeAddress})
                .should.be.eventually.rejectedWith("Sender is not permitted to call this function");

            nodeStatus = (await nodes.getNodeStatus(1)).toNumber();
            assert.equal(nodeStatus, ACTIVE);
            await skaleManager.nodeExit(1, {from: nodeAddress})
                .should.be.eventually.rejectedWith("Node cannot rotate on Schain d3, occupied by Node 0");
            skipTime(web3, 43260);

            await skaleManager.nodeExit(1, {from: nodeAddress});
            await skaleDKG.setSuccesfulDKGPublic(
                web3.utils.soliditySha3("d3"),
            );
            nodeStatus = (await nodes.getNodeStatus(1)).toNumber();
            assert.equal(nodeStatus, LEAVING);
            await skaleManager.nodeExit(1, {from: nodeAddress});
            await skaleDKG.setSuccesfulDKGPublic(
                web3.utils.soliditySha3("d2"),
            );
            nodeStatus = (await nodes.getNodeStatus(1)).toNumber();
            assert.equal(nodeStatus, LEFT);
            await skaleManager.nodeExit(1, {from: nodeAddress})
                .should.be.eventually.rejectedWith("Sender is not permitted to call this function");
        });

        it("should rotate node on the same position", async () => {
            const arrayD2 = await schainsInternal.getNodesInGroup(web3.utils.soliditySha3("d2"));
            const arrayD3 = await schainsInternal.getNodesInGroup(web3.utils.soliditySha3("d3"));
            await skaleManager.nodeExit(0, {from: nodeAddress});
            const newArrayD3 = await schainsInternal.getNodesInGroup(web3.utils.soliditySha3("d3"));
            let zeroPositionD3 = 0;
            let iter = 0;
            for (const nodeIndex of arrayD3) {
                if (nodeIndex.toNumber() === 0) {
                    zeroPositionD3 = iter;
                }
                iter++;
            }
            let exist4 = false;
            let exist5 = false;
            iter = 0;
            for (const nodeIndex of newArrayD3) {
                if (nodeIndex.toNumber() === 4) {
                    exist4 = true;
                }
                if (nodeIndex.toNumber() === 5) {
                    exist5 = true;
                }
                iter++;
            }
            assert.equal(exist4 && exist5, false);
            assert.equal(
                (exist5 && newArrayD3[zeroPositionD3].toNumber() === 5) ||
                (exist4 && newArrayD3[zeroPositionD3].toNumber() === 4),
                true
            );
            await skaleDKG.setSuccesfulDKGPublic(
                web3.utils.soliditySha3("d3"),
            );
            await skaleManager.nodeExit(0, {from: nodeAddress});
            const newArrayD2 = await schainsInternal.getNodesInGroup(web3.utils.soliditySha3("d2"));
            let zeroPositionD2 = 0;
            iter = 0;
            for (const nodeIndex of arrayD2) {
                if (nodeIndex.toNumber() === 0) {
                    zeroPositionD2 = iter;
                }
                iter++;
            }
            exist4 = false;
            exist5 = false;
            iter = 0;
            for (const nodeIndex of newArrayD2) {
                if (nodeIndex.toNumber() === 4) {
                    exist4 = true;
                }
                if (nodeIndex.toNumber() === 5) {
                    exist5 = true;
                }
                iter++;
            }
            assert.equal(exist4 && exist5, false);
            assert.equal(
                (exist5 && newArrayD2[zeroPositionD2].toNumber() === 5) ||
                (exist4 && newArrayD2[zeroPositionD2].toNumber() === 4),
                true
            );
            await skaleDKG.setSuccesfulDKGPublic(
                web3.utils.soliditySha3("d2"),
            );
            skipTime(web3, 43260);
            await skaleManager.nodeExit(1, {from: nodeAddress});
            const newNewArrayD3 = await schainsInternal.getNodesInGroup(web3.utils.soliditySha3("d3"));
            let onePositionD3 = 0;
            iter = 0;
            for (const nodeIndex of arrayD3) {
                if (nodeIndex.toNumber() === 1) {
                    onePositionD3 = iter;
                }
                iter++;
            }
            exist4 = false;
            exist5 = false;
            iter = 0;
            for (const nodeIndex of newNewArrayD3) {
                if (nodeIndex.toNumber() === 4 && iter !== zeroPositionD3) {
                    exist4 = true;
                }
                if (nodeIndex.toNumber() === 5 && iter !== zeroPositionD3) {
                    exist5 = true;
                }
                iter++;
            }
            assert.equal(exist4 && exist5, false);
            assert.equal(
                (exist5 && newNewArrayD3[onePositionD3].toNumber() === 5) ||
                (exist4 && newNewArrayD3[onePositionD3].toNumber() === 4),
                true
            );
            await skaleDKG.setSuccesfulDKGPublic(
                web3.utils.soliditySha3("d3"),
            );
            await skaleManager.nodeExit(1, {from: nodeAddress});
            const newNewArrayD2 = await schainsInternal.getNodesInGroup(web3.utils.soliditySha3("d2"));
            let onePositionD2 = 0;
            iter = 0;
            for (const nodeIndex of arrayD2) {
                if (nodeIndex.toNumber() === 1) {
                    onePositionD2 = iter;
                }
                iter++;
            }
            exist4 = false;
            exist5 = false;
            iter = 0;
            for (const nodeIndex of newNewArrayD2) {
                if (nodeIndex.toNumber() === 4 && iter !== zeroPositionD2) {
                    exist4 = true;
                }
                if (nodeIndex.toNumber() === 5 && iter !== zeroPositionD2) {
                    exist5 = true;
                }
                iter++;
            }
            assert.equal(exist4 && exist5, false);
            assert.equal(
                (exist5 && newNewArrayD2[onePositionD2].toNumber() === 5) ||
                (exist4 && newNewArrayD2[onePositionD2].toNumber() === 4),
                true
            );
            await skaleDKG.setSuccesfulDKGPublic(
                web3.utils.soliditySha3("d2"),
            );
        });

        it("should allow to rotate if occupied node didn't rotated for 12 hours", async () => {
            await skaleManager.nodeExit(0, {from: nodeAddress});
            await skaleDKG.setSuccesfulDKGPublic(
                web3.utils.soliditySha3("d3"),
            );
            await skaleManager.nodeExit(1, {from: nodeAddress})
                .should.be.eventually.rejectedWith("Node cannot rotate on Schain d3, occupied by Node 0");
            skipTime(web3, 43260);
            await skaleManager.nodeExit(1, {from: nodeAddress});
            await skaleDKG.setSuccesfulDKGPublic(
                web3.utils.soliditySha3("d3"),
            );

            await skaleManager.nodeExit(0, {from: nodeAddress})
                .should.be.eventually.rejectedWith("Node cannot rotate on Schain d2, occupied by Node 1");

            nodeStatus = (await nodes.getNodeStatus(1)).toNumber();
            assert.equal(nodeStatus, LEAVING);
            await skaleManager.nodeExit(1, {from: nodeAddress});
            nodeStatus = (await nodes.getNodeStatus(1)).toNumber();
            assert.equal(nodeStatus, LEFT);
        });

        it("should not create schain with the same name after removing", async () => {
            const deposit = await schains.getSchainPrice(5, 5);
            await skaleManager.nodeExit(0, {from: nodeAddress});
            await skaleDKG.setSuccesfulDKGPublic(
                web3.utils.soliditySha3("d3"),
            );
            await skaleManager.nodeExit(0, {from: nodeAddress});
            await skaleDKG.setSuccesfulDKGPublic(
                web3.utils.soliditySha3("d2"),
            );
            await skaleManager.deleteSchainByRoot("d2", {from: holder})
                .should.be.eventually.rejectedWith("Caller is not an admin");
            await skaleManager.grantRole(await skaleManager.ADMIN_ROLE(), holder);
            await skaleManager.deleteSchainByRoot("d2", {from: holder});
            await skaleManager.deleteSchainByRoot("d3", {from: holder});
            await schainsInternal.getActiveSchains(0).should.be.eventually.empty;
            await schainsInternal.getActiveSchains(1).should.be.eventually.empty;
            await schainsInternal.getActiveSchains(2).should.be.eventually.empty;
            await schainsInternal.getActiveSchains(3).should.be.eventually.empty;
            await schainsInternal.getActiveSchains(4).should.be.eventually.empty;
            await schainsInternal.getActiveSchains(5).should.be.eventually.empty;
            let schainNameAvailable = await schainsInternal.isSchainNameAvailable("d2");
            assert.equal(schainNameAvailable, false);
            await schains.addSchain(
                holder,
                deposit,
                web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 5, 0, "d2"]),
                {from: owner}).should.be.eventually.rejectedWith("Schain name is not available");
            schainNameAvailable = await schainsInternal.isSchainNameAvailable("d3");
            assert.equal(schainNameAvailable, false);
            await schains.addSchain(
                holder,
                deposit,
                web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 5, 0, "d3"]),
                {from: owner}).should.be.eventually.rejectedWith("Schain name is not available");
            schainNameAvailable = await schainsInternal.isSchainNameAvailable("d4");
            assert.equal(schainNameAvailable, true);
            await schains.addSchain(
                holder,
                deposit,
                web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 5, 0, "d4"]),
                {from: owner});
            await skaleDKG.setSuccesfulDKGPublic(
                web3.utils.soliditySha3("d4"),
            );
            const nodesInGroupBN = await schainsInternal.getNodesInGroup(web3.utils.soliditySha3("d4"));
            const nodeInGroup = nodesInGroupBN.map((value: BigNumber) => value.toNumber())[0];
            await skaleManager.nodeExit(nodeInGroup, {from: nodeAddress});
        });

        it("should be possible to send broadcast", async () => {
            let res = await skaleDKG.isChannelOpened(web3.utils.soliditySha3("d3"));
            assert.equal(res, false);
            await skaleManager.nodeExit(0, {from: nodeAddress});
            const res1 = await schainsInternal.getNodesInGroup(web3.utils.soliditySha3("d3"));
            const nodeRot = res1[3];
            res = await skaleDKG.isChannelOpened(web3.utils.soliditySha3("d3"));
            assert.equal(res, true);
            res = await skaleDKG.isBroadcastPossible(web3.utils.soliditySha3("d3"), nodeRot, {from: nodeAddress});
            assert.equal(res, true);
        });

        it("should revert if dkg not finished", async () => {
            let res = await skaleDKG.isChannelOpened(web3.utils.soliditySha3("d3"));
            assert.equal(res, false);
            await skaleManager.nodeExit(0, {from: nodeAddress});
            const res1 = await schainsInternal.getNodesInGroup(web3.utils.soliditySha3("d3"));
            const nodeRot = res1[3];
            res = await skaleDKG.isChannelOpened(web3.utils.soliditySha3("d3"));
            assert.equal(res, true);
            res = await skaleDKG.isBroadcastPossible(web3.utils.soliditySha3("d3"), nodeRot, {from: nodeAddress});
            assert.equal(res, true);

            await skaleManager.nodeExit(1, {from: nodeAddress})
                .should.be.eventually.rejectedWith("DKG process did not finish on schain d3");
            await skaleManager.nodeExit(0, {from: nodeAddress});

            skipTime(web3, 43260);

            await skaleManager.nodeExit(1, {from: nodeAddress})
                .should.be.eventually.rejectedWith("DKG process did not finish on schain d3");
        });

        it("should be possible to send broadcast", async () => {
            let res = await skaleDKG.isChannelOpened(web3.utils.soliditySha3("d3"));
            assert.equal(res, false);
            await skaleManager.nodeExit(0, {from: nodeAddress});
            const res1 = await schainsInternal.getNodesInGroup(web3.utils.soliditySha3("d3"));
            const nodeRot = res1[3];
            res = await skaleDKG.isChannelOpened(web3.utils.soliditySha3("d3"));
            assert.equal(res, true);
            res = await skaleDKG.isBroadcastPossible(web3.utils.soliditySha3("d3"), nodeRot, {from: nodeAddress});
            assert.equal(res, true);
            skipTime(web3, 43260);
            await skaleManager.nodeExit(0, {from: nodeAddress});

            await skaleManager.nodeExit(1, {from: nodeAddress})
                .should.be.eventually.rejectedWith("DKG process did not finish on schain d3");
        });

        it("should be possible to send broadcast", async () => {
            let res = await skaleDKG.isChannelOpened(web3.utils.soliditySha3("d3"));
            assert.equal(res, false);
            await skaleManager.nodeExit(0, {from: nodeAddress});
            const res1 = await schainsInternal.getNodesInGroup(web3.utils.soliditySha3("d3"));
            const nodeRot = res1[3];
            res = await skaleDKG.isChannelOpened(web3.utils.soliditySha3("d3"));
            assert.equal(res, true);
            res = await skaleDKG.isBroadcastPossible(web3.utils.soliditySha3("d3"), nodeRot, {from: nodeAddress});
            assert.equal(res, true);
            await skaleDKG.setSuccesfulDKGPublic(
                web3.utils.soliditySha3("d3"),
            );
            await skaleManager.nodeExit(1, {from: nodeAddress})
                .should.be.eventually.rejectedWith("Node cannot rotate on Schain d3, occupied by Node 0");
            await skaleManager.nodeExit(0, {from: nodeAddress});
            await skaleDKG.setSuccesfulDKGPublic(
                web3.utils.soliditySha3("d2"),
            );

            skipTime(web3, 43260);

            await skaleManager.nodeExit(1, {from: nodeAddress});
        });

        it("should be possible to process dkg after node rotation", async () => {
            let res = await skaleDKG.isChannelOpened(web3.utils.soliditySha3("d3"));
            assert.equal(res, false);
            await skaleManager.nodeExit(0, {from: nodeAddress});
            const res1 = await schainsInternal.getNodesInGroup(web3.utils.soliditySha3("d3"));
            const nodeRot = res1[3];
            res = await skaleDKG.isBroadcastPossible(web3.utils.soliditySha3("d3"), nodeRot, {from: nodeAddress});
            assert.equal(res, true);

            const verificationVector = [
                {
                    x: {
                        a: "0x02c2b888a23187f22195eadadbc05847a00dc59c913d465dbc4dfac9cfab437d",
                        b: "0x2695832627b9081e77da7a3fc4d574363bf051700055822f3d394dc3d9ff7417",
                    },
                    y: {
                        a: "0x24727c45f9322be756fbec6514525cbbfa27ef1951d3fed10f483c23f921879d",
                        b: "0x03a7a3e6f3b539dad43c0eca46e3f889b2b2300815ffc4633e26e64406625a99"
                    }
                },
                {
                    x: {
                        a: "0x02c2b888a23187f22195eadadbc05847a00dc59c913d465dbc4dfac9cfab437d",
                        b: "0x2695832627b9081e77da7a3fc4d574363bf051700055822f3d394dc3d9ff7417",
                    },
                    y: {
                        a: "0x24727c45f9322be756fbec6514525cbbfa27ef1951d3fed10f483c23f921879d",
                        b: "0x03a7a3e6f3b539dad43c0eca46e3f889b2b2300815ffc4633e26e64406625a99"
                    }
                },
                {
                    x: {
                        a: "0x02c2b888a23187f22195eadadbc05847a00dc59c913d465dbc4dfac9cfab437d",
                        b: "0x2695832627b9081e77da7a3fc4d574363bf051700055822f3d394dc3d9ff7417",
                    },
                    y: {
                        a: "0x24727c45f9322be756fbec6514525cbbfa27ef1951d3fed10f483c23f921879d",
                        b: "0x03a7a3e6f3b539dad43c0eca46e3f889b2b2300815ffc4633e26e64406625a99"
                    }
                }
            ];

            const encryptedSecretKeyContribution = [
                {
                    share: "0x937c9c846a6fa7fd1984fe82e739ae37fcaa555c1dc0e8597c9f81b6a12f232f",
                    publicKey: [
                        "0xfdf8101e91bd658fa1cea6fdd75adb8542951ce3d251cdaa78f43493dad730b5",
                        "0x9d32d2e872b36aa70cdce544b550ebe96994de860b6f6ebb7d0b4d4e6724b4bf"
                    ]
                },
                {
                    share: "0x7232f27fdfe521f3c7997dbb1c15452b7f196bd119d915ce76af3d1a008e1810",
                    publicKey: [
                        "0x086ff076abe442563ae9b8938d483ae581f4de2ee54298b3078289bbd85250c8",
                        "0xdf956450d32f671e4a8ec1e584119753ff171e80a61465246bfd291e8dac3d77"
                    ]
                },
                {
                    share: "0x7232f27fdfe521f3c7997dbb1c15452b7f196bd119d915ce76af3d1a008e1810",
                    publicKey: [
                        "0x086ff076abe442563ae9b8938d483ae581f4de2ee54298b3078289bbd85250c8",
                        "0xdf956450d32f671e4a8ec1e584119753ff171e80a61465246bfd291e8dac3d77"
                    ]
                },
                {
                    share: "0x7232f27fdfe521f3c7997dbb1c15452b7f196bd119d915ce76af3d1a008e1810",
                    publicKey: [
                        "0x086ff076abe442563ae9b8938d483ae581f4de2ee54298b3078289bbd85250c8",
                        "0xdf956450d32f671e4a8ec1e584119753ff171e80a61465246bfd291e8dac3d77"
                    ]
                }
            ];

            // let res10 = await keyStorage.getBroadcastedData(web3.utils.soliditySha3("d3"), res1[0]);
            res = await skaleDKG.isBroadcastPossible(web3.utils.soliditySha3("d3"), res1[0], {from: nodeAddress});
            assert.equal(res, true);
            await skaleDKG.broadcast(
                web3.utils.soliditySha3("d3"),
                res1[0],
                verificationVector,
                // the last symbol is spoiled in parameter below
                encryptedSecretKeyContribution,
                {from: nodeAddress},
            );
            // res10 = await keyStorage.getBroadcastedData(web3.utils.soliditySha3("d3"), res1[1]);
            res = await skaleDKG.isBroadcastPossible(web3.utils.soliditySha3("d3"), res1[1], {from: nodeAddress});
            assert.equal(res, true);
            await skaleDKG.broadcast(
                web3.utils.soliditySha3("d3"),
                res1[1],
                verificationVector,
                // the last symbol is spoiled in parameter below
                encryptedSecretKeyContribution,
                {from: nodeAddress},
            );
            res = await skaleDKG.isBroadcastPossible(web3.utils.soliditySha3("d3"), res1[2], {from: nodeAddress});
            assert.equal(res, true);
            await skaleDKG.broadcast(
                web3.utils.soliditySha3("d3"),
                res1[2],
                verificationVector,
                // the last symbol is spoiled in parameter below
                encryptedSecretKeyContribution,
                {from: nodeAddress},
            );
            await skaleDKG.broadcast(
                web3.utils.soliditySha3("d3"),
                res1[3],
                verificationVector,
                // the last symbol is spoiled in parameter below
                encryptedSecretKeyContribution,
                {from: nodeAddress},
            );

            res = await skaleDKG.isChannelOpened(web3.utils.soliditySha3("d3"));
            assert.equal(res, true);

            res = await skaleDKG.isAlrightPossible(
                web3.utils.soliditySha3("d3"),
                res1[0],
                {from: nodeAddress},
            );
            assert.equal(res, true);

            await skaleDKG.alright(
                web3.utils.soliditySha3("d3"),
                res1[0],
                {from: nodeAddress},
            );

            res = await skaleDKG.isChannelOpened(web3.utils.soliditySha3("d3"));
            assert.equal(res, true);

            res = await skaleDKG.isAlrightPossible(
                web3.utils.soliditySha3("d3"),
                res1[1],
                {from: nodeAddress},
            );
            assert.equal(res, true);

            await skaleDKG.alright(
                web3.utils.soliditySha3("d3"),
                res1[1],
                {from: nodeAddress},
            );

            res = await skaleDKG.isChannelOpened(web3.utils.soliditySha3("d3"));
            assert.equal(res, true);

            res = await skaleDKG.isAlrightPossible(
                web3.utils.soliditySha3("d3"),
                res1[2],
                {from: nodeAddress},
            );
            assert.equal(res, true);

            await skaleDKG.alright(
                web3.utils.soliditySha3("d3"),
                res1[2],
                {from: nodeAddress},
            );

            res = await skaleDKG.isChannelOpened(web3.utils.soliditySha3("d3"));
            assert.equal(res, true);

            res = await skaleDKG.isAlrightPossible(
                web3.utils.soliditySha3("d3"),
                res1[3],
                {from: nodeAddress},
            );
            assert.equal(res, true);

            await skaleDKG.alright(
                web3.utils.soliditySha3("d3"),
                res1[3],
                {from: nodeAddress},
            );
        });
    });

    describe("when 6 nodes, 4 schains and 2 rotations(Kavun test)", async () => {
        beforeEach(async () => {
            const deposit = await schains.getSchainPrice(5, 5);
            const nodesCount = 6;
            const pubKey = ec.keyFromPrivate(String(privateKeys[3]).slice(2)).getPublic();
            for (const index of Array.from(Array(nodesCount).keys())) {
                const hexIndex = ("0" + index.toString(16)).slice(-2);
                await skaleManager.createNode(
                    8545, // port
                    0, // nonce
                    "0x7f0000" + hexIndex, // ip
                    "0x7f0000" + hexIndex, // public ip
                    ["0x" + pubKey.x.toString('hex'), "0x" + pubKey.y.toString('hex')], // public key
                    "D2-" + hexIndex, // name
                    {from: nodeAddress});
            }
            await schains.addSchain(
                holder,
                deposit,
                web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 5, 0, "d1"]),
                {from: owner});
            await skaleDKG.setSuccesfulDKGPublic(
                web3.utils.soliditySha3("d1"),
            );

            await schains.addSchain(
                holder,
                deposit,
                web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 5, 0, "d2"]),
                {from: owner});
            await skaleDKG.setSuccesfulDKGPublic(
                web3.utils.soliditySha3("d2"),
            );

            await schains.addSchain(
                holder,
                deposit,
                web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 5, 0, "d3"]),
                {from: owner});
            await skaleDKG.setSuccesfulDKGPublic(
                web3.utils.soliditySha3("d3"),
            );

            await schains.addSchain(
                holder,
                deposit,
                web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 5, 0, "d4"]),
                {from: owner});
            await skaleDKG.setSuccesfulDKGPublic(
                web3.utils.soliditySha3("d4"),
            );

        });

        it("should rotate 1 node with 3 schains", async () => {
            let rotIndex = 7;
            let schainIds = await schainsInternal.getSchainIdsForNode(0);
            for(const index of Array.from(Array(6).keys())) {
                const res = await schainsInternal.getSchainIdsForNode(index);
                if (res.length >= 3) {
                    rotIndex = index;
                    schainIds = res;
                    break;
                }
            }
            for (const schainId of schainIds.reverse()) {
                await skaleManager.nodeExit(rotIndex, {from: nodeAddress});
                await skaleDKG.setSuccesfulDKGPublic(
                    schainId,
                );
            }
            await schainsInternal.getSchainIdsForNode(rotIndex).should.be.eventually.empty;
        });

        it("should rotate another 1 node with 4 schains", async () => {
            let rotIndex1 = 7;
            let schainIds1 = await schainsInternal.getSchainIdsForNode(0);
            for(const index of Array.from(Array(6).keys())) {
                const res = await schainsInternal.getSchainIdsForNode(index);
                if (res.length >= 3) {
                    rotIndex1 = index;
                    schainIds1 = res;
                    break;
                }
            }
            for (const schainId of schainIds1.reverse()) {
                await skaleManager.nodeExit(rotIndex1, {from: nodeAddress});
                await skaleDKG.setSuccesfulDKGPublic(
                    schainId,
                );
            }
            await schainsInternal.getSchainIdsForNode(rotIndex1).should.be.eventually.empty;
            let rotIndex2 = 7;
            let schainIds2 = await schainsInternal.getSchainIdsForNode(0);
            for(const index of Array.from(Array(6).keys())) {
                if (await nodes.isNodeActive(index)) {
                    const res = await schainsInternal.getSchainIdsForNode(index);
                    if (res.length === 4) {
                        rotIndex2 = index;
                        schainIds2 = res;
                        break;
                    }
                }
            }

            skipTime(web3, 43260);
            for (const schainId of schainIds2.reverse()) {
                await skaleManager.nodeExit(rotIndex2, {from: nodeAddress});
                await skaleDKG.setSuccesfulDKGPublic(
                    schainId,
                );
            }
            await schainsInternal.getSchainIdsForNode(rotIndex2).should.be.eventually.empty;
            await schainsInternal.getSchainIdsForNode(rotIndex1).should.be.eventually.empty;
        });
    });

    describe("when 8 nodes, 4 schains and 2 rotations(Kavun test)", async () => {
        beforeEach(async () => {
            const deposit = await schains.getSchainPrice(5, 5);
            const nodesCount = 6;
            const pubKey = ec.keyFromPrivate(String(privateKeys[3]).slice(2)).getPublic();
            for (const index of Array.from(Array(nodesCount).keys())) {
                const hexIndex = ("0" + index.toString(16)).slice(-2);
                await skaleManager.createNode(
                    8545, // port
                    0, // nonce
                    "0x7f0000" + hexIndex, // ip
                    "0x7f0000" + hexIndex, // public ip
                    ["0x" + pubKey.x.toString('hex'), "0x" + pubKey.y.toString('hex')], // public key
                    "D2-" + hexIndex, // name
                    {from: nodeAddress});
            }
            const pubKey2 = ec.keyFromPrivate(String(privateKeys[4]).slice(2)).getPublic();
            await skaleManager.createNode(
                8545, // port
                0, // nonce
                "0x7f0000ff", // ip
                "0x7f0000ff", // public ip
                ["0x" + pubKey2.x.toString('hex'), "0x" + pubKey2.y.toString('hex')], // public key
                "D2-ff", // name
                {from: nodeAddress2});
            const pubKey3 = ec.keyFromPrivate(String(privateKeys[5]).slice(2)).getPublic();
            await skaleManager.createNode(
                8545, // port
                0, // nonce
                "0x7f0000fe", // ip
                "0x7f0000fe", // public ip
                ["0x" + pubKey3.x.toString('hex'), "0x" + pubKey3.y.toString('hex')], // public key
                "D2-fe", // name
                {from: nodeAddress3});
            await schains.addSchain(
                holder,
                deposit,
                web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 5, 0, "d1"]),
                {from: owner});
            await skaleDKG.setSuccesfulDKGPublic(
                web3.utils.soliditySha3("d1"),
            );

            await schains.addSchain(
                holder,
                deposit,
                web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 5, 0, "d2"]),
                {from: owner});
            await skaleDKG.setSuccesfulDKGPublic(
                web3.utils.soliditySha3("d2"),
            );

            await schains.addSchain(
                holder,
                deposit,
                web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 5, 0, "d3"]),
                {from: owner});
            await skaleDKG.setSuccesfulDKGPublic(
                web3.utils.soliditySha3("d3"),
            );

            await schains.addSchain(
                holder,
                deposit,
                web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 5, 0, "d4"]),
                {from: owner});
            await skaleDKG.setSuccesfulDKGPublic(
                web3.utils.soliditySha3("d4"),
            );

        });

        it("should rotate 1 node with 3 schains", async () => {
            let rotIndex = 8;
            let schainIds = await schainsInternal.getSchainIdsForNode(0);
            for(const index of Array.from(Array(6).keys())) {
                const res = await schainsInternal.getSchainIdsForNode(index);
                if (res.length >= 3) {
                    rotIndex = index;
                    schainIds = res;
                    break;
                }
            }
            for (const schainId of schainIds.reverse()) {
                if (rotIndex === 7) {
                    await skaleManager.nodeExit(rotIndex, {from: nodeAddress3});
                } else if (rotIndex === 6) {
                    await skaleManager.nodeExit(rotIndex, {from: nodeAddress2});
                } else if (rotIndex < 6) {
                    await skaleManager.nodeExit(rotIndex, {from: nodeAddress});
                } else {
                    break;
                }
                await skaleDKG.setSuccesfulDKGPublic(
                    schainId,
                );
            }
            await schainsInternal.getSchainIdsForNode(rotIndex).should.be.eventually.empty;
        });

        it("should rotate another 1 node with 4 schains", async () => {
            let rotIndex1 = 8;
            let schainIds1 = await schainsInternal.getSchainIdsForNode(0);
            for(const index of Array.from(Array(6).keys())) {
                const res = await schainsInternal.getSchainIdsForNode(index);
                if (res.length >= 3) {
                    rotIndex1 = index;
                    schainIds1 = res;
                    break;
                }
            }
            for (const schainId of schainIds1.reverse()) {
                if (rotIndex1 === 7) {
                    await skaleManager.nodeExit(rotIndex1, {from: nodeAddress3});
                } else if (rotIndex1 === 6) {
                    await skaleManager.nodeExit(rotIndex1, {from: nodeAddress2});
                } else if (rotIndex1 < 6) {
                    await skaleManager.nodeExit(rotIndex1, {from: nodeAddress});
                } else {
                    break;
                }
                await skaleDKG.setSuccesfulDKGPublic(
                    schainId,
                );
            }
            await schainsInternal.getSchainIdsForNode(rotIndex1).should.be.eventually.empty;
            let rotIndex2 = 8;
            let schainIds2 = await schainsInternal.getSchainIdsForNode(0);
            for(const index of Array.from(Array(6).keys())) {
                if (await nodes.isNodeActive(index)) {
                    const res = await schainsInternal.getSchainIdsForNode(index);
                    if (res.length === 4) {
                        rotIndex2 = index;
                        schainIds2 = res;
                        break;
                    }
                }
            }

            skipTime(web3, 43260);
            for (const schainId of schainIds2.reverse()) {
                if (rotIndex2 === 7) {
                    await skaleManager.nodeExit(rotIndex2, {from: nodeAddress3});
                } else if (rotIndex2 === 6) {
                    await skaleManager.nodeExit(rotIndex2, {from: nodeAddress2});
                } else if (rotIndex2 < 6) {
                    await skaleManager.nodeExit(rotIndex2, {from: nodeAddress});
                } else {
                    break;
                }
                await skaleDKG.setSuccesfulDKGPublic(
                    schainId,
                );
            }
            await schainsInternal.getSchainIdsForNode(rotIndex2).should.be.eventually.empty;
            await schainsInternal.getSchainIdsForNode(rotIndex1).should.be.eventually.empty;
        });

        it("should rotate 7 node and unlink from Validator", async () => {
            const rotIndex = 6;
            const schainIds = await schainsInternal.getSchainIdsForNode(rotIndex);
            for (const schainId of schainIds.reverse()) {
                const valId = await validatorService.getValidatorIdByNodeAddress(nodeAddress2);
                ((await validatorService.getValidatorIdByNodeAddress(nodeAddress2)).toString()).should.be.equal("1");
                await skaleManager.nodeExit(rotIndex, {from: nodeAddress2});
                await skaleDKG.setSuccesfulDKGPublic(
                    schainId,
                );
            }
            if (!(await nodes.isNodeLeft(rotIndex))) {
                await skaleManager.nodeExit(rotIndex, {from: nodeAddress2});
            }
            await validatorService.getValidatorIdByNodeAddress(nodeAddress2)
            .should.be.eventually.rejectedWith("Node address is not assigned to a validator");
            await schainsInternal.getSchainIdsForNode(rotIndex).should.be.eventually.empty;
        });

        it("should rotate 7 node from validator address", async () => {
            const rotatedNodeIndex = 6;
            const schainIds = await schainsInternal.getSchainIdsForNode(rotatedNodeIndex);
            for (const schainId of schainIds.reverse()) {
                const validatorId = await validatorService.getValidatorIdByNodeAddress(nodeAddress2);
                validatorId.toString().should.be.equal("1");
                await skaleManager.nodeExit(rotatedNodeIndex, {from: validator});
                await skaleDKG.setSuccesfulDKGPublic(schainId);
            }
            if (!(await nodes.isNodeLeft(rotatedNodeIndex))) {
                await skaleManager.nodeExit(rotatedNodeIndex, {from: validator});
            }
            await validatorService.getValidatorIdByNodeAddress(nodeAddress2)
                .should.be.eventually.rejectedWith("Node address is not assigned to a validator");
            await schainsInternal.getSchainIdsForNode(rotatedNodeIndex).should.be.eventually.empty;
        });

        it("should rotate 7 node from contract owner address", async () => {
            const rotatedNodeIndex = 6;
            const schainIds = await schainsInternal.getSchainIdsForNode(rotatedNodeIndex);
            for (const schainId of schainIds.reverse()) {
                const validatorId = await validatorService.getValidatorIdByNodeAddress(nodeAddress2);
                validatorId.toString().should.be.equal("1");
                await skaleManager.nodeExit(rotatedNodeIndex, {from: owner});
                await skaleDKG.setSuccesfulDKGPublic(schainId);
            }
            if (!(await nodes.isNodeLeft(rotatedNodeIndex))) {
                await skaleManager.nodeExit(rotatedNodeIndex, {from: owner});
            }
            await validatorService.getValidatorIdByNodeAddress(nodeAddress2)
                .should.be.eventually.rejectedWith("Node address is not assigned to a validator");
            await schainsInternal.getSchainIdsForNode(rotatedNodeIndex).should.be.eventually.empty;
        });

        it("should rotate 8 node and unlink from Validator", async () => {
            const rotIndex = 7;
            const schainIds = await schainsInternal.getSchainIdsForNode(rotIndex);
            for (const schainId of schainIds.reverse()) {
                const valId = await validatorService.getValidatorIdByNodeAddress(nodeAddress3);
                ((await validatorService.getValidatorIdByNodeAddress(nodeAddress3)).toString()).should.be.equal("1");
                await skaleManager.nodeExit(rotIndex, {from: nodeAddress3});
                await skaleDKG.setSuccesfulDKGPublic(
                    schainId,
                );
            }
            if (!(await nodes.isNodeLeft(rotIndex))) {
                await skaleManager.nodeExit(rotIndex, {from: nodeAddress3});
            }
            await validatorService.getValidatorIdByNodeAddress(nodeAddress3)
            .should.be.eventually.rejectedWith("Node address is not assigned to a validator");
            await schainsInternal.getSchainIdsForNode(rotIndex).should.be.eventually.empty;
        });
    });

    // describe("when 16 nodes, 32 schains(Kavun test)", async () => {
    //     beforeEach(async () => {
    //         const deposit = await schains.getSchainPrice(2, 5);
    //         const nodesCount = 16;
    //         const pubKey = ec.keyFromPrivate(String(privateKeys[3]).slice(2)).getPublic();
    //         for (const index of Array.from(Array(nodesCount).keys())) {
    //             const hexIndex = ("0" + index.toString(16)).slice(-2);
    //             await skaleManager.createNode(
    //                 8545, // port
    //                 0, // nonce
    //                 "0x7f0000" + hexIndex, // ip
    //                 "0x7f0000" + hexIndex, // public ip
    //                 ["0x" + pubKey.x.toString('hex'), "0x" + pubKey.y.toString('hex')], // public key
    //                 "D2-" + hexIndex, // name
    //                 {from: nodeAddress});
    //         }

    //     });

    //     it("should will remove all schains frontward and create Medium Schain", async () => {
    //         const schainsCount = 32;
    //         const deposit = await schains.getSchainPrice(2, 5);
    //         for (const index of Array.from(Array(schainsCount).keys())) {
    //             const hexIndex = ("0" + index.toString(16)).slice(-2);
    //             await schains.addSchain(
    //                 holder,
    //                 deposit,
    //                 web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 2, 0, "d" + hexIndex]),
    //                 {from: owner}
    //             );
    //             await skaleDKG.setSuccesfulDKGPublic(
    //                 web3.utils.soliditySha3("d" + hexIndex),
    //             );
    //         }
    //         for (const index of Array.from(Array(schainsCount).keys())) {
    //             const hexIndex = ("0" + index.toString(16)).slice(-2);
    //             await skaleManager.deleteSchain(
    //                 "d" + hexIndex,
    //                 {from: holder}
    //             );
    //         }
    //         const res = await schains.addSchain(
    //             holder,
    //             deposit,
    //             web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 2, 0, "a1"]),
    //             {from: owner});
    //         res.receipt.gasUsed.should.be.lessThan(5000000);
    //         await skaleDKG.setSuccesfulDKGPublic(
    //             web3.utils.soliditySha3("a1"),
    //         );
    //     });

    //     it("should will remove all schains backward and create Medium Schain", async () => {
    //         const schainsCount = 32;
    //         const deposit = await schains.getSchainPrice(2, 5);
    //         for (const index of Array.from(Array(schainsCount).keys())) {
    //             const hexIndex = ("0" + index.toString(16)).slice(-2);
    //             await schains.addSchain(
    //                 holder,
    //                 deposit,
    //                 web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 2, 0, "d" + hexIndex]),
    //                 {from: owner}
    //             );
    //             await skaleDKG.setSuccesfulDKGPublic(
    //                 web3.utils.soliditySha3("d" + hexIndex),
    //             );
    //         }
    //         for (const index of Array.from(Array(schainsCount).keys()).reverse()) {
    //             const hexIndex = ("0" + index.toString(16)).slice(-2);
    //             await skaleManager.deleteSchain(
    //                 "d" + hexIndex,
    //                 {from: holder}
    //             );
    //         }
    //         const res = await schains.addSchain(
    //             holder,
    //             deposit,
    //             web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 2, 0, "a1"]),
    //             {from: owner});
    //         res.receipt.gasUsed.should.be.lessThan(5000000);
    //         await skaleDKG.setSuccesfulDKGPublic(
    //             web3.utils.soliditySha3("a1"),
    //         );
    //     });

    //     it("should will remove all schains frontward and create Small Schain", async () => {
    //         const schainsCount = 128;
    //         const deposit = await schains.getSchainPrice(1, 5);
    //         for (const index of Array.from(Array(schainsCount).keys())) {
    //             const hexIndex = ("0" + index.toString(16)).slice(-2);
    //             const res = await schains.addSchain(
    //                 holder,
    //                 deposit,
    //                 web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 1, 0, "d" + hexIndex]),
    //                 {from: owner});
    //             console.log("Schain d" + hexIndex, "was created with gas", res.receipt.gasUsed);
    //             await skaleDKG.setSuccesfulDKGPublic(
    //                 web3.utils.soliditySha3("d" + hexIndex),
    //             );
    //         }
    //         for (const index of Array.from(Array(schainsCount).keys())) {
    //             const hexIndex = ("0" + index.toString(16)).slice(-2);
    //             const res = await skaleManager.deleteSchain(
    //                 "d" + hexIndex,
    //                 {from: holder});
    //             console.log("Schain d" + hexIndex, "was deleted with gas", res.receipt.gasUsed);
    //         }
    //         // console.log("----------------------------------------------------------")
    //         // console.log(await schainsInternal.getSchainIdsForNode(0));
    //         // console.log(await schainsInternal.holesForNodes(0));
    //         // console.log(await schainsInternal.holesForSchains(web3.utils.soliditySha3("d01")));
    //         const res = await schains.addSchain(
    //             holder,
    //             deposit,
    //             web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 1, 0, "a1"]),
    //             {from: owner});
    //         console.log("Frontward");
    //         console.log("Schain a1 with gas", res.receipt.gasUsed);
    //         await skaleDKG.setSuccesfulDKGPublic(
    //             web3.utils.soliditySha3("a1"),
    //         );
    //         // console.log("----------------------------------------------------------")
    //         // console.log(await schainsInternal.getSchainIdsForNode(0));
    //         // console.log(await schainsInternal.holesForNodes(0));
    //         // console.log(await schainsInternal.holesForSchains(web3.utils.soliditySha3("d01")));
    //     });

    //     it("should will remove all schains backward and create Small Schain", async () => {
    //         const schainsCount = 128;
    //         const deposit = await schains.getSchainPrice(1, 5);
    //         for (const index of Array.from(Array(schainsCount).keys())) {
    //             const hexIndex = ("0" + index.toString(16)).slice(-2);
    //             const res = await schains.addSchain(
    //                 holder,
    //                 deposit,
    //                 web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 1, 0, "d" + hexIndex]),
    //                 {from: owner});
    //             console.log("Schain d" + hexIndex, "was created with gas", res.receipt.gasUsed);
    //             await skaleDKG.setSuccesfulDKGPublic(
    //                 web3.utils.soliditySha3("d" + hexIndex),
    //             );
    //         }
    //         for (const index of Array.from(Array(schainsCount).keys()).reverse()) {
    //             const hexIndex = ("0" + index.toString(16)).slice(-2);
    //             const res = await skaleManager.deleteSchain(
    //                 "d" + hexIndex,
    //                 {from: holder});
    //             console.log("Schain d" + hexIndex, "was deleted with gas", res.receipt.gasUsed);
    //         }
    //         // console.log("----------------------------------------------------------")
    //         // console.log(await schainsInternal.getSchainIdsForNode(0));
    //         // console.log(await schainsInternal.holesForNodes(0));
    //         // console.log(await schainsInternal.holesForSchains(web3.utils.soliditySha3("d01")));
    //         const res = await schains.addSchain(
    //             holder,
    //             deposit,
    //             web3.eth.abi.encodeParameters(["uint", "uint8", "uint16", "string"], [5, 1, 0, "a1"]),
    //             {from: owner});
    //         await skaleDKG.setSuccesfulDKGPublic(
    //             web3.utils.soliditySha3("a1"),
    //         );
    //     });
    // });

});
