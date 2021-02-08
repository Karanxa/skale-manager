import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { ContractManager,
         NodesInstance,
         SkaleToken,
         ValidatorService,
         DelegationController,
         ConstantsHolder} from "../types/truffle-contracts";

import * as elliptic from "elliptic";
const EC = elliptic.ec;
const ec = new EC("secp256k1");
import { privateKeys } from "./tools/private-keys";

import { skipTime } from "./tools/time";

import BigNumber from "bignumber.js";
import { deployContractManager } from "./tools/deploy/contractManager";
import { deployConstantsHolder } from "./tools/deploy/constantsHolder";
import { deployValidatorService } from "./tools/deploy/delegation/validatorService";
import { deployNodes } from "./tools/deploy/nodes";
import { deploySkaleToken } from "./tools/deploy/skaleToken";
import { deployDelegationController } from "./tools/deploy/delegation/delegationController";
import { deploySkaleManagerMock } from "./tools/deploy/test/skaleManagerMock";


chai.should();
chai.use(chaiAsPromised);

contract("NodesFunctionality", ([owner, validator, nodeAddress, nodeAddress2, holder, ]) => {
    let contractManager: ContractManager;
    let nodes: NodesInstance;
    let validatorService: ValidatorService;
    let constantsHolder: ConstantsHolder;
    let skaleToken: SkaleToken;
    let delegationController: DelegationController;

    beforeEach(async () => {
        contractManager = await deployContractManager();
        nodes = await deployNodes(contractManager);
        validatorService = await deployValidatorService(contractManager);
        constantsHolder = await deployConstantsHolder(contractManager);
        skaleToken = await deploySkaleToken(contractManager);
        delegationController = await deployDelegationController(contractManager);

        const skaleManagerMock = await deploySkaleManagerMock(contractManager);
        await contractManager.setContractsAddress("SkaleManager", skaleManagerMock.address);

        await validatorService.registerValidator("Validator", "D2", 0, 0, {from: validator});
        const validatorIndex = await validatorService.getValidatorId(validator);
        let signature1 = await web3.eth.sign(web3.utils.soliditySha3(validatorIndex.toString()), nodeAddress);
        signature1 = (signature1.slice(130) === "00" ? signature1.slice(0, 130) + "1b" :
                (signature1.slice(130) === "01" ? signature1.slice(0, 130) + "1c" : signature1));
        let signature2 = await web3.eth.sign(web3.utils.soliditySha3(validatorIndex.toString()), nodeAddress2);
        signature2 = (signature2.slice(130) === "00" ? signature2.slice(0, 130) + "1b" :
                (signature2.slice(130) === "01" ? signature2.slice(0, 130) + "1c" : signature2));
        await validatorService.linkNodeAddress(nodeAddress, signature1, {from: validator});
        await validatorService.linkNodeAddress(nodeAddress2, signature2, {from: validator});
    });

    it("should fail to create node if ip is zero", async () => {
        const pubKey = ec.keyFromPrivate(String(privateKeys[1]).slice(2)).getPublic();
        await nodes.createNode(
            validator,
            {
                port: 8545,
                nonce: 0,
                ip: "0x00000000",
                publicIp: "0x7f000001",
                publicKey: ["0x" + pubKey.x.toString('hex'), "0x" + pubKey.y.toString('hex')],
                name: "D2",
                domainName: "somedomain.name"
            }).should.be.eventually.rejectedWith("IP address is zero or is not available");
    });

    it("should fail to create node if port is zero", async () => {
        const pubKey = ec.keyFromPrivate(String(privateKeys[1]).slice(2)).getPublic();
        await nodes.createNode(
            validator,
            {
                port: 0,
                nonce: 0,
                ip: "0x7f000001",
                publicIp: "0x7f000001",
                publicKey: ["0x" + pubKey.x.toString('hex'), "0x" + pubKey.y.toString('hex')],
                name: "D2",
                domainName: "somedomain.name"
            }).should.be.eventually.rejectedWith("Port is zero");
    });

    it("should fail to create node if public Key is incorrect", async () => {
        const pubKey = ec.keyFromPrivate(String(privateKeys[1]).slice(2)).getPublic();
        await nodes.createNode(
            validator,
            {
                port: 8545,
                nonce: 0,
                ip: "0x7f000001",
                publicIp: "0x7f000001",
                publicKey: ["0x" + pubKey.x.toString('hex'), "0x" + pubKey.y.toString('hex').slice(1) + "0"],
                name: "D2",
                domainName: "somedomain.name"
            }).should.be.eventually.rejectedWith("Public Key is incorrect");
    });

    it("should create node", async () => {
        const pubKey = ec.keyFromPrivate(String(privateKeys[2]).slice(2)).getPublic();
        await nodes.createNode(
            nodeAddress,
            {
                port: 8545,
                nonce: 0,
                ip: "0x7f000001",
                publicIp: "0x7f000001",
                publicKey: ["0x" + pubKey.x.toString('hex'), "0x" + pubKey.y.toString('hex')],
                name: "D2",
                domainName: "somedomain.name"
            });

        const node = await nodes.nodes(0);
        node[0].should.be.equal("D2");
        node[1].should.be.equal("0x7f000001");
        node[2].should.be.equal("0x7f000001");
        node[3].should.be.deep.equal(web3.utils.toBN(8545));
        (await nodes.getNodePublicKey(0))
            .should.be.deep.equal(["0x" + pubKey.x.toString('hex'), "0x" + pubKey.y.toString('hex')]);
    });

    describe("when node is created", async () => {
        beforeEach(async () => {
            const pubKey = ec.keyFromPrivate(String(privateKeys[2]).slice(2)).getPublic();
            await nodes.createNode(
                nodeAddress,
                {
                    port: 8545,
                    nonce: 0,
                    ip: "0x7f000001",
                    publicIp: "0x7f000001",
                    publicKey: ["0x" + pubKey.x.toString('hex'), "0x" + pubKey.y.toString('hex')],
                    name: "D2",
                    domainName: "somedomain.name"
                });
        });

        it("should fail to delete non active node", async () => {
            await nodes.completeExit(0)
                .should.be.eventually.rejectedWith("Node is not Leaving");
        });

        it("should delete node", async () => {
            await nodes.initExit(0);
            await nodes.completeExit(0);

            await nodes.numberOfActiveNodes().should.be.eventually.deep.equal(web3.utils.toBN(0));
        });

        it("should initiate exiting", async () => {
            await nodes.initExit(0);

            await nodes.numberOfActiveNodes().should.be.eventually.deep.equal(web3.utils.toBN(0));
        });

        it("should complete exiting", async () => {

            await nodes.completeExit(0)
                .should.be.eventually.rejectedWith("Node is not Leaving");

            await nodes.initExit(0);

            await nodes.completeExit(0);
        });
    });

    describe("when two nodes are created", async () => {
        beforeEach(async () => {
            const pubKey = ec.keyFromPrivate(String(privateKeys[2]).slice(2)).getPublic();
            await nodes.createNode(
                nodeAddress,
                {
                    port: 8545,
                    nonce: 0,
                    ip: "0x7f000001",
                    publicIp: "0x7f000001",
                    publicKey: ["0x" + pubKey.x.toString('hex'), "0x" + pubKey.y.toString('hex')],
                    name: "D2",
                    domainName: "somedomain.name"
                }); // name
                const pubKey2 = ec.keyFromPrivate(String(privateKeys[3]).slice(2)).getPublic();
            await nodes.createNode(
                nodeAddress2,
                {
                    port: 8545,
                    nonce: 0,
                    ip: "0x7f000002",
                    publicIp: "0x7f000002",
                    publicKey: ["0x" + pubKey2.x.toString('hex'), "0x" + pubKey2.y.toString('hex')],
                    name: "D3",
                    domainName: "somedomain.name"
                }); // name
        });

        it("should delete first node", async () => {
            await nodes.initExit(0);
            await nodes.completeExit(0);

            await nodes.numberOfActiveNodes().should.be.eventually.deep.equal(web3.utils.toBN(1));
        });

        it("should delete second node", async () => {
            await nodes.initExit(1);
            await nodes.completeExit(1);

            await nodes.numberOfActiveNodes().should.be.eventually.deep.equal(web3.utils.toBN(1));
        });

        it("should initiate exit from first node", async () => {
            await nodes.initExit(0);

            await nodes.numberOfActiveNodes().should.be.eventually.deep.equal(web3.utils.toBN(1));
        });

        it("should initiate exit from second node", async () => {
            await nodes.initExit(1);

            await nodes.numberOfActiveNodes().should.be.eventually.deep.equal(web3.utils.toBN(1));
        });

        it("should complete exiting from first node", async () => {
            await nodes.completeExit(0)
                .should.be.eventually.rejectedWith("Node is not Leaving");

            await nodes.initExit(0);

            await nodes.completeExit(0);
        });

        it("should complete exiting from second node", async () => {
            await nodes.completeExit(1)
                .should.be.eventually.rejectedWith("Node is not Leaving");

            await nodes.initExit(1);

            await nodes.completeExit(1);
        });
    });

    describe("when holder has enough tokens", async () => {
        const validatorId = 1;
        let amount: number;
        let delegationPeriod: number;
        let info: string;
        const month = 60 * 60 * 24 * 31;
        beforeEach(async () => {
            amount = 100;
            delegationPeriod = 2;
            info = "NICE";
            await skaleToken.mint(holder, 200, "0x", "0x");
            await skaleToken.mint(nodeAddress, 200, "0x", "0x");
            await constantsHolder.setMSR(amount * 5);
        });

        it("should not allow to create node if new epoch isn't started", async () => {
            await validatorService.enableValidator(validatorId, {from: owner});
            await delegationController.delegate(validatorId, amount, delegationPeriod, info, {from: holder});
            const delegationId = 0;
            await delegationController.acceptPendingDelegation(delegationId, {from: validator});

            await nodes.checkPossibilityCreatingNode(nodeAddress)
                .should.be.eventually.rejectedWith("Validator must meet the Minimum Staking Requirement");
        });

        it("should allow to create node if new epoch is started", async () => {
            await validatorService.enableValidator(validatorId, {from: owner});
            await delegationController.delegate(validatorId, amount, delegationPeriod, info, {from: holder});
            const delegationId = 0;
            await delegationController.acceptPendingDelegation(delegationId, {from: validator});
            skipTime(web3, month);

            await nodes.checkPossibilityCreatingNode(nodeAddress)
                .should.be.eventually.rejectedWith("Validator must meet the Minimum Staking Requirement");

            await constantsHolder.setMSR(amount);

            // now it should not reject
            await nodes.checkPossibilityCreatingNode(nodeAddress);

            const pubKey = ec.keyFromPrivate(String(privateKeys[2]).slice(2)).getPublic();
            await nodes.createNode(
                nodeAddress,
                {
                    port: 8545,
                    nonce: 0,
                    ip: "0x7f000001",
                    publicIp: "0x7f000001",
                    publicKey: ["0x" + pubKey.x.toString('hex'), "0x" + pubKey.y.toString('hex')],
                    name: "D2",
                    domainName: "somedomain.name"
                });
            const nodeIndexBN = (await nodes.getValidatorNodeIndexes(validatorId))[0];
            const nodeIndex = new BigNumber(nodeIndexBN).toNumber();
            assert.equal(nodeIndex, 0);
        });

        it("should allow to create 2 nodes", async () => {
            const validator3 = nodeAddress;
            await validatorService.enableValidator(validatorId, {from: owner});
            await delegationController.delegate(validatorId, amount, delegationPeriod, info, {from: holder});
            const delegationId1 = 0;
            await delegationController.acceptPendingDelegation(delegationId1, {from: validator});
            await delegationController.delegate(validatorId, amount, delegationPeriod, info, {from: validator3});
            const delegationId2 = 1;
            await delegationController.acceptPendingDelegation(delegationId2, {from: validator});

            skipTime(web3, 2678400); // 31 days
            await nodes.checkPossibilityCreatingNode(nodeAddress)
                .should.be.eventually.rejectedWith("Validator must meet the Minimum Staking Requirement");

            await constantsHolder.setMSR(amount);

            await nodes.checkPossibilityCreatingNode(nodeAddress);
            const pubKey = ec.keyFromPrivate(String(privateKeys[2]).slice(2)).getPublic();
            await nodes.createNode(
                nodeAddress,
                {
                    port: 8545,
                    nonce: 0,
                    ip: "0x7f000001",
                    publicIp: "0x7f000001",
                    publicKey: ["0x" + pubKey.x.toString('hex'), "0x" + pubKey.y.toString('hex')],
                    name: "D2",
                    domainName: "somedomain.name"
                });

            await nodes.checkPossibilityCreatingNode(nodeAddress);
            await nodes.createNode(
                nodeAddress,
                {
                    port: 8545,
                    nonce: 0,
                    ip: "0x7f000002",
                    publicIp: "0x7f000002",
                    publicKey: ["0x" + pubKey.x.toString('hex'), "0x" + pubKey.y.toString('hex')],
                    name: "D3",
                    domainName: "somedomain.name"
                });

            const nodeIndexesBN = (await nodes.getValidatorNodeIndexes(validatorId));
            for (let i = 0; i < nodeIndexesBN.length; i++) {
                const nodeIndexBN = (await nodes.getValidatorNodeIndexes(validatorId))[i];
                const nodeIndex = new BigNumber(nodeIndexBN).toNumber();
                assert.equal(nodeIndex, i);
            }
        });
    });
});
