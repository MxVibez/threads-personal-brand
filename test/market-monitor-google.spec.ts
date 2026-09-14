import { afterEach, describe, expect, it, vi } from "vitest";
import { MarketMonitorService } from "../src/market/market-monitor.service";

describe("MarketMonitorService Google radar adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("flattens Google organic results and preserves the search direction", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([
      {
        searchQuery: { term: "Reddit Entrepreneur AI automation" },
        organicResults: [
          {
            title: "Where AI automations break",
            description: "Real customers and messy business data expose weak workflows.",
            url: "https://www.reddit.com/r/n8n/comments/example"
          }
        ]
      }
    ]), { status: 200 })));

    const service = new MarketMonitorService({} as never, {} as never);
    const items = await service["loadDataset"]("secret", "dataset", 10);
    const first = items[0];

    expect(items).toHaveLength(1);
    expect(first).toMatchObject({
      query: "Reddit Entrepreneur AI automation",
      postUrl: "https://www.reddit.com/r/n8n/comments/example",
      username: "reddit.com"
    });
    expect(first?.text).toContain("Where AI automations break");
  });

  it("accepts only HTTPS URLs from the approved source list", () => {
    const service = new MarketMonitorService({} as never, {} as never);

    expect(service["sourceUrl"]("https://www.reddit.com/r/startups/post")).toBe(
      "https://www.reddit.com/r/startups/post"
    );
    expect(service["sourceUrl"]("https://evil.example/phishing")).toBe("");
    expect(service["sourceUrl"]("http://www.reddit.com/insecure")).toBe("");
  });
});
