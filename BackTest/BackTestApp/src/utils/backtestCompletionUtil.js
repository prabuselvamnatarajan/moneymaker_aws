export function completionKey(deploymentId) {
  return `backtest_completed:${deploymentId}`;
}

function positiveNumberOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/** Parse flag; supports legacy "true"/"1" (treated as unmatched without run_id). */
export function parseCompletionFlag(raw) {
  if (raw == null) return null;
  if (raw === "true" || raw === "1") {
    return { completed: true, run_id: null, legacy: true, last_ltp: null, last_tick_at: null };
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.completed) {
      return {
        completed: true,
        run_id: parsed.run_id != null ? String(parsed.run_id) : null,
        legacy: false,
        last_ltp: positiveNumberOrNull(parsed.last_ltp),
        last_tick_at: positiveNumberOrNull(parsed.last_tick_at),
      };
    }
  } catch {
    // ignore
  }
  return null;
}
