import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHmac } from "crypto";
import { verifySlackRequest } from "@/lib/slack-verify";

const SECRET = "test-signing-secret";
const prev = process.env.SLACK_SIGNING_SECRET;

beforeAll(() => {
  process.env.SLACK_SIGNING_SECRET = SECRET;
});
afterAll(() => {
  if (prev === undefined) delete process.env.SLACK_SIGNING_SECRET;
  else process.env.SLACK_SIGNING_SECRET = prev;
});

function sign(body: string, ts: string): string {
  return "v0=" + createHmac("sha256", SECRET).update(`v0:${ts}:${body}`).digest("hex");
}

describe("verifySlackRequest", () => {
  const now = 1_700_000_000_000;
  const ts = String(Math.floor(now / 1000));
  const body = "token=abc&text=hello";

  it("accepts a correctly signed, fresh request", () => {
    expect(verifySlackRequest(body, sign(body, ts), ts, now)).toEqual({ ok: true });
  });

  it("rejects a tampered body", () => {
    const r = verifySlackRequest("token=evil", sign(body, ts), ts, now);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("bad_signature");
  });

  it("rejects a stale timestamp", () => {
    const oldTs = String(Math.floor(now / 1000) - 60 * 10);
    const r = verifySlackRequest(body, sign(body, oldTs), oldTs, now);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("stale");
  });

  it("rejects missing headers", () => {
    expect(verifySlackRequest(body, null, ts, now).reason).toBe("missing_headers");
  });
});
