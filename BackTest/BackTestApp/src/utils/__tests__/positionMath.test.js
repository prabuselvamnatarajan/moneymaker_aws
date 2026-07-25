import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  sumOpenUnrealised,
  calcUnrealizedPnl,
  resolveCloseExecutionTime,
} from "../positionMath.js";

describe("sumOpenUnrealised", () => {
  it("sums open-quantity marks across OPEN positions", () => {
    assert.equal(
      sumOpenUnrealised([
        { status: "OPEN", unrealised_pnl: 15 },
        { status: "OPEN", unrealised_pnl: -4.5 },
      ]),
      10.5
    );
  });

  it("ignores CLOSED positions however stale their mark", () => {
    assert.equal(
      sumOpenUnrealised([
        { status: "CLOSED", unrealised_pnl: 999 },
        { status: "OPEN", unrealised_pnl: 15 },
      ]),
      15
    );
  });

  it("returns 0 for no positions", () => {
    assert.equal(sumOpenUnrealised([]), 0);
    assert.equal(sumOpenUnrealised(), 0);
  });
});

describe("calcUnrealizedPnl open qty", () => {
  it("scales with open_size only", () => {
    assert.equal(calcUnrealizedPnl(100, "LONG", 10, 105), 50);
    assert.equal(calcUnrealizedPnl(100, "LONG", 5, 105), 25);
  });
});

describe("resolveCloseExecutionTime", () => {
  const opened = new Date("2026-07-17T04:00:00.000Z");

  it("uses the last tick when it is after the open", () => {
    const tick = new Date("2026-07-17T09:45:00.000Z");
    assert.equal(resolveCloseExecutionTime(opened, tick).getTime(), tick.getTime());
  });

  it("stays strictly after the open when the tick is stale or missing", () => {
    assert.equal(resolveCloseExecutionTime(opened, opened).getTime(), opened.getTime() + 1);
    assert.equal(resolveCloseExecutionTime(opened, null).getTime(), opened.getTime() + 1);
    assert.equal(
      resolveCloseExecutionTime(opened, new Date("2026-07-17T03:00:00.000Z")).getTime(),
      opened.getTime() + 1
    );
  });

  it("returns a valid date for unusable inputs", () => {
    assert.ok(Number.isFinite(resolveCloseExecutionTime("not-a-date", "nope").getTime()));
    assert.ok(Number.isFinite(resolveCloseExecutionTime(null, null).getTime()));
  });
});
