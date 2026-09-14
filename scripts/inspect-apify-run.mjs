const token = process.env.APIFY_API_TOKEN;
const runId = process.argv[2];

if (!token) throw new Error("APIFY_API_TOKEN is required");
if (!runId || !/^[A-Za-z0-9_-]{8,80}$/.test(runId)) {
  throw new Error("A valid Apify run id is required");
}

const headers = { authorization: `Bearer ${token}` };
const runResponse = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, { headers });
if (!runResponse.ok) throw new Error(`Run lookup failed: HTTP ${runResponse.status}`);
const run = (await runResponse.json()).data;

let input = null;
if (run.defaultKeyValueStoreId) {
  const inputResponse = await fetch(
    `https://api.apify.com/v2/key-value-stores/${run.defaultKeyValueStoreId}/records/INPUT`,
    { headers }
  );
  if (inputResponse.ok) input = await inputResponse.json();
}

const logResponse = await fetch(`https://api.apify.com/v2/logs/${runId}`, { headers });
const rawLog = logResponse.ok ? await logResponse.text() : `Log lookup failed: HTTP ${logResponse.status}`;
const safeLog = rawLog
  .replaceAll(token, "[REDACTED]")
  .replace(/apify_api_[A-Za-z0-9_-]+/g, "[REDACTED]")
  .slice(-8_000);

process.stdout.write(`${JSON.stringify({
  run: {
    id: run.id,
    status: run.status,
    statusMessage: run.statusMessage,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    defaultDatasetId: run.defaultDatasetId,
    usageTotalUsd: run.usageTotalUsd,
    stats: run.stats
  },
  input,
  logTail: safeLog
}, null, 2)}\n`);
