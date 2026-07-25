export function completionKey(deploymentId) {
  return `backtest_completed:${deploymentId}`;
}

/** Parse flag; supports legacy "true"/"1" (treated as unmatched without run_id). */
export function parseCompletionFlag(raw) {
  if (raw == null) return null;
  if (raw === "true" || raw === "1") {
    return { completed: true, run_id: null, legacy: true };
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.completed) {
      return {
        completed: true,
        run_id: parsed.run_id != null ? String(parsed.run_id) : null,
        legacy: false,
      };
    }
  } catch {
    // ignore
  }
  return null;
}
