import IORedis from "ioredis";
import { env } from "./env";
let redis: IORedis | null = null;
export function getRedis() {
  if (!redis) redis = new IORedis(env().REDIS_URL, { maxRetriesPerRequest: null });
  return redis;
}
