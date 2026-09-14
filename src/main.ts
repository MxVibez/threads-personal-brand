import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { ConfigService } from "@nestjs/config";
import fastifyRateLimit from "@fastify/rate-limit";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      bodyLimit: 256_000,
      trustProxy: true
    })
  );
  app.enableShutdownHooks();
  app.setGlobalPrefix("api");

  await app.register(fastifyRateLimit, {
    global: true,
    max: 180,
    timeWindow: "1 minute",
    allowList: (request) => request.url.startsWith("/api/health"),
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: "Слишком много запросов. Попробуйте через минуту."
    })
  });

  const config = app.get(ConfigService);
  const port = config.getOrThrow<number>("PORT");
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
