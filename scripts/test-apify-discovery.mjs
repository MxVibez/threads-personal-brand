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
  searchQueries: ["AI startups"],
  searchType: "all",
  maxItems: testLimit,
  includeReplies: false,
  postedAfter: new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10),
  proxyConfiguration: { useApifyProxy: true }
};

const runResponse = await fetch(
  `https://api.apify.com/v2/acts/${encodeURIComponent(actorApiId)}/runs?waitForFinish=120&maxItems=${testLimit}&maxTotalChargeUsd=0.05`,
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
  throw new Error(`Apify run failed to start: HTTP ${runResponse.status}`);
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
const samples = items.slice(0, 3).map((item) => ({
  keys: Object.keys(item).slice(0, 30),
  username: item.username ?? item.author_username ?? item.author?.username ?? null,
  text: String(item.text ?? item.caption ?? item.content ?? "").slice(0, 240),
  url: item.url ?? item.post_url ?? item.postUrl ?? null,
  query: item.searchQuery ?? item.query ?? item.search_keyword ?? null,
  likes: item.like_count ?? item.likeCount ?? item.likes ?? null,
  replies: item.reply_count ?? item.replyCount ?? item.replies ?? null
}));

process.stdout.write(`${JSON.stringify({
  runId: run.id,
  status: run.status,
  datasetId: run.defaultDatasetId,
  itemCount: items.length,
  samples
}, null, 2)}\n`);
