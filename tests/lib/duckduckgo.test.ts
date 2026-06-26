import { describe, expect, it } from "vitest";
import {
  decodeDuckDuckGoHref,
  parseDuckDuckGoHtml,
} from "@/lib/integrations/duckduckgo";
import { CONNECTORS, CONNECTOR_DOMAINS } from "@/lib/connectors";

describe("decodeDuckDuckGoHref", () => {
  it("unwraps DuckDuckGo redirect links to the real URL", () => {
    const href =
      "//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fjanedoe&rut=abc";
    expect(decodeDuckDuckGoHref(href)).toBe("https://github.com/janedoe");
  });

  it("passes through already-direct URLs", () => {
    expect(decodeDuckDuckGoHref("https://example.com/x")).toBe(
      "https://example.com/x",
    );
  });
});

describe("parseDuckDuckGoHtml", () => {
  const html = `
    <div class="result">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fjanedoe">Jane&#39;s GitHub</a>
      <a class="result__snippet" href="x">Senior video engineer &amp; ffmpeg contributor.</a>
    </div>
    <div class="result">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fjanedoe.dev">Jane Doe — Personal site</a>
      <a class="result__snippet" href="y">Berlin-based engineer.</a>
    </div>`;

  it("extracts title, decoded url, and snippet in order", () => {
    const results = parseDuckDuckGoHtml(html, 10);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      url: "https://github.com/janedoe",
      title: "Jane's GitHub",
      description: "Senior video engineer & ffmpeg contributor.",
    });
    expect(results[1].url).toBe("https://janedoe.dev");
    expect(results[1].title).toBe("Jane Doe — Personal site");
  });

  it("respects the limit and dedupes repeated URLs", () => {
    expect(parseDuckDuckGoHtml(html, 1)).toHaveLength(1);
    const dup = html + html; // same two results twice
    expect(parseDuckDuckGoHtml(dup, 10)).toHaveLength(2);
  });

  it("returns nothing for a page with no results (e.g. a challenge page)", () => {
    expect(parseDuckDuckGoHtml("<html><body>nope</body></html>")).toEqual([]);
  });
});

describe("DuckDuckGo connector catalog", () => {
  const ddg = CONNECTORS.find((c) => c.provider === "duckduckgo");

  it("is a live, built-in, keyless Tool connector", () => {
    expect(ddg).toBeDefined();
    expect(ddg!.category).toBe("tool");
    expect(ddg!.live).toBe(true);
    expect(ddg!.builtin).toBe(true);
    expect(ddg!.auth).toBeUndefined();
  });

  it("has a brand domain for its logo", () => {
    expect(CONNECTOR_DOMAINS.duckduckgo).toBe("duckduckgo.com");
  });
});
