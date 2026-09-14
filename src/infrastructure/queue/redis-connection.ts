import type { ConnectionOptions } from "bullmq";

export function redisConnectionFromUrl(value: string): ConnectionOptions {
  const url = new URL(value);
  const database = url.pathname === "/" ? 0 : Number(url.pathname.slice(1));

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number.isInteger(database) ? database : 0,
    ...(url.protocol === "rediss:" ? { tls: {} } : {})
  };
}
