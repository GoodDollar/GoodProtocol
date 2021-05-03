// SPDX-License-Identifier: MIT

pragma solidity >=0.7.0;

import "../../DAOStackInterfaces.sol";


/* @title Abstract contract responsible for ensuring a scheme is only usable within a set period
 */
contract ActivePeriod {
    uint256 public periodStart;
    uint256 public periodEnd;

    bool public isActive;

    Avatar avatar;

    event SchemeStarted(address indexed by, uint256 time);
    event SchemeEnded(address indexed by, uint256 time);

    /* @dev modifier that requires scheme to be active
     */
    modifier requireActive() {
        require(isActive, "is not active");
        _;
    }

    /* @dev modifier that requires scheme to not be active
     */
    modifier requireNotActive() {
        require(!isActive, "cannot start twice");
        _;
    }

    /* @dev modifier that requires current time to be after period start and before period end
     */
    modifier requireInPeriod() {
        require(block.timestamp >= periodStart && block.timestamp < periodEnd, "not in period");
        _;
    }

    /* @dev modifier that requires current time to be after period end
     */
    modifier requirePeriodEnd() {
        require(block.timestamp >= periodEnd, "period has not ended");
        _;
    }

    /* @dev Constructor. requires end period to be larger than start period
     * Sets local period parameters and sets isActive to false
     * @param _periodStart The time from when the contract can be started
     * @param _periodEnd The time from when the contract can be ended
     * @param _avatar DAO avatar
     */
    constructor(uint256 _periodStart, uint256 _periodEnd, Avatar _avatar)  {
        require(_periodStart < _periodEnd, "start cannot be after nor equal to end");

        periodStart = _periodStart;
        periodEnd = _periodEnd;
        avatar = _avatar;

        isActive = false;
    }

    /* @dev Function to start scheme. Must be inactive and within period.
     * Sets isActive to true and emits event with address that started and
     * current time.
     */
    function start() public requireInPeriod requireNotActive {
        isActive = true;
        emit SchemeStarted(msg.sender, block.timestamp);
    }

    /* @dev Function to end scheme. Must be after assigned period end.
     * Calls internal function internalEnd, passing along the avatar
     * @param _avatar the avatar of the dao
     */
    function end() public requirePeriodEnd {
        return internalEnd(avatar);
    }

    /* @dev internal end function. Must be active to run.
     * Sets contract to inactive, emits an event with caller and
     * current time, and self-destructs the contract, transferring any
     * eth in the contract to the avatar address
     * @param _avatar the avatar of the dao
     */
    function internalEnd(Avatar _avatar) internal requireActive {
        isActive = false;
        emit SchemeEnded(msg.sender, block.timestamp);
        //selfdestruct(address(_avatar));
    }
}
