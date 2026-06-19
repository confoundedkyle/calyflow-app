import { describe, it, expect } from "vitest";
import { markdownToMrkdwn, slackDeliveryBlock } from "@/lib/slack";

describe("markdownToMrkdwn", () => {
  it("converts ** bold to Slack single-asterisk bold", () => {
    expect(markdownToMrkdwn("**hi** there")).toBe("*hi* there");
    expect(markdownToMrkdwn("__hi__")).toBe("*hi*");
  });

  it("turns Markdown links into Slack <url|label> links", () => {
    expect(markdownToMrkdwn("see [the doc](https://x.com/a)")).toBe(
      "see <https://x.com/a|the doc>",
    );
  });

  it("renders headings as bold lines", () => {
    expect(markdownToMrkdwn("# Title\nbody")).toBe("*Title*\nbody");
    expect(markdownToMrkdwn("### Sub")).toBe("*Sub*");
  });

  it("normalizes bullets to •", () => {
    expect(markdownToMrkdwn("- one\n* two")).toBe("• one\n• two");
  });

  it("strips the language hint from fenced code blocks", () => {
    expect(markdownToMrkdwn("```ts\ncode\n```")).toBe("```\ncode\n```");
  });
});

describe("slackDeliveryBlock", () => {
  it("embeds hiring-manager + Slack-formatting guidance", () => {
    const block = slackDeliveryBlock();
    expect(block).toContain("hiring manager");
    expect(block).toContain("mrkdwn");
    expect(block.toLowerCase()).toContain("never invent");
  });
});
