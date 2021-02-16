import { ContractManager, DelegationController } from "../../../../typechain";
import { deployBounty } from "../bounty";
import { deployFunctionFactory } from "../factory";
import { deploySkaleToken } from "../skaleToken";
import { deployDelegationPeriodManager } from "./delegationPeriodManager";
import { deployTimeHelpers } from "./timeHelpers";
import { deployTokenLaunchLocker } from "./tokenLaunchLocker";
import { deployValidatorService } from "./validatorService";

const deployDelegationController: (contractManager: ContractManager) => Promise<DelegationController>
    = deployFunctionFactory("DelegationController",
                            async (contractManager: ContractManager) => {
                                await deployValidatorService(contractManager);
                                await deployTimeHelpers(contractManager);
                                await deployDelegationPeriodManager(contractManager);
                                await deployTokenLaunchLocker(contractManager);
                                await deploySkaleToken(contractManager);
                                await deployBounty(contractManager);
                            });

export { deployDelegationController };
