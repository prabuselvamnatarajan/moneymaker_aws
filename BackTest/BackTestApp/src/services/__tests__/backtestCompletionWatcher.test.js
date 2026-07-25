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
});

describe("completionKey", () => {
  it("builds redis key", () => {
    assert.equal(completionKey("abc"), "backtest_completed:abc");
  });
});
