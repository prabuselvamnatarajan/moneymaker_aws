import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseQueryParams, getProjectionFields } from "../queryHelper.js";

describe("BackTestApp queryHelper - parseQueryParams & Projection", () => {

  it("applies default pagination values (page=1, limit=20, skip=0)", () => {
    const { page, limit, skip } = parseQueryParams({});
    assert.equal(page, 1);
    assert.equal(limit, 20);
    assert.equal(skip, 0);
  });

  it("calculates skip based on page and limit", () => {
    const { page, limit, skip } = parseQueryParams({ page: 3, limit: 15 });
    assert.equal(page, 3);
    assert.equal(limit, 15);
    assert.equal(skip, 30);
  });

  it("caps limit at 100 to prevent DOS via oversized queries", () => {
    const { limit } = parseQueryParams({ limit: 500 });
    assert.equal(limit, 100);
  });

  it("handles negative or invalid page and limit values safely", () => {
    const { page, limit, skip } = parseQueryParams({ page: -5, limit: -10 });
    assert.equal(page, 1);
    assert.equal(limit, 1);
    assert.equal(skip, 0);
  });

  it("parses single and multi-field sort criteria", () => {
    const { sort: singleSort } = parseQueryParams({ sort: "price:asc" });
    assert.deepEqual(singleSort, { price: 1 });

    const { sort: multiSort } = parseQueryParams({ sort: "symbol:asc,created_at:desc" });
    assert.deepEqual(multiSort, { symbol: 1, created_at: -1 });
  });

  it("normalizes timestamp and execution_time sort fields to created_at", () => {
    const { sort: timeSort } = parseQueryParams({ sort: "timestamp:desc" });
    assert.deepEqual(timeSort, { created_at: -1 });

    const { sort: execSort } = parseQueryParams({ sort: "execution_time:asc" });
    assert.deepEqual(execSort, { created_at: 1 });
  });

  it("applies date range filters with $gte and $lte", () => {
    const from = "2024-01-01T00:00:00.000Z";
    const to = "2024-01-31T23:59:59.999Z";
    const { filter } = parseQueryParams({ from, to }, { dateField: "created_at" });

    assert.ok(filter.created_at);
    assert.equal(filter.created_at.$gte.toISOString(), from);
    assert.equal(filter.created_at.$lte.toISOString(), to);
  });

  it("escapes regex special characters in search query to prevent ReDoS attacks", () => {
    const dangerousSearch = ".*+?^${}()|[]\\test";
    const { filter } = parseQueryParams({ search: dangerousSearch }, { searchFields: ["name", "symbol"] });

    assert.ok(Array.isArray(filter.$or));
    assert.equal(filter.$or.length, 2);

    // Verify regex matches literal string without throwing or backtracking
    const regex = filter.$or[0].name;
    assert.ok(regex instanceof RegExp);
    assert.ok(regex.test("exact_.*+?^${}()|[]\\test_match"));
    assert.equal(regex.test("other_text"), false);
  });

  it("maps UI projection fields to database fields correctly", () => {
    const projection = getProjectionFields("timestamp,symbol,price,tradeId");
    assert.ok(projection.includes("created_at"));
    assert.ok(projection.includes("created_on"));
    assert.ok(projection.includes("symbol"));
    assert.ok(projection.includes("price"));
    assert.ok(projection.includes("trade_id"));
  });

  it("returns undefined projection when fieldsParam is not provided", () => {
    assert.equal(getProjectionFields(null), undefined);
    assert.equal(getProjectionFields(""), undefined);
  });
});
