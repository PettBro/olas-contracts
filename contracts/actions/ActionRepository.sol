// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IActionRepository} from "../interfaces/IActionRepository.sol";

/// @dev Zero address provided where non-zero was expected.
error ZeroAddress();
/// @dev Amount value cannot be zero.
error ZeroAmount();
/// @dev Operation restricted to the contract owner.
error NotOwner();
/// @dev Caller is not allowed to execute the requested action.
error NotAuthorized();
/// @dev Input array lengths do not match.
error ArrayLengthMismatch();

/// @title ActionRepository
/// @notice Stores per-agent action counters that can be consumed by staking activity checkers.
contract ActionRepository is IActionRepository {
    /// @notice Current contract owner.
    address public owner;

    /// @dev Per agent per action type counters.
    mapping(address => mapping(bytes32 => uint256)) private _actionCounts;
    /// @dev Aggregated action counter per agent across all action types.
    mapping(address => uint256) private _totalActions;
    /// @dev Timestamp of the last recorded action per agent.
    mapping(address => uint256) private _lastActionAt;
    /// @dev Current active status reported for an agent.
    mapping(address => bool) private _agentActive;

    /// @notice Emitted whenever contract ownership changes.
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    /// @notice Emitted when an agent action is recorded.
    event ActionRecorded(
        address indexed recorder,
        address indexed agent,
        bytes32 indexed actionType,
        uint256 amount,
        uint256 totalForAction,
        uint256 totalForAgent
    );
    /// @notice Emitted when an agent active status flag is updated.
    event AgentStatusUpdated(address indexed agent, bool active);

    /// @notice Ensures that only the owner can call a function.
    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert NotOwner();
        }
        _;
    }

    /// @notice Reverts when the caller is neither the target agent nor the owner.
    /// @param agent Address of the agent the call relates to.
    modifier onlyOwnerOrAgent(address agent) {
        if (msg.sender != agent && msg.sender != owner) {
            revert NotAuthorized();
        }
        _;
    }

    /// @param admin Initial owner address.
    constructor(address admin) {
        if (admin == address(0)) {
            revert ZeroAddress();
        }
        owner = admin;
        emit OwnershipTransferred(address(0), admin);
    }

    /// @notice Transfers contract ownership to a new address.
    /// @param newOwner Address of the new owner.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) {
            revert ZeroAddress();
        }
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    /// @notice Updates the active status flag for an agent.
    /// @param agent Address of the agent.
    /// @param active New active status indicator.
    function setAgentStatus(address agent, bool active) external onlyOwnerOrAgent(agent) {
        if (agent == address(0)) {
            revert ZeroAddress();
        }
        _agentActive[agent] = active;
        emit AgentStatusUpdated(agent, active);
    }

    /// @notice Records an action performed by an agent.
    /// @param agent Address of the agent whose action is being recorded.
    /// @param actionType Identifier of the action type.
    /// @param amount Number of actions to add (for example, batch transactions).
    /// @return newActionCount Updated counter for the action type.
    function recordAction(address agent, bytes32 actionType, uint256 amount)
        public
        onlyOwnerOrAgent(agent)
        returns (uint256 newActionCount)
    {
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

        emit ActionRecorded(msg.sender, agent, actionType, amount, updatedActionCount, updatedTotal);
        return updatedActionCount;
    }

    /// @notice Convenience helper to record an action where the caller is the agent being updated.
    /// @param actionType Identifier of the action type.
    /// @param amount Number of actions to add.
    /// @return newActionCount Updated counter for the action type.
    function recordActionForSelf(bytes32 actionType, uint256 amount) external returns (uint256 newActionCount) {
        return recordAction(msg.sender, actionType, amount);
    }

    /// @notice Records multiple action types in a single call, useful for syncing batched agent stats.
    /// @param agent Address of the agent whose actions are being recorded.
    /// @param actionTypes Array of action identifiers.
    /// @param amounts Array of corresponding action increments.
    /// @return totalAdded Sum of increments applied across all action types.
    function recordActionsBatch(address agent, bytes32[] calldata actionTypes, uint256[] calldata amounts)
        external
        onlyOwnerOrAgent(agent)
        returns (uint256 totalAdded)
    {
        if (agent == address(0)) {
            revert ZeroAddress();
        }
        if (actionTypes.length != amounts.length) {
            revert ArrayLengthMismatch();
        }

        uint256 len = actionTypes.length;
        uint256 newTotal = _totalActions[agent];
        for (uint256 i = 0; i < len; i++) {
            uint256 amount = amounts[i];
            if (amount == 0) {
                revert ZeroAmount();
            }
            bytes32 actionType = actionTypes[i];
            uint256 updatedActionCount = _actionCounts[agent][actionType] + amount;
            _actionCounts[agent][actionType] = updatedActionCount;
            newTotal += amount;
            emit ActionRecorded(msg.sender, agent, actionType, amount, updatedActionCount, newTotal);
            totalAdded += amount;
        }

        if (totalAdded > 0) {
            _totalActions[agent] = newTotal;
            _lastActionAt[agent] = block.timestamp;
            _agentActive[agent] = true;
        }
    }

    /// @inheritdoc IActionRepository
    function totalActions(address agent) external view returns (uint256 total) {
        return _totalActions[agent];
    }

    /// @inheritdoc IActionRepository
    function actionCount(address agent, bytes32 actionType) external view returns (uint256 count) {
        return _actionCounts[agent][actionType];
    }

    /// @inheritdoc IActionRepository
    function lastActionTimestamp(address agent) external view returns (uint256 timestamp) {
        return _lastActionAt[agent];
    }

    /// @inheritdoc IActionRepository
    function isAgentActive(address agent) external view returns (bool isActive) {
        return _agentActive[agent];
    }
}
