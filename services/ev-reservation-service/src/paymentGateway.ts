import { randomUUID } from "node:crypto";

// Mock external Payment Gateway -- the "Payment Gateway / Bank card network"
// pool in Part B Processes 4 (tasks 4.6a, 4.11a) and 6 (task 6.8a).
//
// It is deliberately deterministic, keyed on the payment token, so that the
// live demo (demo.sh) and the Part F simulator (tools/simulator) can drive
// every branch of the BPMN models on purpose rather than by luck:
//
//   tok_decline_all   -> every attempt is declined
//   tok_decline_<n>   -> the first <n> attempts are declined, then approved
//   anything else     -> approved
//
// A small random latency stands in for the network round trip to the bank.

export interface GatewayResult {
  approved: boolean;
  authCode?: string;
  reason?: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function wouldApprove(token: string, attempt: number): boolean {
  if (token === "tok_decline_all") return false;
  const m = /^tok_decline_(\d+)$/.exec(token);
  if (m) return attempt > Number(m[1]);
  return true;
}

/** Places a hold (pre-authorisation) or a charge on the card. `attempt` is 1-based. */
export async function authorise(token: string, amount: number, attempt: number): Promise<GatewayResult> {
  await sleep(60 + Math.random() * 120);
  if (!wouldApprove(token, attempt)) {
    return { approved: false, reason: "card declined by issuer" };
  }
  return { approved: true, authCode: `AUTH-${randomUUID().slice(0, 8).toUpperCase()}` };
}

/** Captures funds against an existing hold and releases whatever is left of it. */
export async function capture(holdId: string, holdAmount: number, amount: number) {
  await sleep(60 + Math.random() * 120);
  return {
    captured: amount,
    released: Number(Math.max(holdAmount - amount, 0).toFixed(2)),
    transactionId: `TXN-${randomUUID().slice(0, 8).toUpperCase()}`,
    holdId,
  };
}
