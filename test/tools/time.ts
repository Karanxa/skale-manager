import Web3 from "web3";

let requestId = 0xd2;

function responseCallback(error: Error | null, val?: any) {
    if (error !== null) {
        console.log(error, val);
    }
}

export function skipTime(web3: Web3, seconds: number) {
    web3.givenProvider.send(
        {
            id: requestId++,
            jsonrpc: "2.0",
            method: "evm_increaseTime",
            params: [seconds],
        },
        responseCallback);

    web3.givenProvider.send(
        {
            id: requestId++,
            jsonrpc: "2.0",
            method: "evm_mine",
            params: [],
        },
        responseCallback);
}

export async function skipTimeToDate(web3: Web3, day: number, monthIndex: number) {
    const timestamp = await currentTime(web3);
    const now = new Date(timestamp * 1000);
    const targetTime = new Date(Date.UTC(now.getFullYear(), monthIndex, day));
    while (targetTime < now) {
        targetTime.setFullYear(now.getFullYear() + 1);
    }
    const diffInSeconds = Math.round(targetTime.getTime() / 1000) - timestamp;
    skipTime(web3, diffInSeconds);
}

export async function currentTime(web3: Web3) {
    return parseInt((await web3.eth.getBlock("latest")).timestamp.toString());
}

export const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export async function isLeapYear(web3: Web3) {
    const timestamp = await currentTime(web3);
    const now = new Date(timestamp * 1000);
    return now.getFullYear() % 4 === 0;
}
