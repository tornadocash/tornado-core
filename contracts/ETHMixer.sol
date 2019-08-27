// https://tornado.cash
/*
* d888888P                                           dP              a88888b.                   dP
*    88                                              88             d8'   `88                   88
*    88    .d8888b. 88d888b. 88d888b. .d8888b. .d888b88 .d8888b.    88        .d8888b. .d8888b. 88d888b.
*    88    88'  `88 88'  `88 88'  `88 88'  `88 88'  `88 88'  `88    88        88'  `88 Y8ooooo. 88'  `88
*    88    88.  .88 88       88    88 88.  .88 88.  .88 88.  .88 dP Y8.   .88 88.  .88       88 88    88
*    dP    `88888P' dP       dP    dP `88888P8 `88888P8 `88888P' 88  Y88888P' `88888P8 `88888P' dP    dP
* ooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooo
*/

pragma solidity ^0.5.8;

import "./Mixer.sol";

contract ETHMixer is Mixer {
  uint256 public etherDenomination;

  constructor(
    address _verifier,
    uint256 _etherDenomination,
    uint8 _merkleTreeHeight,
    uint256 _emptyElement,
    address payable _operator
  ) Mixer(_verifier, _merkleTreeHeight, _emptyElement, _operator) public {
    etherDenomination = _etherDenomination;
  }

  /**
    @dev Deposit funds into mixer. The caller must send value equal to `etherDenomination` of this mixer.
    @param commitment the note commitment, which is PedersenHash(nullifier + secret)
  */
  function deposit(uint256 commitment) public payable {
    require(msg.value == etherDenomination, "Please send `etherDenomination` ETH along with transaction");
    _deposit(commitment);

    emit Deposit(commitment, next_index - 1, block.timestamp);
  }

  /**
    @dev Withdraw deposit from the mixer. `a`, `b`, and `c` are zkSNARK proof data, and input is an array of circuit public inputs
    `input` array consists of:
      - merkle root of all deposits in the mixer
      - hash of unique deposit nullifier to prevent double spends
      - the receiver of funds
      - optional fee that goes to the transaction sender (usually a relay)
  */
  function withdraw(uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[4] memory input) public {
    _withdraw(a, b, c, input);
    address payable receiver = address(input[2]);
    uint256 fee = input[3];
    uint256 nullifierHash = input[1];

    require(fee < etherDenomination, "Fee exceeds transfer value");
    receiver.transfer(etherDenomination - fee);
    if (fee > 0) {
      operator.transfer(fee);
    }

    emit Withdraw(receiver, nullifierHash, fee);
  }
}
