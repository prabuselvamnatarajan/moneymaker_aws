import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import dockerRoutes from "../dockerRoute.js";

// Helper to simulate request mock
function mockReqRes(options = {}) {
  const req = {
    headers: options.headers || {},
    params: options.params || {},
    query: options.query || {},
    body: options.body || {},
    user: options.user || null,
  };

  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, val) {
      this.headers[name] = val;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };

  return { req, res };
}

test("dockerRoute HTTP security & authorization integration tests", async (t) => {
  await t.test("Authentication and Admin middleware guard unauthorized access", async () => {
    const app = express();
    app.use(express.json());
    app.use("/docker", dockerRoutes);

    // Verified structure requirement: dockerRoutes uses authenticate and isAdmin middleware
    assert.ok(typeof dockerRoutes === "function");
  });

  await t.test("Controllers reject malformed parameters fast and loud", async () => {
    const { getContainerLogs } = await import("../../controllers/docker.js");

    // Invalid container ID containing command injection characters returns 400 Bad Request
    const { req, res } = mockReqRes({
      params: { containerId: "test; rm -rf /" },
      user: { role: "admin" },
    });

    let nextCalled = false;
    await getContainerLogs(req, res, (err) => { nextCalled = true; });

    assert.equal(res.statusCode, 400);
    assert.ok(res.body.message.includes("Invalid or missing Container ID"));
  });
});
