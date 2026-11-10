import test from "node:test";
import assert from "node:assert/strict";
import app, { setAppReady, getAppReady } from "../../app.js";

test("BackTestApp /health & Readiness Initialization Guard Integration Tests", async (t) => {
  let server;
  let baseUrl;

  t.before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  t.after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await t.test("setAppReady and getAppReady manage initialization state", () => {
    setAppReady(false);
    assert.strictEqual(getAppReady(), false);
    setAppReady(true);
    assert.strictEqual(getAppReady(), true);
  });

  await t.test("GET /health returns 200 initializing while dependencies are initializing", async () => {
    setAppReady(false);
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, "initializing");
    assert.strictEqual(body.ready, false);
    assert.ok(body.timestamp);
  });

  await t.test("GET /health/ready returns 503 while dependencies are initializing", async () => {
    setAppReady(false);
    const res = await fetch(`${baseUrl}/health/ready`);
    assert.strictEqual(res.status, 503);
    const body = await res.json();
    assert.strictEqual(body.status, "initializing");
    assert.strictEqual(body.ready, false);
    assert.ok(body.timestamp);
  });

  await t.test("Non-health API route returns 503 with helpful payload while initializing", async () => {
    setAppReady(false);
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "pwd" }),
    });
    assert.strictEqual(res.status, 503);
    const body = await res.json();
    assert.strictEqual(body.status, "initializing");
    assert.match(body.message, /initializing dependencies/i);
  });

  await t.test("GET /health returns 200 ok once app is marked ready", async () => {
    setAppReady(true);
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, "ok");
    assert.strictEqual(body.ready, true);
    assert.ok(body.timestamp);
  });

  await t.test("GET /health/ready returns 200 ok once app is marked ready", async () => {
    setAppReady(true);
    const res = await fetch(`${baseUrl}/health/ready`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, "ok");
    assert.strictEqual(body.ready, true);
    assert.ok(body.timestamp);
  });
});
