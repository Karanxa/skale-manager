require('dotenv').config();
var fs = require('fs');
const privateKey = process.env.PRIVATE_KEY;
const endpoint = process.env.ENDPOINT;
const proxyAdminAdress = process.env.PROXY_ADMIN_ADDRESS;

const Web3 = require('web3');
const PrivateKeyProvider = require("@truffle/hdwallet-provider");
const provider = new PrivateKeyProvider(privateKey, endpoint);
const web3 = new Web3(provider);

const proxy_admin_abi = require(`./ProxyAdminAbi.json`);
let ProxyAdmin = new web3.eth.Contract(proxy_admin_abi['proxy_admin_abi'], proxyAdminAdress);

const unique = require("../../data/unique.json");

function formTestAddresses() {
    let json = {};
    for (let data in unique) {
        const splitted = data.split('_');
        if (splitted[splitted.length - 1] == "address") {
            splitted.pop();
            json[splitted.join('_')] = unique[data];
        }
    }
    var jsonData = JSON.stringify(json);
    fs.writeFileSync("scripts/upgrade/ContractAddresses.json", jsonData);
    process.exit();
}


function snake2Pascal(str){
    str += '';
    str = str.split('_');
    for(var i = 0; i < str.length; i++){ 
        str[i] = str[i].slice(0,1).toUpperCase() + str[i].slice(1,str[i].length);
    }
    return str.join('');
}
async function getProxyImplementation(address) {
    let res = await ProxyAdmin.methods.getProxyImplementation(address).call();
    console.log(res);
    process.exit();
}

async function getLocalNetworkId() {
    const localEndpoint = "http://127.0.0.1:8545";
    const localPrivateKey = "a15c19da241e5b1db20d8dd8ca4b5eeaee01c709b49ec57aa78c2133d3c1b3c9";
    const Web3 = require('web3');
    const PrivateKeyProvider = require("@truffle/hdwallet-provider");
    const provider = new PrivateKeyProvider(localPrivateKey, localEndpoint);
    const web3 = new Web3(provider);
    return await web3.eth.net.getId();
}

async function getTestProxyAdminAddress() {
    const networkId = await web3.eth.net.getId();
    let ozJson = require(`../../.openzeppelin/dev-${networkId}.json`);
    console.log(ozJson.proxyAdmin.address);
    process.exit();
}

async function getProxyAdminAddress() {
    const networkId = await web3.eth.net.getId();
    let ozJson = require(`../../.openzeppelin/mainnet.json`);
    console.log(ozJson.proxyAdmin.address);
    process.exit();
}



async function replaceAdresses() {
    const networkId = await getLocalNetworkId();
    let ozJson = require(`../../.openzeppelin/dev-${networkId}.json`);
    const contracts = require(`./ContractAddresses.json`);
    for (let contractName in contracts) {
        if (contractName == "skale_token") {
            continue;
        }
        proxyAddress = contracts[contractName];
        contractNamePascalCase = snake2Pascal(contractName); 
        let implementationAddress = await ProxyAdmin.methods.getProxyImplementation(proxyAddress).call(); 
        ozJson.contracts[contractNamePascalCase].address =  implementationAddress;
        ozJson.proxies[`skale-manager/${contractNamePascalCase}`][0].address = proxyAddress;
        ozJson.proxies[`skale-manager/${contractNamePascalCase}`][0].implementation = implementationAddress;
        ozJson.proxies[`skale-manager/${contractNamePascalCase}`][0].admin = proxyAdminAdress;
    }
    ozJson.proxyAdmin.address = proxyAdminAdress;
    var jsonData = JSON.stringify(ozJson);
    fs.writeFileSync("scripts/upgrade/network.json", jsonData);

    process.exit();
}

if (process.argv[2] == 'get') {
    getProxyImplementation(process.argv[3]);
} else if (process.argv[2] == 'local') {
    getLocalNetworkId();
} else if (process.argv[2] == 'form') {
    formTestAddresses();
} else if (process.argv[2] == 'getTestProxyAdminAddress') {
    getTestProxyAdminAddress();
} else if (process.argv[2] == 'getProxyAdminAddress') {
    getProxyAdminAddress();
} else {
    replaceAdresses();
}