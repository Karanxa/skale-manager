import BigNumber from "bignumber.js";
import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import { ContractManagerInstance, MonitorsDataInstance, NodesInstance } from "../types/truffle-contracts";
import { deployContractManager } from "./tools/deploy/contractManager";
import { deployMonitorsData } from "./tools/deploy/monitorsData";
import { deployNodes } from "./tools/deploy/nodes";

chai.should();
chai.use(chaiAsPromised);

contract("MonitorsData", ([owner, user]) => {
    let monitorsData: MonitorsDataInstance;
    let contractManager: ContractManagerInstance;
    let nodes: NodesInstance;

    beforeEach(async () => {
        contractManager = await deployContractManager();
        monitorsData = await deployMonitorsData(contractManager);
        nodes = await deployNodes(contractManager);

        await nodes.addNode(
            owner,
            "D2",
            "0x00000003",
            "0x00000003",
            5,
            ["0x1122334455667788990011223344556677889900112233445566778899001122",
            "0x1122334455667788990011223344556677889900112233445566778899001122"],
            5);
    });

    it("should add validated node to validated array by valid monitor", async () => {
        const monitorIndex = web3.utils.soliditySha3("1");
        const node = {
            nodeIndex: 0,
            time: 2
        };
        await monitorsData.addCheckedNode(monitorIndex, node, {from: user})
        .should.be.rejectedWith("Message sender is invalid");
        await monitorsData.addCheckedNode(monitorIndex, node, {from: owner});
        const validatedArray = await monitorsData.getCheckedArray(monitorIndex);
        validatedArray.length.should.be.equal(1);
        validatedArray.forEach((checkedNode) => {
            checkedNode.nodeIndex.should.be.equal(node.nodeIndex.toString(10));
            checkedNode.time.should.be.equal(node.time.toString(10));
            checkedNode.ip.should.be.equal("0x00000003");
        });
    });

    it("should add correct verdict only by correct monitor", async () => {
        const monitorIndex = web3.utils.soliditySha3("1");
        const downtime = new BigNumber(200);
        const latency = new BigNumber(300);
        await monitorsData.addVerdict(monitorIndex, downtime, latency, {from: user})
        .should.be.rejectedWith("Message sender is invalid");
        await monitorsData.addVerdict(monitorIndex, downtime, latency, {from: owner});
        const dataLength = await monitorsData.getLengthOfMetrics(monitorIndex);
        dataLength.should.be.deep.equal(web3.utils.toBN(1));
        const savedDowntime = new BigNumber(await monitorsData.verdicts(monitorIndex, "0", "0"));
        const savedLatency = new BigNumber(await monitorsData.verdicts(monitorIndex, "0", "1"));
        savedDowntime.should.be.deep.equal(downtime);
        savedLatency.should.be.be.deep.equal(latency);
    });

    it("should remove validated node by valid monitor", async () => {
        const monitorIndex = web3.utils.soliditySha3("1");
        const nodeIndex = 0;
        const data = {
            nodeIndex: 0,
            time: 2
        };
        await monitorsData.addCheckedNode(monitorIndex, data, {from: owner});
        const validatedArray = await monitorsData.getCheckedArray(monitorIndex);
        validatedArray.length.should.be.equal(1);
        await monitorsData.removeCheckedNode(monitorIndex, nodeIndex, {from: user})
        .should.be.rejectedWith("Message sender is invalid");
        await monitorsData.removeCheckedNode(monitorIndex, nodeIndex, {from: owner});
        const validatedArrayAfter = await monitorsData.getCheckedArray(monitorIndex);
        validatedArrayAfter.length.should.be.equal(0);
    });

    it("should remove all verdicts by valid monitor", async () => {
        const monitorIndex = web3.utils.soliditySha3("1");
        const downtime1 = new BigNumber(200);
        const latency1 = new BigNumber(300);
        await monitorsData.addVerdict(monitorIndex, downtime1, latency1, {from: owner});
        const downtime2 = new BigNumber(500);
        const latency2 = new BigNumber(200);
        await monitorsData.addVerdict(monitorIndex, downtime2, latency2, {from: owner});
        const downtime3 = new BigNumber(300);
        const latency3 = new BigNumber(400);
        await monitorsData.addVerdict(monitorIndex, downtime3, latency3, {from: owner});
        const dataLength = await monitorsData.getLengthOfMetrics(monitorIndex);
        dataLength.should.be.deep.equal(web3.utils.toBN(3));
        await monitorsData.removeAllVerdicts(monitorIndex, {from: user})
        .should.be.rejectedWith("Message sender is invalid");
        await monitorsData.removeAllVerdicts(monitorIndex, {from: owner});
        const dataLengthAfter = await monitorsData.getLengthOfMetrics(monitorIndex);
        dataLengthAfter.should.be.deep.equal(web3.utils.toBN(0));
    });

    it("should get validated array", async () => {
        const monitorIndex = web3.utils.soliditySha3("1");
        const validatedArray = await monitorsData.getCheckedArray(monitorIndex);
        validatedArray.length.should.be.equal(0);
        const data1 = {
            nodeIndex: 0,
            time: 2,
        };;
        await monitorsData.addCheckedNode(monitorIndex, data1, {from: owner});
        const validatedArray1 = await monitorsData.getCheckedArray(monitorIndex);
        validatedArray1.length.should.be.equal(1);

        // create node with id 1
        await nodes.addNode(
            owner,
            "D2",
            "0x00000006",
            "0x00000006",
            5,
            ["0x1122334455667788990011223344556677889900112233445566778899001122",
            "0x1122334455667788990011223344556677889900112233445566778899001122"],
            5);

        const data2 = {
            nodeIndex: 1,
            time: 5
        };;
        await monitorsData.addCheckedNode(monitorIndex, data2, {from: owner});
        const validatedArray2 = await monitorsData.getCheckedArray(monitorIndex);
        validatedArray2.length.should.be.equal(2);
    });

    it("should get length of metrics", async () => {
        const monitorIndex = web3.utils.soliditySha3("1");
        const dataLength = await monitorsData.getLengthOfMetrics(monitorIndex);
        dataLength.should.be.deep.equal(web3.utils.toBN(0));
        const downtime1 = new BigNumber(200);
        const latency1 = new BigNumber(300);
        await monitorsData.addVerdict(monitorIndex, downtime1, latency1, {from: owner});
        const downtime2 = new BigNumber(500);
        const latency2 = new BigNumber(200);
        await monitorsData.addVerdict(monitorIndex, downtime2, latency2, {from: owner});
        const downtime3 = new BigNumber(300);
        const latency3 = new BigNumber(400);
        await monitorsData.addVerdict(monitorIndex, downtime3, latency3, {from: owner});
        const dataLengthAfter = await monitorsData.getLengthOfMetrics(monitorIndex);
        dataLengthAfter.should.be.deep.equal(web3.utils.toBN(3));
    });
});
