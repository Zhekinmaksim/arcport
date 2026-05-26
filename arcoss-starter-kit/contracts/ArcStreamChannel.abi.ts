export const arcStreamChannelAbi = [
  {
    type: "function",
    name: "open",
    stateMutability: "nonpayable",
    inputs: [{ name: "deposit", type: "uint256" }],
    outputs: [{ name: "channelId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "close",
    stateMutability: "nonpayable",
    inputs: [
      { name: "channelId", type: "bytes32" },
      { name: "cumulative", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getChannel",
    stateMutability: "view",
    inputs: [{ name: "channelId", type: "bytes32" }],
    outputs: [
      { name: "agent", type: "address" },
      { name: "deposit", type: "uint256" },
      { name: "expiry", type: "uint256" },
      { name: "withdrawn", type: "uint256" },
      { name: "closed", type: "bool" },
      { name: "remainingCalls", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "ChannelOpened",
    inputs: [
      { name: "channelId", type: "bytes32", indexed: true },
      { name: "agent", type: "address", indexed: true },
      { name: "deposit", type: "uint256", indexed: false },
      { name: "expiry", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ChannelClosed",
    inputs: [
      { name: "channelId", type: "bytes32", indexed: true },
      { name: "paidToPlatform", type: "uint256", indexed: false },
      { name: "refundedToAgent", type: "uint256", indexed: false },
    ],
  },
] as const;

