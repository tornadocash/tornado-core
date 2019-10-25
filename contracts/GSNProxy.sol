pragma solidity ^0.5.8;
// contract we {}

import "./IUniswapExchange.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/GSN/GSNRecipient.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/GSN/IRelayHub.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/ownership/Ownable.sol";

contract IMixer {
  function withdraw(uint256[8] calldata proof, uint256[6] calldata input) external payable;
  function checkWithdrawalValidity(uint256[8] calldata proof, uint256[6] calldata input) external view;
  function denomination() external view returns(uint256);
  function token() external view returns(address); // only for ERC20 version
}

contract GSNProxy is GSNRecipient, Ownable {
  IMixer public mixer;
  IUniswapExchange public uniswap;
  IERC20 public token;

  constructor(address _mixer, address _uniswap) public {
    mixer = IMixer(_mixer);
    if (_uniswap != address(0)) {
      uniswap = IUniswapExchange(_uniswap);
      require(mixer.token() == uniswap.tokenAddress(), "mixer and uniswap have different tokens");
      token = IERC20(uniswap.tokenAddress());
    } else {
      // todo: require that mixer is ETH version?
    }
  }

  // Allow to refill mixer balance
  function () external payable {}

  modifier onlyHub() {
    require(msg.sender == getHubAddr(), "only relay hub");
    _;
  }

  /**
    @dev Checks fee and calls mixer withdraw
  */
  function withdraw(uint256[8] calldata proof, uint256[6] calldata input) external {
    mixer.withdraw.value(refund)(proof, input);
    // todo: check that we received expected fee?
  }

  // gsn related stuff
  // this func is called by a Relayer via the RelayerHub before sending a tx
  function acceptRelayedCall(
    address /*relay*/,
    address /*from*/,
    bytes memory encodedFunction,
    uint256 /*transactionFee*/,
    uint256 /*gasPrice*/,
    uint256 /*gasLimit*/,
    uint256 /*nonce*/,
    bytes memory /*approvalData*/,
    uint256 maxPossibleCharge
  ) public view returns (uint256, bytes memory) {
    // think of a withdraw dry-run
    if (!compareBytesWithSelector(encodedFunction, this.withdraw.selector)) {
      return (1, "Only withdrawViaRelayer can be called");
    }

    bytes memory proof;
    bytes memory root;
    uint256 fee;
    uint256 refund;
    assembly {
      let dataPointer := add(encodedFunction, 32)
      let nullifierPointer := mload(add(dataPointer, 4)) // 4 + (8 * 32) + (32) == selector + proof + root
      let recipientPointer := mload(add(dataPointer, 324)) // 4 + (8 * 32) + (32) + (32) == selector + proof + root + nullifier
      mstore(recipient, 64) // save array length
      mstore(add(recipient, 32), recipientPointer) // save recipient address
      mstore(add(recipient, 64), nullifierPointer) // save nullifier address
    }
    //mixer.checkWithdrawalValidity(proof, inputs)
    // todo: duplicate withdraw checks?

    if (token != IERC20(0)) {
      // todo maybe static exchange rate?
      if (uniswap.getTokenToEthInputPrice(fee) < maxPossibleCharge + refund) {
        return (11, "Fee is too low");
      }
    } else {
      // refund is expected to be 0, checked by mixer contract
      if (fee < maxPossibleCharge + refund) {
        return (11, "Fee is too low");
      }
    }

    if (mixer.checkWithdrawalValidity()) {

    }

    return _approveRelayedCall();
  }

  // this func is called by RelayerHub right before calling a target func
  function preRelayedCall(bytes calldata /*context*/) onlyHub external returns (bytes32) {}
  function postRelayedCall(bytes memory /*context*/, bool /*success*/, uint actualCharge, bytes32 /*preRetVal*/) onlyHub public {
    IRelayHub(getHubAddr()).depositFor.value(actualCharge)(address(this));
  }

  function compareBytesWithSelector(bytes memory data, bytes4 sel) internal pure returns (bool) {
    return data[0] == sel[0]
    && data[1] == sel[1]
    && data[2] == sel[2]
    && data[3] == sel[3];
  }

  // Admin functions

  function withdrawFundsFromHub(uint256 amount, address payable dest) onlyOwner external {
    IRelayHub(getHubAddr()).withdraw(amount, dest);
  }

  function upgradeRelayHub(address newRelayHub) onlyOwner external {
    _upgradeRelayHub(newRelayHub);
  }

  function withdrawEther(uint256 amount) onlyOwner external {
    msg.sender.transfer(amount);
  }

  function withdrawTokens(uint256 amount) onlyOwner external {
    safeErc20Transfer(msg.sender, amount);
  }

  function sellTokens(uint256 amount, uint256 min_eth) onlyOwner external {
    token.approve(address(uniswap), amount);
    uniswap.tokenToEthSwapInput(amount, min_eth, now);
  }

  function safeErc20Transfer(address to, uint256 amount) internal {
    bool success;
    bytes memory data;
    bytes4 transferSelector = 0xa9059cbb;
    (success, data) = address(token).call(
      abi.encodeWithSelector(
        transferSelector,
        to, amount
      )
    );
    require(success, "not enough tokens");

    // if contract returns some data let's make sure that is `true` according to standard
    if (data.length > 0) {
      assembly {
        success := mload(add(data, 0x20))
      }
      require(success, "not enough tokens. Token returns false.");
    }
  }
}
