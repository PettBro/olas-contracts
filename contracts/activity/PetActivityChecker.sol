// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IActionRepository} from "../interfaces/IActionRepository.sol";

/// @dev Zero address provided where non-zero was expected.
error ZeroAddress();
/// @dev Numeric parameter must be greater than zero.
error ZeroValue();
/// @dev Operation restricted to the contract owner.
error NotOwner();

/// @title PetActivityChecker
/// @notice Helper contract for staking setups that validates agent activity using an actions repository.
/// @dev The contract exposes the standard staking helper view functions expected by OLAS staking contracts.
contract PetActivityChecker {
    uint256 private constant ONE = 1e18;
    uint256 private constant THIRTY_DAYS_SECONDS = 2592000;

    /// @notice Current contract owner.
    address public owner;
    /// @notice Repository that stores the counted actions per agent.
    IActionRepository public immutable actionRepository;
    /// @notice Minimum actions per second requirement expressed with 18 decimals precision. In a day, livenessRatio * 86400 is the minimum number of actions required.
    //! @dev livenessRatio of 12 transactions per day -> 12 * 10^18 / (24 * 60 * 60) =
    uint256 public livenessRatio;

    /// @notice Emitted whenever contract ownership changes.
    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
    );
    /// @notice Emitted when the liveness ratio is updated.
    event LivenessRatioUpdated(
        uint256 indexed oldRatio,
        uint256 indexed newRatio
    );

    /// @notice Ensures that only the owner can call a function.
    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert NotOwner();
        }
        _;
    }

    /// @param repository Address of the actions repository contract.
    /// @param _livenessRatio Minimum actions per second represented with 18 decimals.
    /// @param _owner Address of the contract owner.
    constructor(address repository, uint256 _livenessRatio, address _owner) {
        if (repository == address(0)) {
            revert ZeroAddress();
        }
        if (_livenessRatio == 0) {
            revert ZeroValue();
        }
        if (_owner == address(0)) {
            revert ZeroAddress();
        }
        actionRepository = IActionRepository(repository);
        livenessRatio = _livenessRatio;
        owner = _owner;
        emit OwnershipTransferred(address(0), _owner);
    }

    /// @notice Returns activity metrics for a specific agent that will be cached by the staking contract.
    /// @dev Layout: [0] -> total actions, [1] -> active status flag (1 / 0).
    /// @param agent Address of the agent being queried.
    /// @return nonces Structured array of activity metrics aligned with the staking helper interface.
    function getMultisigNonces(
        address agent
    ) external view returns (uint256[] memory nonces) {
        nonces = new uint256[](2);
        nonces[0] = actionRepository.totalActions(agent);
        nonces[1] = actionRepository.isAgentActive(agent) ? 1 : 0;
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
        if (curNonces.length != lastNonces.length || curNonces.length < 2) {
            return false;
        }

        // Active flag is stored at index 1.
        if (curNonces[1] == 0) {
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

        uint256 ratio = (diff * ONE) / ts;
        if (ratio < livenessRatio) {
            return false;
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

    /// @notice Updates the liveness ratio requirement.
    /// @param newLivenessRatio New minimum actions per second requirement.
    function changeLivenessRatio(uint256 newLivenessRatio) external onlyOwner {
        if (newLivenessRatio == 0) {
            revert ZeroValue();
        }
        uint256 oldRatio = livenessRatio;
        livenessRatio = newLivenessRatio;
        emit LivenessRatioUpdated(oldRatio, newLivenessRatio);
    }
}
