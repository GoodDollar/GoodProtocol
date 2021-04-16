// SPDX-License-Identifier: MIT
pragma solidity >=0.7.0;

import "openzeppelin-solidity/contracts/access/Ownable.sol";
import "../../DAOStackInterfaces.sol";

/* @dev abstract contract for ensuring that schemes have been registered properly
 * Allows setting zero Avatar in situations where the Avatar hasn't been created yet
 */
contract SchemeGuard is Ownable {
    Avatar avatar;
    Controller internal controller = Controller(address(0x0));

    /** @dev Constructor. only sets controller if given avatar is not null.
     * @param _avatar The avatar of the DAO.
     */
    constructor(Avatar _avatar) public {
        avatar = _avatar;

        if (avatar != Avatar(address(0x0))) {
            controller = Controller(avatar.owner());
        }
    }

    /** @dev modifier to check if caller is avatar
     */
    modifier onlyAvatar() {
        require(address(avatar) == msg.sender, "only Avatar can call this method");
        _;
    }

    /** @dev modifier to check if scheme is registered
     */
    modifier onlyRegistered() {
        require(isRegistered(), "Scheme is not registered");
        _;
    }

    /** @dev modifier to check if scheme is not registered
     */
    modifier onlyNotRegistered() {
        require(!isRegistered(), "Scheme is registered");
        _;
    }

    /** @dev modifier to check if call is a scheme that is registered
     */
    modifier onlyRegisteredCaller() {
        require(isRegistered(msg.sender), "Calling scheme is not registered");
        _;
    }

    /** @dev Function to set a new avatar and controller for scheme
     * can only be done by owner of scheme
     */
    function setAvatar(Avatar _avatar) public onlyOwner {
        avatar = _avatar;
        controller = Controller(avatar.owner());
    }

    /** @dev function to see if an avatar has been set and if this scheme is registered
     * @return true if scheme is registered
     */
    function isRegistered() public view returns (bool) {
        return isRegistered(address(this));
    }

    /** @dev function to see if an avatar has been set and if this scheme is registered
     * @return true if scheme is registered
     */
    function isRegistered(address scheme) public view returns (bool) {
        require(avatar != Avatar(address(0x0)), "Avatar is not set");

        if (!(controller.isSchemeRegistered(scheme, address(avatar)))) {
            return false;
        }
        return true;
    }
}