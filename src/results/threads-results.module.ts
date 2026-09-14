import { Global, Module } from "@nestjs/common";
import { ThreadsResultsService } from "./threads-results.service";

@Global()
@Module({
  providers: [ThreadsResultsService],
  exports: [ThreadsResultsService]
})
export class ThreadsResultsModule {}
