import { Queue } from "bullmq";
import { getRedis } from "./redis";
export const siengeQueue = new Queue("sienge-events", { connection: getRedis() });
export const whatsappQueue = new Queue("whatsapp-outbound", { connection: getRedis() });
