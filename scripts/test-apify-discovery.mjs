const token = process.env.APIFY_API_TOKEN;
const actor = process.env.APIFY_ACTOR_ID;
const requestedLimit = Number.parseInt(process.env.APIFY_TEST_RUN_LIMIT ?? "9", 10);
const testLimit = Number.isFinite(requestedLimit)
  ? Math.max(1, Math.min(9, requestedLimit))
  : 9;

if (!token) throw new Error("APIFY_API_TOKEN is required");
if (!actor) throw new Error("APIFY_ACTOR_ID is required");

const actorApiId = actor.replace("/", "~");
const input = {
  queries: "Reddit Entrepreneur AI automation",
  maxPagesPerQuery: 1,
  resultsPerPage: 10,
  countryCode: "us",
  languageCode: "en",
  quickDateRange: "w1",
  mobileResults: false,
  includeUnfilteredResults: false,
  saveHtml: false,
  saveHtmlToKeyValueStore: false,
  includeIcons: false,
  maximumLeadsEnrichmentRecords: 0,
  aiOverview: { scrapeFullAiOverview: false },
  proxyConfiguration: { useApifyProxy: true }
};

const runResponse = await fetch(
  `https://api.apify.com/v2/acts/${encodeURIComponent(actorApiId)}/runs?waitForFinish=60`,
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  }
);

if (!runResponse.ok) {
  const detail = (await runResponse.text())
    .replaceAll(token, "[REDACTED]")
    .replace(/apify_api_[A-Za-z0-9_-]+/g, "[REDACTED]")
    .slice(0, 2_000);
  throw new Error(`Apify run failed to start: HTTP ${runResponse.status}: ${detail}`);
}

let run = (await runResponse.json()).data;
for (let attempt = 0; attempt < 36 && !["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(run.status); attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  const statusResponse = await fetch(`https://api.apify.com/v2/actor-runs/${run.id}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!statusResponse.ok) throw new Error(`Apify status check failed: HTTP ${statusResponse.status}`);
  run = (await statusResponse.json()).data;
}

if (run.status !== "SUCCEEDED") {
  throw new Error(`Apify run finished with status ${run.status}`);
}

const itemsResponse = await fetch(
  `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?clean=true&limit=${testLimit}`,
  { headers: { authorization: `Bearer ${token}` } }
);
if (!itemsResponse.ok) throw new Error(`Dataset download failed: HTTP ${itemsResponse.status}`);
const items = await itemsResponse.json();
const results = items.flatMap((page) => Array.isArray(page.organicResults)
  ? page.organicResults.map((item) => ({
      ...item,
      searchQuery: page.searchQuery?.term ?? page.searchQuery ?? page.query
    }))
  : []
).slice(0, testLimit);
const samples = results.slice(0, 5).map((item) => ({
  title: String(item.title ?? "").slice(0, 180),
  description: String(item.description ?? item.snippet ?? "").slice(0, 280),
  url: item.url ?? item.link ?? null,
  query: item.searchQuery ?? null
}));

process.stdout.write(`${JSON.stringify({
  runId: run.id,
  status: run.status,
  datasetId: run.defaultDatasetId,
  pageCount: items.length,
  itemCount: results.length,
  samples
}, null, 2)}\n`);
