import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCompletionFlag, completionKey } from "../../utils/backtestCompletionUtil.js";

describe("parseCompletionFlag", () => {
  it("parses JSON run_id payload", () => {
    const flag = parseCompletionFlag(JSON.stringify({ completed: true, run_id: "123" }));
    assert.equal(flag.completed, true);
    assert.equal(flag.run_id, "123");
    assert.equal(flag.legacy, false);
  });

  it("treats legacy true as unmatched run_id", () => {
    const flag = parseCompletionFlag("true");
    assert.equal(flag.completed, true);
    assert.equal(flag.run_id, null);
    assert.equal(flag.legacy, true);
  });

  it("returns null for empty/invalid", () => {
    assert.equal(parseCompletionFlag(null), null);
    assert.equal(parseCompletionFlag("nope"), null);
  });

  it("parses the final tick mark from the done signal", () => {
    const flag = parseCompletionFlag(
      JSON.stringify({ completed: true, run_id: "123", last_ltp: 152.75, last_tick_at: 1710000000000 })
    );
    assert.equal(flag.last_ltp, 152.75);
    assert.equal(flag.last_tick_at, 1710000000000);
  });

  it("nulls out non-positive or missing final tick values", () => {
    const missing = parseCompletionFlag(JSON.stringify({ completed: true, run_id: "123" }));
    assert.equal(missing.last_ltp, null);
    assert.equal(missing.last_tick_at, null);

    const zeroed = parseCompletionFlag(
      JSON.stringify({ completed: true, run_id: "123", last_ltp: 0, last_tick_at: -1 })
    );
    assert.equal(zeroed.last_ltp, null);
    assert.equal(zeroed.last_tick_at, null);

    const legacy = parseCompletionFlag("true");
    assert.equal(legacy.last_ltp, null);
    assert.equal(legacy.last_tick_at, null);
  });
});

describe("completionKey", () => {
  it("builds redis key", () => {
    assert.equal(completionKey("abc"), "backtest_completed:abc");
  });
});
