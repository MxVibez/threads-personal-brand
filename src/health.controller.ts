import { Controller, Get, Inject } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "./infrastructure/database/database.tokens";

@Controller("health")
export class HealthController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get()
  live(): { status: "ok"; timestamp: string } {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  @Get("ready")
  async ready(): Promise<{ status: "ready"; timestamp: string }> {
    await this.pool.query("SELECT 1");
    return { status: "ready", timestamp: new Date().toISOString() };
  }
}
