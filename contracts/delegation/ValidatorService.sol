// SPDX-License-Identifier: AGPL-3.0-only

/*
    ValidatorService.sol - SKALE Manager
    Copyright (C) 2019-Present SKALE Labs
    @author Dmytro Stebaiev
    @author Artem Payvin
    @author Vadim Yavorsky

    SKALE Manager is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    SKALE Manager is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with SKALE Manager.  If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity 0.6.6;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/cryptography/ECDSA.sol";

import "../Permissions.sol";
import "../ConstantsHolder.sol";

import "./DelegationController.sol";

/**
 * @title ValidatorService
 * @dev This contract handles all validator operations including registration,
 * node management, validator-specific delegation parameters, and more.
 *
 * Validators register an address, and use this address to accept delegations and
 * register nodes.
 *
 */
contract ValidatorService is Permissions {

    using ECDSA for bytes32;

    struct Validator {
        string name;
        address validatorAddress;
        address requestedAddress;
        string description;
        uint feeRate;
        uint registrationTime;
        uint minimumDelegationAmount;
        uint[] nodeIndexes;
        bool acceptNewRequests;
    }

    /**
     * @dev Emitted when a validator registers.
     */
    event ValidatorRegistered(
        uint validatorId
    );

    /**
     * @dev Emitted when a validator address changes.
     */
    event ValidatorAddressChanged(
        uint validatorId,
        address newAddress
    );

    event ValidatorWasEnabled(
        uint validatorId
    );

    event ValidatorWasDisabled(
        uint validatorId
    );

    /**
     * @dev Emitted when a node address is linked to a validator.
     */
    event NodeAddressWasAdded(
        uint validatorId,
        address nodeAddress
    );

    /**
     * @dev Emitted when a node address is unlinked from a validator.
     */
    event NodeAddressWasRemoved(
        uint validatorId,
        address nodeAddress
    );

    mapping (uint => Validator) public validators;
    mapping (uint => bool) public trustedValidators;
    ///      address => validatorId
    mapping (address => uint) private _validatorAddressToId;
    ///      address => validatorId
    mapping (address => uint) private _nodeAddressToValidatorId;
    /// validatorId => nodeAddress[]
    mapping (uint => address[]) private _nodeAddresses;
    uint public numberOfValidators;

    bool public useWhitelist;

    modifier checkValidatorExists(uint validatorId) {
        require(validatorExists(validatorId), "Validator with such ID does not exist");
        _;
    }

    /**
     * @dev Creates a new validator Id.
     *
     * Requirements:
     *
     * - sender must not already have registered a validator Id.
     * - fee rate must be between 0 - 1000‰. Note: per mille!
     *
     * Emits ValidatorRegistered event.
     *
     * @param name string
     * @param description string
     * @param feeRate uint Fee charged on delegations by the validator per mille
     * @param minimumDelegationAmount uint Minimum delegation amount accepted by the validator
     */
    function registerValidator(
        string calldata name,
        string calldata description,
        uint feeRate,
        uint minimumDelegationAmount
    )
        external
        returns (uint validatorId)
    {
        require(!validatorAddressExists(msg.sender), "Validator with such address already exists");
        require(feeRate < 1000, "Fee rate of validator should be lower than 100%");
        uint[] memory emptyArray = new uint[](0);
        validatorId = ++numberOfValidators;
        validators[validatorId] = Validator(
            name,
            msg.sender,
            address(0),
            description,
            feeRate,
            now,
            minimumDelegationAmount,
            emptyArray,
            true
        );
        _setValidatorAddress(validatorId, msg.sender);

        emit ValidatorRegistered(validatorId);
    }

    function enableValidator(uint validatorId) external checkValidatorExists(validatorId) onlyOwner {
        require(!trustedValidators[validatorId], "Validator is already enabled");
        trustedValidators[validatorId] = true;
        emit ValidatorWasEnabled(validatorId);
    }

    function disableValidator(uint validatorId) external checkValidatorExists(validatorId) onlyOwner {
        require(trustedValidators[validatorId], "Validator is already disabled");
        trustedValidators[validatorId] = false;
        emit ValidatorWasDisabled(validatorId);
    }

    /**
     * @dev Owner can disable the validator whitelist. Once turned off the
     * whitelist cannot be re-enabled.
     */
    function disableWhitelist() external onlyOwner {
        useWhitelist = false;
    }

    /**
     * @dev Allows a validator to request a new address.
     *
     * Requirements:
     *
     * - new address must not be null
     * - new address must not be already registered as a validator
     *
     * @param newValidatorAddress address
     */
    function requestForNewAddress(address newValidatorAddress) external {
        require(newValidatorAddress != address(0), "New address cannot be null");
        require(_validatorAddressToId[newValidatorAddress] == 0, "Address already registered");
        uint validatorId = getValidatorId(msg.sender);
        validators[validatorId].requestedAddress = newValidatorAddress;
    }

    function confirmNewAddress(uint validatorId)
        external
        checkValidatorExists(validatorId)
    {
        require(
            getValidator(validatorId).requestedAddress == msg.sender,
            "The validator address cannot be changed because it is not the actual owner"
        );
        delete validators[validatorId].requestedAddress;
        _setValidatorAddress(validatorId, msg.sender);

        emit ValidatorAddressChanged(validatorId, validators[validatorId].validatorAddress);
    }

    /**
     * @dev Links a given node address.
     *
     * Requirements:
     *
     * - the given signature must be valid.
     * - the address must not be assigned to a validator.
     *
     * Emits NodeAddressWasAdded event.
     *
     * @param nodeAddress address
     * @param sig bytes signature of validator Id by node operator.
     */
    function linkNodeAddress(address nodeAddress, bytes calldata sig) external {
        uint validatorId = getValidatorId(msg.sender);
        bytes32 hashOfValidatorId = keccak256(abi.encodePacked(validatorId)).toEthSignedMessageHash();
        require(hashOfValidatorId.recover(sig) == nodeAddress, "Signature is not pass");
        require(_validatorAddressToId[nodeAddress] == 0, "Node address is a validator");
        _addNodeAddress(validatorId, nodeAddress);
        emit NodeAddressWasAdded(validatorId, nodeAddress);
    }

    /**
     * @dev Unlinks a given node address from a validator.
     *
     * Emits NodeAddressWasRemoved event.
     *
     * @param nodeAddress address
     */
    function unlinkNodeAddress(address nodeAddress) external {
        uint validatorId = getValidatorId(msg.sender);
        _removeNodeAddress(validatorId, nodeAddress);
        emit NodeAddressWasRemoved(validatorId, nodeAddress);
    }

    function pushNode(address nodeAddress, uint nodeIndex) external allow("SkaleManager") {
        uint validatorId = getValidatorIdByNodeAddress(nodeAddress);
        validators[validatorId].nodeIndexes.push(nodeIndex);
    }

    function deleteNode(uint validatorId, uint nodeIndex) external allow("SkaleManager") {
        uint[] memory validatorNodes = validators[validatorId].nodeIndexes;
        uint position = _findNode(validatorNodes, nodeIndex);
        if (position < validatorNodes.length) {
            validators[validatorId].nodeIndexes[position] =
                validators[validatorId].nodeIndexes[validatorNodes.length.sub(1)];
        }
        delete validators[validatorId].nodeIndexes[validatorNodes.length.sub(1)];
    }

    /**
     * @dev Allows SKALE Manager to check whether a validator has sufficient
     * stake to add a node.
     *
     * @param nodeAddress address ID of validator to perform the check
     */
    function checkPossibilityCreatingNode(address nodeAddress) external allow("SkaleManager") {
        DelegationController delegationController = DelegationController(
            _contractManager.getContract("DelegationController")
        );
        uint validatorId = getValidatorIdByNodeAddress(nodeAddress);
        require(trustedValidators[validatorId], "Validator is not authorized to create a node");
        uint[] memory validatorNodes = validators[validatorId].nodeIndexes;
        uint delegationsTotal = delegationController.getAndUpdateDelegatedToValidatorNow(validatorId);
        uint msr = ConstantsHolder(_contractManager.getContract("ConstantsHolder")).msr();
        require(
            (validatorNodes.length.add(1)) * msr <= delegationsTotal,
            "Validator must meet the Minimum Staking Requirement");
    }

    /**
     * @dev Allows SKALE Manager to check whether a validator can maintain a node
     * per minimum stake requirement (MSR).
     *
     * Requirements:
     *
     * - node must exist on the given validator
     *
     * @param validatorId uint ID of validator to perform the check
     * @param nodeIndex uint ID of the node under validatorID
     * @return bool True if validatorID can maintain nodeID
     */
    function checkPossibilityToMaintainNode(uint validatorId, uint nodeIndex)
        external allow("SkaleManager") returns (bool)
    {
        DelegationController delegationController = DelegationController(
            _contractManager.getContract("DelegationController")
        );
        uint[] memory validatorNodes = validators[validatorId].nodeIndexes;
        uint position = _findNode(validatorNodes, nodeIndex);
        require(position < validatorNodes.length, "Node does not exist for this Validator");
        uint delegationsTotal = delegationController.getAndUpdateDelegatedToValidatorNow(validatorId);
        uint msr = ConstantsHolder(_contractManager.getContract("ConstantsHolder")).msr();
        return position.add(1).mul(msr) <= delegationsTotal;
    }

    /**
     * @dev Allows a validator to set the minimum delegation amount.
     *
     * @param minimumDelegationAmount uint the minimum delegation amount
     * accepted by the validator
     */
    function setValidatorMDA(uint minimumDelegationAmount) external {
        uint validatorId = getValidatorId(msg.sender);
        validators[validatorId].minimumDelegationAmount = minimumDelegationAmount;
    }

    /**
     * @dev Allows a validator to set a new validator name.
     *
     * @param newName string
     */
    function setValidatorName(string calldata newName) external {
        uint validatorId = getValidatorId(msg.sender);
        validators[validatorId].name = newName;
    }

    /**
     * @dev Allows a validator to set a new validator description.
     *
     * @param newDescription string
     */
    function setValidatorDescription(string calldata newDescription) external {
        uint validatorId = getValidatorId(msg.sender);
        validators[validatorId].description = newDescription;
    }

    /**
     * @dev Allows a validator to start accepting new delegation requests.
     *
     * Requirements:
     *
     * - validator must not have already enabled accepting new requests
     */
    function startAcceptingNewRequests() external {
        uint validatorId = getValidatorId(msg.sender);
        require(!isAcceptingNewRequests(validatorId), "Accepting request is already enabled");
        validators[validatorId].acceptNewRequests = true;
    }

    /**
     * @dev Allows a validator to stop accepting new delegation requests.
     *
     * Requirements:
     *
     * - validator must not have already stopped accepting new requests
     */
    function stopAcceptingNewRequests() external {
        uint validatorId = getValidatorId(msg.sender);
        require(isAcceptingNewRequests(validatorId), "Accepting request is already disabled");
        validators[validatorId].acceptNewRequests = false;
    }

    /**
     * @dev Returns the amount of validator bond.
     *
     * @param validatorId uint ID of validator to return the amount of locked funds
     * @return bondAmount uint the amount of self-delegated funds by the validator
    */
    function getBondAmount(uint validatorId)
        external
        returns (uint bondAmount)
    {
        TimeHelpers timeHelpers = TimeHelpers(_contractManager.getContract("TimeHelpers"));
        DelegationController delegationController = DelegationController(
            _contractManager.getContract("DelegationController"));
        bondAmount = delegationController.getAndUpdateEffectiveDelegatedByHolderToValidator(
            validators[validatorId].validatorAddress,
            validatorId,
            timeHelpers.getCurrentMonth()
        ).div(100);
    }

    function getMyNodesAddresses() external view returns (address[] memory) {
        return getNodeAddresses(getValidatorId(msg.sender));
    }

    /**
     * @dev Returns a list of trusted validators.
     *
     * @return uint[] trusted validators
     */
    function getTrustedValidators() external view returns (uint[] memory) {
        uint numberOfTrustedValidators = 0;
        for (uint i = 1; i <= numberOfValidators; i++) {
            if (trustedValidators[i]) {
                numberOfTrustedValidators++;
            }
        }
        uint[] memory whitelist = new uint[](numberOfTrustedValidators);
        uint cursor = 0;
        for (uint i = 1; i <= numberOfValidators; i++) {
            if (trustedValidators[i]) {
                whitelist[cursor++] = i;
            }
        }
        return whitelist;
    }

    function checkMinimumDelegation(uint validatorId, uint amount)
        external
        view
        checkValidatorExists(validatorId)
        allow("DelegationController")
        returns (bool)
    {
        return validators[validatorId].minimumDelegationAmount <= amount ? true : false;
    }

    function checkValidatorAddressToId(address validatorAddress, uint validatorId)
        external
        view
        returns (bool)
    {
        return getValidatorId(validatorAddress) == validatorId ? true : false;
    }

    function getValidatorNodeIndexes(uint validatorId) external view returns (uint[] memory) {
        return getValidator(validatorId).nodeIndexes;
    }

    function initialize(address contractManager) public override initializer {
        Permissions.initialize(contractManager);
        useWhitelist = true;
    }

    function getValidatorIdByNodeAddress(address nodeAddress) public view returns (uint validatorId) {
        validatorId = _nodeAddressToValidatorId[nodeAddress];
        require(validatorId != 0, "Node address is not assigned to a validator");
    }

    function getNodeAddresses(uint validatorId) public view returns (address[] memory) {
        return _nodeAddresses[validatorId];
    }

    function validatorExists(uint validatorId) public view returns (bool) {
        return validatorId <= numberOfValidators && validatorId != 0;
    }

    function validatorAddressExists(address validatorAddress) public view returns (bool) {
        return _validatorAddressToId[validatorAddress] != 0;
    }

    function checkIfValidatorAddressExists(address validatorAddress) public view {
        require(validatorAddressExists(validatorAddress), "Validator with given address does not exist");
    }

    function getValidator(uint validatorId) public view checkValidatorExists(validatorId) returns (Validator memory) {
        return validators[validatorId];
    }

    function getValidatorId(address validatorAddress) public view returns (uint) {
        checkIfValidatorAddressExists(validatorAddress);
        return _validatorAddressToId[validatorAddress];
    }

    function isAcceptingNewRequests(uint validatorId) public view checkValidatorExists(validatorId) returns (bool) {
        return validators[validatorId].acceptNewRequests;
    }

    // private

    function _findNode(uint[] memory nodeIndexes, uint nodeIndex) internal pure returns (uint) {
        uint i;
        for (i = 0; i < nodeIndexes.length; i++) {
            if (nodeIndexes[i] == nodeIndex) {
                return i;
            }
        }
        return i;
    }

    function _setValidatorAddress(uint validatorId, address validatorAddress) internal {
        if (_validatorAddressToId[validatorAddress] == validatorId) {
            return;
        }
        require(_validatorAddressToId[validatorAddress] == 0, "Address is in use by another validator");
        address oldAddress = validators[validatorId].validatorAddress;
        delete _validatorAddressToId[oldAddress];
        _nodeAddressToValidatorId[validatorAddress] = validatorId;
        validators[validatorId].validatorAddress = validatorAddress;
        _validatorAddressToId[validatorAddress] = validatorId;
    }

    function _addNodeAddress(uint validatorId, address nodeAddress) internal {
        if (_nodeAddressToValidatorId[nodeAddress] == validatorId) {
            return;
        }
        require(_nodeAddressToValidatorId[nodeAddress] == 0, "Validator cannot override node address");
        _nodeAddressToValidatorId[nodeAddress] = validatorId;
        _nodeAddresses[validatorId].push(nodeAddress);
    }

    function _removeNodeAddress(uint validatorId, address nodeAddress) internal {
        require(_nodeAddressToValidatorId[nodeAddress] == validatorId,
            "Validator does not have permissions to unlink node");
        delete _nodeAddressToValidatorId[nodeAddress];
        for (uint i = 0; i < _nodeAddresses[validatorId].length; ++i) {
            if (_nodeAddresses[validatorId][i] == nodeAddress) {
                if (i + 1 < _nodeAddresses[validatorId].length) {
                    _nodeAddresses[validatorId][i] =
                        _nodeAddresses[validatorId][_nodeAddresses[validatorId].length.sub(1)];
                }
                delete _nodeAddresses[validatorId][_nodeAddresses[validatorId].length.sub(1)];
                _nodeAddresses[validatorId].pop();
                break;
            }
        }
    }
}
