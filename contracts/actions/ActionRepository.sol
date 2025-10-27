// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IActionRepository} from "../interfaces/IActionRepository.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Zero address provided where non-zero was expected.
error ZeroAddress();
/// @dev Amount value cannot be zero.
error ZeroAmount();
/// @dev Caller is not allowed to execute the requested action.
error NotAuthorized();
/// @dev Input array lengths do not match.
error ArrayLengthMismatch();
/// @dev Nonce has already been used.
error NonceAlreadyUsed();
/// @dev Signature is invalid.
error InvalidSignature();

/// @title ActionRepository
/// @notice Stores per-agent action counters that can be consumed by staking activity checkers.
contract ActionRepository is IActionRepository, EIP712, Ownable {
    /// @dev Per agent per action type counters.
    mapping(address => mapping(bytes32 => uint256)) private _actionCounts;
    /// @dev Aggregated action counter per agent across all action types.
    mapping(address => uint256) private _totalActions;
    /// @dev Timestamp of the last recorded action per agent.
    mapping(address => uint256) private _lastActionAt;
    /// @dev Current active status reported for an agent.
    mapping(address => bool) private _agentActive;
    /// @dev Nonces for EIP712 verification. Each action nonce is used only once.
    mapping(bytes32 => bool) private _actionNoncesUsed;
    /// @dev Address of the private key that signed the action.
    address public mainSigner;

    /// @notice Emitted when an agent action is recorded.
    event ActionRecorded(
        address indexed recorder,
        bytes32 indexed actionType,
        uint256 amount,
        uint256 totalForAction,
        uint256 totalForAgent
    );

    /// @notice Emitted when an agent active status flag is updated.
    event AgentStatusUpdated(address indexed agent, bool active);

    /// @notice Emitted when the signer is changed.
    event MainSignerChanged(address indexed newSigner);

    /// @notice Initializes the contract with the owner along with the EIP712 domain separator.
    /// @param _owner The owner of the contract.
    /// @param _signer The signer of the contract.
    constructor(
        address _owner,
        address _signer
    ) EIP712("PettAIActionVerifier", "1") Ownable(_owner) {
        if (_signer == address(0)) {
            revert ZeroAddress();
        }
        mainSigner = _signer;
    }

    /// @notice Records an action performed by the caller.
    /// @param actionType Identifier of the action type.
    /// @param amount Number of actions to add (for example, batch transactions).
    /// @return newActionCount Updated counter for the action type.
    function recordAction(
        bytes32 actionType,
        uint256 amount
    ) public onlyOwner returns (uint256 newActionCount) {
        if (msg.sender == address(0)) {
            revert ZeroAddress();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }

        uint256 updatedActionCount = _actionCounts[msg.sender][actionType] +
            amount;
        _actionCounts[msg.sender][actionType] = updatedActionCount;
        uint256 updatedTotal = _totalActions[msg.sender] + amount;
        _totalActions[msg.sender] = updatedTotal;
        _lastActionAt[msg.sender] = block.timestamp;
        _agentActive[msg.sender] = true;

        emit ActionRecorded(
            msg.sender,
            actionType,
            amount,
            updatedActionCount,
            updatedTotal
        );

        return updatedActionCount;
    }

    /// @notice Records multiple action types in a single call, useful for syncing batched agent stats.
    /// @param actionTypes Array of action identifiers.
    /// @param amounts Array of corresponding action increments.
    /// @return totalAdded Sum of increments applied across all action types.
    function recordActionsBatch(
        bytes32[] calldata actionTypes,
        uint256[] calldata amounts
    ) external onlyOwner returns (uint256 totalAdded) {
        if (msg.sender == address(0)) {
            revert ZeroAddress();
        }
        if (actionTypes.length != amounts.length) {
            revert ArrayLengthMismatch();
        }

        uint256 len = actionTypes.length;
        uint256 newTotal = _totalActions[msg.sender];
        for (uint256 i = 0; i < len; i++) {
            uint256 amount = amounts[i];
            if (amount == 0) {
                revert ZeroAmount();
            }
            bytes32 actionType = actionTypes[i];
            uint256 updatedActionCount = _actionCounts[msg.sender][actionType] +
                amount;
            _actionCounts[msg.sender][actionType] = updatedActionCount;
            newTotal += amount;
            emit ActionRecorded(
                msg.sender,
                actionType,
                amount,
                updatedActionCount,
                newTotal
            );
            totalAdded += amount;
        }

        if (totalAdded > 0) {
            _totalActions[msg.sender] = newTotal;
            _lastActionAt[msg.sender] = block.timestamp;
            _agentActive[msg.sender] = true;
        }
    }

    /// @inheritdoc IActionRepository
    function totalActions(address agent) external view returns (uint256 total) {
        return _totalActions[agent];
    }

    /// @notice Gets the total number of actions recorded for the caller across all action types.
    /// @return total Total recorded actions for the caller.
    function totalActions() external view returns (uint256 total) {
        return _totalActions[msg.sender];
    }

    /// @inheritdoc IActionRepository
    function actionCount(
        address agent,
        bytes32 actionType
    ) external view returns (uint256 count) {
        return _actionCounts[agent][actionType];
    }

    /// @notice Gets the number of actions of a specific type recorded for the caller.
    /// @param actionType Identifier of the action type.
    /// @return count Total recorded actions for the type for the caller.
    function actionCount(
        bytes32 actionType
    ) external view returns (uint256 count) {
        return _actionCounts[msg.sender][actionType];
    }

    /// @inheritdoc IActionRepository
    function lastActionTimestamp(
        address agent
    ) external view returns (uint256 timestamp) {
        return _lastActionAt[agent];
    }

    /// @notice Gets the timestamp of the last recorded action for the caller.
    /// @return timestamp Timestamp of the last recorded action for the caller (0 if never recorded).
    function lastActionTimestamp() external view returns (uint256 timestamp) {
        return _lastActionAt[msg.sender];
    }

    /// @inheritdoc IActionRepository
    function isAgentActive(
        address agent
    ) external view returns (bool isActive) {
        return _agentActive[agent];
    }

    /// @notice Returns whether the caller is currently marked as active.
    /// @return isActive Boolean flag designating the active status of the caller.
    /// @dev This will not exactly match the agent EOA of the agent but it will be the multisig address that will perform the action.
    function isAgentActive() external view returns (bool isActive) {
        return _agentActive[msg.sender];
    }

    // --------------------------
    // EIP712 Functionality
    // --------------------------

    /// @notice Typehash for the PetAction struct used in EIP712 signing.
    bytes32 private constant _PET_ACTION_TYPEHASH =
        keccak256("PetAction(uint8 action,bytes32 nonce,uint256 timestamp)");

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Returns the name of the contract. Needed to facilitate EIP712 verification.
    function name() external pure returns (string memory) {
        return "PettAIActionVerifier";
    }

    /// @notice Returns the version of the contract. Needed to facilitate EIP712 verification.
    function version() external pure returns (string memory) {
        return "1";
    }

    /// @notice Verifies the signature of a PetAction and returns the signer address.
    /// @param actionId The numeric ID of the action.
    /// @param nonce The nonce of the action (should be keccak256 of a string on the server side).
    /// @param timestamp The timestamp of when the action was signed.
    /// @param v ECDSA recovery ID.
    /// @param r ECDSA signature r value.
    /// @param s ECDSA signature s value.
    /// @return signer The address that signed the action.
    /// @dev This function does not consume the nonce. Use verifyAndConsumeAction for that.
    function verifyAction(
        uint8 actionId,
        bytes32 nonce,
        uint256 timestamp,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public view returns (address) {
        bytes32 structHash = keccak256(
            abi.encode(_PET_ACTION_TYPEHASH, actionId, nonce, timestamp)
        );

        bytes32 hash = _hashTypedDataV4(structHash);

        return ECDSA.recover(hash, v, r, s);
    }

    /// @notice Verifies the signature of a PetAction, consumes the nonce, and records the action.
    /// @param actionId The numeric ID of the action.
    /// @param nonce The nonce of the action (should be keccak256 of a string on the server side).
    /// @param timestamp The timestamp of when the action was signed.
    /// @param v ECDSA recovery ID.
    /// @param r ECDSA signature r value.
    /// @param s ECDSA signature s value.
    /// @return newActionCount Updated counter for the action type.
    /// @dev This function will revert if the signature is invalid or the nonce was already used.
    function verifyAndConsumeAction(
        uint8 actionId,
        bytes32 nonce,
        uint256 timestamp,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256 newActionCount) {
        // Verify signature
        address recoveredSigner = verifyAction(
            actionId,
            _useNonce(nonce), // Mark nonce as used
            timestamp,
            v,
            r,
            s
        );
        if (recoveredSigner != mainSigner) {
            revert InvalidSignature();
        }

        // Convert uint8 actionId to bytes32 for storage
        bytes32 actionType = bytes32(uint256(actionId));

        // Record the action
        return recordActionAs(actionType, 1, mainSigner);
    }

    /// @notice Records an action on behalf of another address (internal helper).
    /// @param actionType Identifier of the action type.
    /// @param amount Number of actions to add.
    /// @param agent The address to record the action for.
    /// @return newActionCount Updated counter for the action type.
    function recordActionAs(
        bytes32 actionType,
        uint256 amount,
        address agent
    ) internal returns (uint256 newActionCount) {
        if (agent == address(0)) {
            revert ZeroAddress();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }

        uint256 updatedActionCount = _actionCounts[agent][actionType] + amount;
        _actionCounts[agent][actionType] = updatedActionCount;
        uint256 updatedTotal = _totalActions[agent] + amount;
        _totalActions[agent] = updatedTotal;
        _lastActionAt[agent] = block.timestamp;
        _agentActive[agent] = true;

        emit ActionRecorded(
            agent,
            actionType,
            amount,
            updatedActionCount,
            updatedTotal
        );
        return updatedActionCount;
    }

    function _useNonce(bytes32 nonce) private returns (bytes32) {
        if (_actionNoncesUsed[nonce]) {
            revert NonceAlreadyUsed();
        }

        _actionNoncesUsed[nonce] = true;
        return nonce;
    }

    function _changeMainSigner(
        address newSigner
    ) private onlyOwner returns (bool) {
        if (newSigner == address(0)) {
            revert ZeroAddress();
        }
        mainSigner = newSigner;
        emit MainSignerChanged(newSigner);
        return true;
    }
}
