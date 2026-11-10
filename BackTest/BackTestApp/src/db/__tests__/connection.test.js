import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { buildMongoUri, connectDB, MONGO_DB } from "../connection.js";

test("BackTestApp MongoDB Connection & Retry Logic", async (t) => {
  await t.test("buildMongoUri correctly parses and constructs replica set URI", () => {
    const originalUri = process.env.MONGO_URI;
    try {
      process.env.MONGO_URI = "mongodb://root:example@mongo1:27017,mongo2:27017,mongo3:27017/?replicaSet=rs0&authSource=admin";
      const uri = buildMongoUri();
      assert.match(uri, /\/BacktestApp\?replicaSet=rs0&authSource=admin$/);
      assert.ok(uri.startsWith("mongodb://root:example@mongo1:27017,mongo2:27017,mongo3:27017/"));
    } finally {
      process.env.MONGO_URI = originalUri;
    }
  });

  await t.test("buildMongoUri handles URI without query parameters", () => {
    const originalUri = process.env.MONGO_URI;
    try {
      process.env.MONGO_URI = "mongodb://root:example@mongo1:27017/";
      const uri = buildMongoUri();
      assert.strictEqual(uri, `mongodb://root:example@mongo1:27017/${MONGO_DB}`);
    } finally {
      process.env.MONGO_URI = originalUri;
    }
  });

  await t.test("buildMongoUri handles undefined MONGO_URI fallback", () => {
    const originalUri = process.env.MONGO_URI;
    try {
      delete process.env.MONGO_URI;
      const uri = buildMongoUri();
      assert.strictEqual(uri, `mongodb://localhost:27017/${MONGO_DB}`);
    } finally {
      process.env.MONGO_URI = originalUri;
    }
  });

  await t.test("connectDB retries on connection failures and throws after retries exhausted", async () => {
    const originalConnect = mongoose.connect;
    let attempts = 0;
    try {
      mongoose.connect = async () => {
        attempts++;
        throw new Error("Connection refused (simulated replica set failover)");
      };

      await assert.rejects(
        async () => {
          await connectDB({ retries: 3, delayMs: 10, exitOnError: false });
        },
        /Connection refused \(simulated replica set failover\)/
      );
      assert.strictEqual(attempts, 3);
    } finally {
      mongoose.connect = originalConnect;
    }
  });

  await t.test("connectDB succeeds after intermittent failures", async () => {
    const originalConnect = mongoose.connect;
    let attempts = 0;
    try {
      mongoose.connect = async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error("Temporary network glitch");
        }
        return mongoose.connection;
      };

      const conn = await connectDB({ retries: 3, delayMs: 10, exitOnError: false });
      assert.strictEqual(attempts, 2);
      assert.strictEqual(conn, mongoose.connection);
    } finally {
      mongoose.connect = originalConnect;
    }
  });
});
