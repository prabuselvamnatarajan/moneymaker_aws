import test from "node:test";
import assert from "node:assert/strict";
import { getContainers, getContainerLogs } from "../docker.js";

// Helper to build mock Express req/res
function createMockReqRes(options = {}) {
  const req = {
    params: options.params || {},
    query: options.query || {},
    body: options.body || {},
    headers: options.headers || {},
    user: options.user || null,
  };

  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };

  return { req, res };
}

test("dockerController unit & security edge cases", async (t) => {

  await t.test("Security: getContainerLogs should reject command injection attempts", async () => {
    const maliciousInputs = [
      "1; rm -rf /",
      "container; cat /etc/passwd",
      "container$(id)",
      "container`whoami`",
      "container|ls -la",
      "container & echo hacked",
      "../../etc/passwd",
    ];

    for (const badId of maliciousInputs) {
      const { req, res } = createMockReqRes({ params: { containerId: badId } });
      let nextError = null;

      await getContainerLogs(req, res, (err) => { nextError = err; });

      assert.equal(res.statusCode, 400, `Should return 400 for input: ${badId}`);
      assert.ok(
        res.body?.message?.includes("Invalid or missing Container ID"),
        `Response message should indicate invalid parameter for: ${badId}`
      );
    }
  });

  await t.test("Security: getContainerLogs rejects empty or missing containerId", async () => {
    const { req, res } = createMockReqRes({ params: {} });
    await getContainerLogs(req, res, () => {});

    assert.equal(res.statusCode, 400);
    assert.ok(res.body?.message?.includes("Invalid or missing Container ID"));
  });

  await t.test("Edge Case: getContainerLogs handles non-existent container gracefully", async () => {
    const { req, res } = createMockReqRes({ 
      params: { containerId: "nonexistent_container_xyz_999" },
      query: { tail: "50", timestamps: "true" } 
    });

    let nextError = null;
    await getContainerLogs(req, res, (err) => { nextError = err; });

    // Returns either 404 Not Found or 500 Docker Unavailable depending on Docker host presence
    assert.ok([404, 500].includes(res.statusCode) || nextError);
  });

  await t.test("Edge Case: getContainers responds with items array or graceful failure", async () => {
    const { req, res } = createMockReqRes({ query: { scope: "app", all: "false" } });
    let nextError = null;

    await getContainers(req, res, (err) => { nextError = err; });

    if (res.statusCode === 200 && res.body) {
      assert.ok(Array.isArray(res.body.items));
    } else {
      // Graceful Docker CLI unavailable or socket error
      assert.ok(res.statusCode === 500 || nextError != null);
      if (res.body) {
        assert.ok(res.body?.message?.includes("Docker") || res.body?.error?.includes("Docker"));
      }
    }
  });

  await t.test("Edge Case: getContainers with scope=all parameter", async () => {
    const { req, res } = createMockReqRes({ query: { scope: "all", all: "true" } });
    let nextError = null;

    await getContainers(req, res, (err) => { nextError = err; });

    if (res.statusCode === 200 && res.body) {
      assert.ok(Array.isArray(res.body.items));
    } else {
      assert.ok(res.statusCode === 500 || nextError != null);
    }
  });
});
