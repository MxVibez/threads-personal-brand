import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { ThreadsAnalyticsService } from "../results/threads-analytics.service";

@Injectable()
export class ThreadsAnalyticsRefreshService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ThreadsAnalyticsRefreshService.name);
  private startupTimer?: NodeJS.Timeout;
  private interval?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly analytics: ThreadsAnalyticsService) {}

  onModuleInit(): void {
    this.startupTimer = setTimeout(() => void this.refresh(), 12_000);
    this.interval = setInterval(() => void this.refresh(), 15 * 60 * 1_000);
  }

  onApplicationShutdown(): void {
    clearTimeout(this.startupTimer);
    clearInterval(this.interval);
  }

  async refresh(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.analytics.dashboard();
      if (!result.available) this.logger.warn("Threads analytics is not available");
    } finally {
      this.running = false;
    }
  }
}
