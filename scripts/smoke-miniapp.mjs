// Run inside the API container. Read-only checks; never print credentials/initData.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const token = process.env.TELEGRAM_BOT_TOKEN;
const owner = process.env.EXPERT_TELEGRAM_IDS?.split(",").map((id) => id.trim()).find(Boolean);
assert(token && owner && Number.isSafeInteger(Number(owner)), "Telegram owner configuration is missing");
const params = new URLSearchParams({
  auth_date: String(Math.floor(Date.now() / 1000)),
  user: JSON.stringify({ id: Number(owner), first_name: "Smoke test" })
});
const check = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  .map(([key, value]) => `${key}=${value}`).join("\n");
const secret = createHmac("sha256", "WebAppData").update(token).digest();
params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
const authorization = `tma ${params}`;
const base = "http://127.0.0.1:3000/api";

async function get(path, signed = true) {
  const start = performance.now();
  const response = await fetch(`${base}${path}`, {
    headers: signed ? { authorization } : {},
    signal: AbortSignal.timeout(15_000)
  });
  const body = await response.json();
  return { response, body, milliseconds: Math.round(performance.now() - start) };
}

const health = await get("/health/ready", false);
assert.equal(health.response.status, 200);
const denied = await get("/miniapp/bootstrap", false);
assert.equal(denied.response.status, 401);
const forged = await fetch(`${base}/miniapp/bootstrap`, {
  headers: { authorization: "tma hash=" + "0".repeat(64) },
  signal: AbortSignal.timeout(15_000)
});
assert.equal(forged.status, 401);

const bootstrap = await get("/miniapp/bootstrap");
assert.equal(bootstrap.response.status, 200);
assert.equal(bootstrap.body.user.telegramId, owner);
assert(Array.isArray(bootstrap.body.drafts));
assert(bootstrap.body.drafts.every((draft) => Array.isArray(draft.segments) && draft.segments.length > 0));
assert.equal(bootstrap.response.headers.get("cache-control"), "no-store");
const plan = await get("/miniapp/plan");
assert.equal(plan.response.status, 200);
assert(Array.isArray(plan.body.publications));
const results = await get("/miniapp/results");
assert.equal(results.response.status, 200);
assert(Array.isArray(results.body.integrations));
assert.equal(results.body.insights?.available, true);
assert.equal(results.body.insights?.stale, false);
assert(Array.isArray(results.body.insights?.topPosts));
const settings = await get("/miniapp/settings");
assert.equal(settings.response.status, 200);
assert.deepEqual(settings.body, bootstrap.body.settings);

console.log(JSON.stringify({
  ok: true,
  unauthorized: denied.response.status,
  forged: forged.status,
  mode: bootstrap.body.mode,
  drafts: bootstrap.body.drafts.length,
  completeSegments: bootstrap.body.drafts.reduce((sum, draft) => sum + draft.segments.length, 0),
  planned: plan.body.publications.length,
  integrations: results.body.integrations.map(({ id, state }) => ({ id, state })),
  analytics: {
    available: results.body.insights.available,
    stale: results.body.insights.stale,
    topPosts: results.body.insights.topPosts.length
  },
  localApiMilliseconds: { bootstrap: bootstrap.milliseconds, plan: plan.milliseconds, results: results.milliseconds },
  note: "Container-local timings, not phone/network measurements"
}, null, 2));
