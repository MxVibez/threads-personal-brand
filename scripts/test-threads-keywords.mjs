const token = process.env.THREADS_ACCESS_TOKEN;
const baseUrl = (process.env.THREADS_API_BASE_URL ?? "https://graph.threads.net").replace(/\/$/, "");
const version = process.env.THREADS_API_VERSION ?? "v1.0";

if (!token) throw new Error("THREADS_ACCESS_TOKEN is required");

const queries = [
  "бизнес",
  "заявки",
  "клиенты",
  "продажи",
  "контент",
  "съемки",
  "Telegram",
  "приложение",
  "эксперт",
  "бренд",
  "автоматизация",
  "ИИ",
  "AI",
  "marketing",
  "sales",
  "startup",
  "app",
  "content creator",
  "small business"
];
const since = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1_000) / 1_000);
const results = [];

for (const query of queries) {
  const params = new URLSearchParams({
    q: query,
    search_type: "RECENT",
    search_mode: "KEYWORD",
    fields: "id,text,permalink,timestamp,username,is_reply",
    limit: "5",
    since: String(since)
  });
  const response = await fetch(`${baseUrl}/${version}/keyword_search?${params}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json().catch(() => null);
  results.push({
    query,
    status: response.status,
    count: Array.isArray(payload?.data) ? payload.data.length : 0,
    error: response.ok ? undefined : String(payload?.error?.message ?? `HTTP ${response.status}`)
      .replaceAll(token, "[REDACTED]")
  });
}

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
