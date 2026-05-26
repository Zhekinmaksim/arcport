import "dotenv/config";
import { ArcPortClient, describeX402Requirement } from "../src/index";

const client = new ArcPortClient({
  baseUrl: process.env.ARCPORT_URL,
  identityKey: process.env.ARCPORT_IDENTITY_KEY,
});

async function main() {
  console.log("ArcPort arcOSS starter kit demo");
  console.log("Loading x402 requirements...");
  const requirements = await client.getX402Requirements("social-signal");
  const x402 = describeX402Requirement(requirements);
  console.log(`x402 amount: ${x402.amount}`);
  console.log(`x402 network: ${x402.network}`);
  console.log(`x402 payTo: ${x402.payTo}`);

  console.log("Opening bounded session...");
  const session = await client.openSession({
    budgetUsdc: "0.01",
    maxCalls: 10,
    allowedApiIds: ["social-signal", "gemini"],
    agentRuntime: "arcoss-starter-kit",
    task: "evaluate three paid signals and write a memo",
  });
  console.log(`channel: ${session.channelId}`);
  console.log(`open tx: ${session.explorer.openTx}`);

  const signals = [
    { symbol: "BTC", side: "long", score: 0.545, drawdown: "8%" },
    { symbol: "SOL", side: "long", score: 0.384, drawdown: "18%" },
    { symbol: "ETH", side: "short", score: 0.318, drawdown: "14%" },
  ];

  for (const signal of signals) {
    const result = await client.call(session.channelId, "social-signal", signal);
    console.log(`signal ${signal.symbol}: call ${result.callsTotal}, cumulative ${result.cumulativeUsdc} USDC`);
  }

  const memo = await client.call(session.channelId, "gemini", {
    prompt: "Summarize three rejected trading signals in one concise portfolio-manager memo.",
  });
  console.log(`gemini memo call: ${memo.callsTotal}, cumulative ${memo.cumulativeUsdc} USDC`);

  console.log("Closing session...");
  const closed = await client.closeSession(session.channelId);
  console.log(`close tx: ${closed.explorer.closeTx}`);
  console.log(`calls total: ${closed.callsTotal}`);
  console.log(`spent: ${closed.cumulativeUsdc} USDC`);
  console.log(`refund: ${closed.refundUsdc} USDC`);
  console.log(`proof: ${closed.proofUrl}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
