import { Global, Inject, Injectable, Logger, Module, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool } from "pg";
import { DRAFT_REPOSITORY } from "../../domain/drafts/draft.repository";
import { PUBLICATION_REPOSITORY } from "../../domain/publication/publication.repository";
import { DATABASE_POOL } from "./database.tokens";
import { PostgresDraftRepository } from "./postgres-draft.repository";
import { PostgresPublicationRepository } from "./postgres-publication.repository";
import {
  PostgresTelegramUpdateStore,
  TELEGRAM_UPDATE_STORE
} from "./telegram-update.store";

@Injectable()
class DatabaseShutdown implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const pool = new Pool({
          connectionString: config.getOrThrow<string>("DATABASE_URL"),
          max: 10,
          connectionTimeoutMillis: 5_000,
          idleTimeoutMillis: 30_000,
          query_timeout: 15_000,
          statement_timeout: 15_000,
          application_name: "personal-brand-threads"
        });
        pool.on("error", () => new Logger("DatabasePool").error("Idle database connection failed"));
        return pool;
      }
    },
    PostgresDraftRepository,
    PostgresPublicationRepository,
    PostgresTelegramUpdateStore,
    DatabaseShutdown,
    { provide: DRAFT_REPOSITORY, useExisting: PostgresDraftRepository },
    { provide: PUBLICATION_REPOSITORY, useExisting: PostgresPublicationRepository },
    { provide: TELEGRAM_UPDATE_STORE, useExisting: PostgresTelegramUpdateStore }
  ],
  exports: [
    DATABASE_POOL,
    DRAFT_REPOSITORY,
    PUBLICATION_REPOSITORY,
    TELEGRAM_UPDATE_STORE
  ]
})
export class DatabaseModule {}
