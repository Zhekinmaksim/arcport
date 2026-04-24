// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ArcStreamChannel
 * @notice Minimal USDC payment channel for ArcPort session mode on Arc Testnet.
 *
 * Flow:
 *   1. Agent opens a channel by depositing USDC.
 *   2. Agent signs cumulative vouchers offchain for each API call (EIP-712).
 *   3. ArcPort verifies vouchers offchain for high-frequency usage.
 *   4. Final voucher is submitted on close and the contract settles:
 *      platform receives cumulative spend, agent receives the remainder.
 *   5. Agent can reclaim after expiry if the channel is not closed.
 */

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract ArcStreamChannel {
    address public immutable USDC;
    address public immutable PLATFORM;

    uint256 public constant PRICE_PER_CALL = 1000; // $0.001 USDC (6 decimals)
    uint256 public constant CHANNEL_TTL = 1 hours;

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant VOUCHER_TYPEHASH =
        keccak256("Voucher(bytes32 channelId,uint256 cumulative)");
    bytes32 private constant NAME_HASH = keccak256("ArcStreamChannel");
    bytes32 private constant VERSION_HASH = keccak256("1");

    struct Channel {
        address agent;
        uint256 deposit;
        uint256 expiry;
        uint256 withdrawn;
        bool closed;
    }

    mapping(bytes32 => Channel) public channels;
    uint256 public channelNonce;

    event ChannelOpened(
        bytes32 indexed channelId,
        address indexed agent,
        uint256 deposit,
        uint256 expiry
    );
    event ChannelClosed(
        bytes32 indexed channelId,
        uint256 paidToPlatform,
        uint256 refundedToAgent
    );
    event ChannelExpired(bytes32 indexed channelId, uint256 refundedToAgent);

    constructor(address usdc, address platform) {
        require(usdc != address(0), "USDC required");
        require(platform != address(0), "Platform required");
        USDC = usdc;
        PLATFORM = platform;
    }

    /**
     * @notice Open a channel and lock USDC in the contract.
     */
    function open(uint256 deposit) external returns (bytes32 channelId) {
        require(deposit >= PRICE_PER_CALL, "Deposit too small");
        require(
            IERC20(USDC).transferFrom(msg.sender, address(this), deposit),
            "USDC transfer failed"
        );

        channelId = keccak256(
            abi.encodePacked(msg.sender, block.timestamp, block.chainid, channelNonce++)
        );

        channels[channelId] = Channel({
            agent: msg.sender,
            deposit: deposit,
            expiry: block.timestamp + CHANNEL_TTL,
            withdrawn: 0,
            closed: false
        });

        emit ChannelOpened(channelId, msg.sender, deposit, channels[channelId].expiry);
    }

    /**
     * @notice Close a channel with the final cumulative voucher.
     * @dev Anyone may submit the voucher; settlement always pays PLATFORM and refunds the agent.
     */
    function close(
        bytes32 channelId,
        uint256 cumulative,
        bytes calldata signature
    ) external {
        Channel storage channel = channels[channelId];
        require(channel.agent != address(0), "Unknown channel");
        require(!channel.closed, "Already closed");
        require(cumulative <= channel.deposit, "Exceeds deposit");
        require(cumulative >= channel.withdrawn, "Below withdrawn");

        bytes32 digest = _voucherDigest(channelId, cumulative);
        address signer = _recover(digest, signature);
        require(signer == channel.agent, "Invalid signature");

        channel.closed = true;
        channel.withdrawn = cumulative;

        uint256 toPlatform = cumulative;
        uint256 toAgent = channel.deposit - cumulative;

        if (toPlatform > 0) {
            require(IERC20(USDC).transfer(PLATFORM, toPlatform), "Platform payout failed");
        }
        if (toAgent > 0) {
            require(IERC20(USDC).transfer(channel.agent, toAgent), "Refund failed");
        }

        emit ChannelClosed(channelId, toPlatform, toAgent);
    }

    /**
     * @notice Reclaim remaining funds after expiry if the channel was never closed.
     */
    function expire(bytes32 channelId) external {
        Channel storage channel = channels[channelId];
        require(channel.agent != address(0), "Unknown channel");
        require(!channel.closed, "Already closed");
        require(block.timestamp > channel.expiry, "Not expired");
        require(msg.sender == channel.agent, "Not channel owner");

        channel.closed = true;
        uint256 refund = channel.deposit - channel.withdrawn;
        if (refund > 0) {
            require(IERC20(USDC).transfer(channel.agent, refund), "Refund failed");
        }

        emit ChannelExpired(channelId, refund);
    }

    /**
     * @notice Verify a voucher offchain-compatible way from the contract itself.
     */
    function verifyVoucher(
        bytes32 channelId,
        uint256 cumulative,
        bytes calldata signature
    ) external view returns (address signer) {
        bytes32 digest = _voucherDigest(channelId, cumulative);
        signer = _recover(digest, signature);
    }

    function getChannel(bytes32 channelId)
        external
        view
        returns (
            address agent,
            uint256 deposit,
            uint256 expiry,
            uint256 withdrawn,
            bool closed,
            uint256 remainingCalls
        )
    {
        Channel storage channel = channels[channelId];
        agent = channel.agent;
        deposit = channel.deposit;
        expiry = channel.expiry;
        withdrawn = channel.withdrawn;
        closed = channel.closed;
        remainingCalls = deposit > withdrawn ? (deposit - withdrawn) / PRICE_PER_CALL : 0;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                NAME_HASH,
                VERSION_HASH,
                block.chainid,
                address(this)
            )
        );
    }

    function _voucherDigest(bytes32 channelId, uint256 cumulative) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(VOUCHER_TYPEHASH, channelId, cumulative)
        );
        return keccak256(
            abi.encodePacked("\x19\x01", domainSeparator(), structHash)
        );
    }

    function _recover(bytes32 hash, bytes calldata signature) internal pure returns (address) {
        require(signature.length == 65, "Invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (v < 27) v += 27;
        require(v == 27 || v == 28, "Invalid v");
        return ecrecover(hash, v, r, s);
    }
}
