import { createRedisConnection } from "@dev-das-promos/queue";
import { buildApp } from "./app.js";
import { env } from "./env.js";
import { startClickEventRetention } from "./lib/click-event-retention.js";
import {
  registerScheduledJobs,
  removeScheduledJobs,
  scheduleConfigFromEnv,
} from "./lib/scheduler.js";
import { startWorkers } from "./workers/index.js";

async function main() {
  const app = await buildApp();

  // Workers run inside this same process for the MVP -- see
  // docs/architecture.md "Why a monolith" for why that's the right call
  // at this stage rather than standing up separate worker deployments.
  const workerConnection = createRedisConnection(env.REDIS_URL);
  const workerRuntime = startWorkers(app.db, app.queues, workerConnection);
  const stopClickEventRetention = startClickEventRetention(
    app.db,
    env.CLICK_EVENT_RETENTION_DAYS,
    (message, error) => (error ? app.log.error(error, message) : app.log.info(message)),
  );

  app.addHook("onClose", async () => {
    stopClickEventRetention();
    await workerRuntime.close();
    workerConnection.disconnect();
  });

  if (env.SCHEDULE_ENABLED) {
    await registerScheduledJobs(app.queues, scheduleConfigFromEnv(env));
  } else {
    await removeScheduledJobs(app.queues);
  }

  try {
    await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
    app.log.info(`API listening on http://localhost:${env.API_PORT}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      await app.close();
      process.exit(0);
    });
  }
}

main().catch((error) => {
  console.error("Fatal error starting API:", error);
  process.exit(1);
});
