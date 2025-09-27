// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IActionRepository
/// @notice Minimal interface for reading agent action statistics.
interface IActionRepository {
    /// @notice Gets the total number of actions recorded for an agent across all action types.
    /// @param agent Address of the agent.
    /// @return total Total recorded actions.
    function totalActions(address agent) external view returns (uint256 total);

    /// @notice Gets the number of actions of a specific type recorded for an agent.
    /// @param agent Address of the agent.
    /// @param actionType Identifier of the action type.
    /// @return count Total recorded actions for the type.
    function actionCount(address agent, bytes32 actionType) external view returns (uint256 count);

    /// @notice Gets the timestamp of the last recorded action for an agent.
    /// @param agent Address of the agent.
    /// @return timestamp Timestamp of the last recorded action (0 if never recorded).
    function lastActionTimestamp(address agent) external view returns (uint256 timestamp);

    /// @notice Returns whether the agent is currently marked as active.
    /// @param agent Address of the agent.
    /// @return isActive Boolean flag designating the active status.
    function isAgentActive(address agent) external view returns (bool isActive);
}
