const required = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "APP_BASE_URL"];
for (const name of required) {
  if (!process.env[name]) {
    process.stderr.write(`${name} is required\n`);
    process.exit(1);
  }
}

const baseUrl = process.env.APP_BASE_URL.replace(/\/$/, "");
const response = await fetch(
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: `${baseUrl}/api/webhooks/telegram`,
      secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false
    }),
    signal: AbortSignal.timeout(15_000)
  }
);

const payload = await response.json();
if (!response.ok || payload.ok !== true) {
  process.stderr.write(`Telegram rejected webhook: ${JSON.stringify(payload)}\n`);
  process.exit(1);
}

process.stdout.write("Telegram webhook registered successfully.\n");
