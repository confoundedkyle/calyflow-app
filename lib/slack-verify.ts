import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { env } from "./env";

// Verify that an inbound request really came from Slack, per
// https://api.slack.com/authentication/verifying-requests-from-slack:
// signature = "v0=" + HMAC-SHA256(signing_secret, `v0:${timestamp}:${rawBody}`),
// compared constant-time against the X-Slack-Signature header. We also reject
// stale timestamps (>5 min) to blunt replay. Uses the single shared-app signing
// secret (SLACK_SIGNING_SECRET) — inbound assumes one Slack app, not per-workspace.

const MAX_SKEW_SECONDS = 60 * 5;

export interface SlackVerifyResult {
  ok: boolean;
  reason?: "not_configured" | "missing_headers" | "stale" | "bad_signature";
}

export function verifySlackRequest(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  now: number = Date.now(),
): SlackVerifyResult {
  const secret = env.slackSigningSecret;
  if (!secret) return { ok: false, reason: "not_configured" };
  if (!signature || !timestamp) return { ok: false, reason: "missing_headers" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: "stale" };
  }

  const expected =
    "v0=" +
    createHmac("sha256", secret)
      .update(`v0:${timestamp}:${rawBody}`)
      .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true };
}
