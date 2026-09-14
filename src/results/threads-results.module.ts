import { Global, Module } from "@nestjs/common";
import { ThreadsResultsService } from "./threads-results.service";
import { ThreadsAnalyticsService } from "./threads-analytics.service";

@Global()
@Module({
  providers: [ThreadsResultsService, ThreadsAnalyticsService],
  exports: [ThreadsResultsService]
})
export class ThreadsResultsModule {}
