import { scheduleCollectionRun } from "../lib/collection/scheduler";
import { db } from "../lib/db";
try {
  console.log(await scheduleCollectionRun(new Date()));
} finally {
  await db.$disconnect();
}
