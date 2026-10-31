/**
 * Polls Redis for backtest_completed:{deploymentId} flags set by strategy
 * consumers when the streamer emits {done: true}, then stops the deployment
 * (which force-closes any still-open positions).
 *
 * Flag value is JSON: { run_id, completed: true, last_ltp, last_tick_at }. Only
 * stop when run_id matches the deployment's current backtest_run_id so a stale
 * prior-run flag cannot truncate a new backtest. last_ltp is the final replayed
 * tick and becomes the force-close mark.
 */

import { createClient } from "redis";
import Deployment from "../models/deployment.js";
import { transitionDeployment } from "./deployment.js";
import { completionKey, parseCompletionFlag } from "../utils/backtestCompletionUtil.js";

export { completionKey, parseCompletionFlag };

const POLL_INTERVAL_MS = Number(process.env.BACKTEST_COMPLETION_POLL_MS || 2000);
const REDIS_URL = process.env.REDIS_URL;

let timer = null;
let running = false;

async function withRedis(fn) {
  if (!REDIS_URL) return null;
  let client;
  try {
    client = createClient({ url: REDIS_URL });
    // Without this listener a post-connect socket failure is an uncaught
    // exception, and this runs on a forever-loop for the process lifetime.
    client.on("error", (err) => console.error(`[BacktestCompletion] redis error: ${err.message}`));
    await client.connect();
    return await fn(client);
  } finally {
    if (client) {
      await client.disconnect().catch(() => {});
    }
  }
}

async function pollOnce() {
  if (running) return;
  running = true;
  try {
    // ⚡ Bolt Optimization: Added .lean() to high-frequency polling query
    const deployments = await Deployment.find({
      strategy_mode: "BACKTEST",
      current_status: "RUNNING",
    }).select("_id user_id backtest_run_id").lean();

    if (deployments.length === 0) return;

    await withRedis(async (client) => {
      for (const dep of deployments) {
        const id = dep._id.toString();
        const key = completionKey(id);
        try {
          const raw = await client.get(key);
          const flag = parseCompletionFlag(raw);
          if (!flag?.completed) continue;

          const currentRunId = dep.backtest_run_id != null ? String(dep.backtest_run_id) : null;
          // Legacy bare "true" or missing/mismatched run_id must not stop a live run.
          if (!flag.run_id || !currentRunId || flag.run_id !== currentRunId) {
            console.warn(
              `[BacktestCompletion] Ignoring stale/mismatched flag for ${id} ` +
                `(flag run_id=${flag.run_id}, deployment run_id=${currentRunId}, legacy=${!!flag.legacy})`
            );
            await client.del(key).catch(() => {});
            continue;
          }

          console.log(
            `[BacktestCompletion] Flag matched run_id ${currentRunId} for ${id}; ` +
              `stopping (final tick ltp=${flag.last_ltp})`
          );
          await transitionDeployment(dep.user_id, id, "stop", {
            finalTick: { lastLtp: flag.last_ltp, lastTickAt: flag.last_tick_at },
          });
          await client.del(key).catch(() => {});
          console.log(`[BacktestCompletion] Stopped deployment ${id}`);
        } catch (err) {
          console.error(`[BacktestCompletion] Failed for ${id}: ${err.message}`);
        }
      }
    });
  } catch (err) {
    console.error(`[BacktestCompletion] Poll failed: ${err.message}`);
  } finally {
    running = false;
  }
}

export function startBacktestCompletionWatcher() {
  if (!REDIS_URL) {
    console.warn("[BacktestCompletion] REDIS_URL not set; watcher disabled");
    return;
  }
  if (timer) return;
  timer = setInterval(pollOnce, POLL_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
  console.log(`[BacktestCompletion] Watcher started (interval ${POLL_INTERVAL_MS}ms)`);
  setTimeout(pollOnce, 1000).unref?.();
}

export function stopBacktestCompletionWatcher() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
