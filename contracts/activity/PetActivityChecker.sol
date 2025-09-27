// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IActionRepository} from "../interfaces/IActionRepository.sol";

/// @dev Zero address provided where non-zero was expected.
error ZeroAddress();
/// @dev Numeric parameter must be greater than zero.
error ZeroValue();

/// @title PetActivityChecker
/// @notice Helper contract for staking setups that validates agent activity using an actions repository.
/// @dev The contract exposes the standard staking helper view functions expected by OLAS staking contracts.
contract PetActivityChecker {
    uint256 private constant ONE = 1e18;
    uint256 private constant THIRTY_DAYS_SECONDS = 2592000;

    /// @notice Repository that stores the counted actions per agent.
    IActionRepository public immutable actionRepository;
    /// @notice Minimum actions per second requirement expressed with 18 decimals precision.
    uint256 public immutable livenessRatio;
    /// @notice Optional minimum number of actions that must be executed within every checkpoint window.
    uint256 public immutable minActionsPerPeriod;
    /// @notice Optional upper bound on idle time since the last action (0 disables the check).
    uint256 public immutable maxInactivity;

    /// @param repository Address of the actions repository contract.
    /// @param _livenessRatio Minimum actions per second represented with 18 decimals.
    /// @param _minActionsPerPeriod Minimum absolute action count required per checkpoint window (0 disables).
    /// @param _maxInactivity Maximum acceptable idle seconds since the last action (0 disables the check).
    constructor(
        address repository,
        uint256 _livenessRatio,
        uint256 _minActionsPerPeriod,
        uint256 _maxInactivity
    ) {
        if (repository == address(0)) {
            revert ZeroAddress();
        }
        if (_livenessRatio == 0) {
            revert ZeroValue();
        }
        actionRepository = IActionRepository(repository);
        livenessRatio = _livenessRatio;
        minActionsPerPeriod = _minActionsPerPeriod;
        maxInactivity = _maxInactivity;
    }

    /// @notice Returns activity metrics for a specific agent that will be cached by the staking contract.
    /// @dev Layout: [0] -> total actions, [1] -> last action timestamp, [2] -> active status flag (1 / 0).
    /// @param agent Address of the agent being queried.
    /// @return nonces Structured array of activity metrics aligned with the staking helper interface.
    function getMultisigNonces(
        address agent
    ) external view returns (uint256[] memory nonces) {
        nonces = new uint256[](3);
        nonces[0] = actionRepository.totalActions(agent);
        nonces[1] = actionRepository.lastActionTimestamp(agent);
        nonces[2] = actionRepository.isAgentActive(agent) ? 1 : 0;
    }

    /// @notice Determines whether the agent activity threshold has been satisfied within the observed window.
    /// @dev This function will need to be refactored if we want to "value" more actions than the others, right now we jstu see if they met the threshold
    /// @param curNonces Current metrics produced by `getMultisigNonces`.
    /// @param lastNonces Metrics captured at the previous checkpoint.
    /// @param ts Time delta between the current checkpoint and the previous one, in seconds.
    /// @return ratioPass Boolean flag indicating if the requirements are met.
    function isRatioPass(
        uint256[] memory curNonces,
        uint256[] memory lastNonces,
        uint256 ts
    ) external view returns (bool ratioPass) {
        if (curNonces.length != lastNonces.length || curNonces.length < 3) {
            return false;
        }

        // Active flag is stored at index 2.
        if (curNonces[2] == 0) {
            return false;
        }

        if (ts == 0) {
            return false;
        }

        // ts needs to be within reasonable bounds (?) Not sure if we got to cap it; I capped it @ 1 month
        if (ts >= THIRTY_DAYS_SECONDS) {
            return false;
        }

        uint256 currentCount = curNonces[0];
        uint256 previousCount = lastNonces[0];

        if (currentCount <= previousCount) {
            return false;
        }

        uint256 diff = currentCount - previousCount;

        if (minActionsPerPeriod > 0 && diff < minActionsPerPeriod) {
            return false;
        }

        uint256 ratio = (diff * ONE) / ts;
        if (ratio < livenessRatio) {
            return false;
        }

        if (maxInactivity > 0) {
            uint256 lastActionTs = curNonces[1];
            if (lastActionTs == 0) {
                return false;
            }
            if (block.timestamp - lastActionTs > maxInactivity) {
                return false;
            }
        }

        ratioPass = true;
    }

    /// @notice Helper for off-chain tools to compute the number of actions required for a given period length.
    /// @param periodSeconds Duration (in seconds) of the checkpoint window.
    /// @return requiredActions Minimum number of actions required to satisfy the configured liveness ratio.
    function computeRequiredActions(
        uint256 periodSeconds
    ) external view returns (uint256 requiredActions) {
        return (livenessRatio * periodSeconds) / ONE;
    }

    /// @notice Function to change the liveness ratio (only callable by owner in future implementation)
    /// @dev This function is currently incomplete and would need access control; Not sure if we want to add it in the actions repo contract tho
    /// @param newLivenessRatio New minimum actions per second requirement
    function changeLivenessRatio(uint256 newLivenessRatio) external {
        // TODO: Add access control (e.g., onlyOwner modifier)
        // TODO: Add validation for newLivenessRatio > 0
        // TODO: Emit event for the change
        // For now, this is a placeholder that would need proper implementation
        revert("Function not yet implemented");
    }
}
