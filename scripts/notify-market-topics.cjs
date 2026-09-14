require("reflect-metadata");
const { NestFactory } = require("@nestjs/core");
const { MarketMonitorService } = require("../dist/market/market-monitor.service");
const { WorkerModule } = require("../dist/worker/worker.module");

async function main() {
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
  try {
    const monitor = app.get(MarketMonitorService);
    await monitor.notifyOwners(new Date(Date.now() - 24 * 60 * 60 * 1_000));
    process.stdout.write("Market topic notification check completed.\n");
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Market topic notification failed: ${message}\n`);
  process.exitCode = 1;
});
