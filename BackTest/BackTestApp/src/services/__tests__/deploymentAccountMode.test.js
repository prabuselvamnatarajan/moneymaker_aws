import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import "../../models/account.js";
import "../../models/broker.js";
import "../../models/deployment.js";
import "../../models/strategy.js";
import "../../models/userSymbol.js";
import "../../models/position.js";
import "../../models/trade.js";
import "../../models/ledger.js";

import {
  ACCOUNT_TYPE_FOR_MODE,
  assertAccountMatchesMode,
  isAccountTypeAllowedForMode,
  isManualDeployment,
  modeForAccountType,
  usesDeploymentScopedBalance,
} from "../../utils/deploymentMode.js";
import { createDeployment, updateDeployment, filterRoutableDeployments } from "../deployment.js";
import { createAccount, updateAccount } from "../account.js";
import { ensureManualDeploymentForAccount } from "../../utils/accountInitializer.js";

const Account = mongoose.model("Account");
const Broker = mongoose.model("Broker");
const Deployment = mongoose.model("Deployment");
const Strategy = mongoose.model("Strategy");
const UserSymbol = mongoose.model("UserSymbol");

// Restore every stub after each test.
const restores = [];
function stub(target, key, value) {
  const original = target[key];
  target[key] = value;
  restores.push(() => { target[key] = original; });
}
afterEach(() => { while (restores.length) restores.pop()(); });

const userId = new mongoose.Types.ObjectId();
const accountOf = (account_type, broker = { is_internal: account_type !== "LIVE" }) => ({
  _id: new mongoose.Types.ObjectId(),
  user_id: userId,
  account_type,
  broker_id: broker,
});

describe("deploymentMode rule", () => {
  it("TC-DMODE-001: maps LIVE/PAPER/BACKTEST to LIVE/PAPER/SIMULATION and back", () => {
    assert.deepEqual({ ...ACCOUNT_TYPE_FOR_MODE }, { LIVE: "LIVE", PAPER: "PAPER", BACKTEST: "SIMULATION" });
    assert.equal(modeForAccountType("LIVE"), "LIVE");
    assert.equal(modeForAccountType("PAPER"), "PAPER");
    assert.equal(modeForAccountType("SIMULATION"), "BACKTEST");
    assert.throws(() => modeForAccountType("DEMO"), (err) => err.statusCode === 400);
  });

  it("TC-DMODE-002: allows only the three matching pairs", () => {
    const modes = ["LIVE", "PAPER", "BACKTEST"];
    const types = ["LIVE", "PAPER", "SIMULATION"];
    for (const mode of modes) {
      for (const type of types) {
        assert.equal(isAccountTypeAllowedForMode(mode, type), ACCOUNT_TYPE_FOR_MODE[mode] === type, `${mode}/${type}`);
      }
    }
    assert.equal(isAccountTypeAllowedForMode(undefined, "LIVE"), false);
    assert.equal(isAccountTypeAllowedForMode("LIVE", undefined), false);
  });

  it("TC-DMODE-003: assertAccountMatchesMode explains the mismatch with a 400", () => {
    assert.throws(
      () => assertAccountMatchesMode("PAPER", { account_type: "LIVE" }),
      (err) => err.statusCode === 400 && /PAPER deployment needs a PAPER account/.test(err.message)
    );
    assert.throws(() => assertAccountMatchesMode("FOO", { account_type: "LIVE" }), (err) => err.statusCode === 400);
    assert.throws(() => assertAccountMatchesMode("LIVE", null), (err) => err.statusCode === 400);
    assert.doesNotThrow(() => assertAccountMatchesMode("BACKTEST", { account_type: "SIMULATION" }));
  });

  it("TC-DMODE-004: a LIVE deployment on an internal-broker account is refused", () => {
    assert.throws(
      () => assertAccountMatchesMode("LIVE", { account_type: "LIVE" }, { is_internal: true }),
      /external broker/
    );
    assert.doesNotThrow(() => assertAccountMatchesMode("LIVE", { account_type: "LIVE" }, { is_internal: false }));
  });

  it("TC-DMODE-005: Manual deployments use the account-level balance key even in BACKTEST mode", () => {
    assert.equal(isManualDeployment({ deployment_name: "Manual" }), true);
    assert.equal(isManualDeployment({ deployment_name: "Breakout" }), false);
    assert.equal(usesDeploymentScopedBalance({ strategy_mode: "BACKTEST", deployment_name: "Breakout" }), true);
    assert.equal(usesDeploymentScopedBalance({ strategy_mode: "BACKTEST", deployment_name: "Manual" }), false);
    assert.equal(usesDeploymentScopedBalance({ strategy_mode: "PAPER", deployment_name: "Breakout" }), false);
    assert.equal(usesDeploymentScopedBalance({ strategy_mode: "LIVE", deployment_name: "Breakout" }), false);
    assert.equal(usesDeploymentScopedBalance(null), false);
  });
});

describe("createDeployment / updateDeployment enforce the rule", () => {
  function stubLookups(account) {
    stub(Strategy, "findOne", async () => ({ _id: new mongoose.Types.ObjectId() }));
    stub(Account, "findOne", () => ({ populate: async () => account }));
    // Reached only after the account check passes.
    stub(UserSymbol, "findOne", async () => null);
    stub(Deployment.prototype, "save", async () => { throw new Error("save must not be reached"); });
  }

  const base = () => ({
    strategy_id: new mongoose.Types.ObjectId(),
    account_id: new mongoose.Types.ObjectId(),
    user_symbol_id: new mongoose.Types.ObjectId(),
    deployment_name: "Breakout",
  });

  const cases = [
    ["LIVE", "PAPER"], ["LIVE", "SIMULATION"],
    ["PAPER", "LIVE"], ["PAPER", "SIMULATION"],
    ["BACKTEST", "LIVE"], ["BACKTEST", "PAPER"],
  ];
  for (const [mode, type] of cases) {
    it(`TC-DMODE-006: rejects a ${mode} deployment on a ${type} account with 400`, async () => {
      stubLookups(accountOf(type));
      await assert.rejects(
        createDeployment(userId, { ...base(), strategy_mode: mode }),
        (err) => err.statusCode === 400 && new RegExp(`needs a ${ACCOUNT_TYPE_FOR_MODE[mode]} account`).test(err.message)
      );
    });
  }

  for (const [mode, type] of [["LIVE", "LIVE"], ["PAPER", "PAPER"], ["BACKTEST", "SIMULATION"]]) {
    it(`TC-DMODE-007: accepts a ${mode} deployment on a ${type} account (continues to symbol checks)`, async () => {
      stubLookups(accountOf(type));
      await assert.rejects(createDeployment(userId, { ...base(), strategy_mode: mode }), /Associated symbol not found/);
    });
  }

  it("TC-DMODE-008: rejects a LIVE deployment whose LIVE account sits on the internal broker", async () => {
    stubLookups(accountOf("LIVE", { is_internal: true }));
    await assert.rejects(createDeployment(userId, { ...base(), strategy_mode: "LIVE" }), /external broker/);
  });

  it("TC-DMODE-009: rejects a missing account and an unknown mode", async () => {
    stubLookups(accountOf("PAPER"));
    const { account_id, ...noAccount } = base();
    await assert.rejects(createDeployment(userId, { ...noAccount, strategy_mode: "PAPER" }), /account_id is required/);
    await assert.rejects(createDeployment(userId, { ...base(), strategy_mode: "SIM" }), (err) => err.statusCode === 400);
  });

  it("TC-DMODE-010: the Manual deployment name is reserved on create and update", async () => {
    stubLookups(accountOf("PAPER"));
    await assert.rejects(
      createDeployment(userId, { ...base(), strategy_mode: "PAPER", deployment_name: " manual " }),
      (err) => err.statusCode === 400 && /reserved/.test(err.message)
    );
    await assert.rejects(
      updateDeployment(userId, new mongoose.Types.ObjectId().toString(), { deployment_name: "Manual" }),
      (err) => err.statusCode === 400 && /reserved/.test(err.message)
    );
  });
});

describe("filterRoutableDeployments (Redis routing safety net)", () => {
  it("TC-DMODE-011: drops mismatched deployments so they never receive ticks", () => {
    const dep = (strategy_mode, account_type) => ({
      _id: `${strategy_mode}-${account_type}`,
      strategy_id: {},
      strategy_mode,
      account_id: { _id: "a", account_type },
    });
    const origError = console.error;
    const logged = [];
    console.error = (...a) => logged.push(a.join(" "));
    try {
      const kept = filterRoutableDeployments([
        dep("LIVE", "LIVE"), dep("PAPER", "PAPER"), dep("BACKTEST", "SIMULATION"),
        dep("PAPER", "LIVE"), dep("LIVE", "PAPER"), dep("BACKTEST", "PAPER"),
        { _id: "no-account", strategy_id: {}, strategy_mode: "PAPER" },
      ]);
      assert.deepEqual(kept.map((d) => d._id), ["LIVE-LIVE", "PAPER-PAPER", "BACKTEST-SIMULATION"]);
      assert.equal(logged.filter((l) => l.includes("Skipping deployment")).length, 3);
    } finally {
      console.error = origError;
    }
  });
});

describe("account type rules", () => {
  it("TC-ACCT-101: account_type is immutable on the model", () => {
    assert.equal(Account.schema.path("account_type").options.immutable, true);
    const doc = new Account({ user_id: userId, account_name: "p", account_type: "PAPER", initial_balance: 1 });
    doc.$isNew = false;
    doc.account_type = "LIVE";
    assert.equal(doc.account_type, "PAPER");
  });

  it("TC-ACCT-102: updateAccount refuses an account_type change for users and admins", async () => {
    stub(Account, "findOneAndUpdate", () => { throw new Error("update must not be reached"); });
    for (const isAdmin of [false, true]) {
      await assert.rejects(
        updateAccount(userId, "acc1", { account_type: "LIVE" }, isAdmin),
        (err) => err.statusCode === 400 && /cannot be changed/.test(err.message)
      );
    }
  });

  it("TC-ACCT-103: createAccount refuses a LIVE account with no broker or the internal broker", async () => {
    stub(Account.prototype, "save", async () => { throw new Error("save must not be reached"); });
    await assert.rejects(createAccount(userId, { account_name: "l", account_type: "LIVE", initial_balance: 1 }), /external broker/);
    stub(Broker, "findById", async (id) => ({ _id: id, is_internal: true }));
    await assert.rejects(
      createAccount(userId, { account_name: "l", account_type: "LIVE", initial_balance: 1, broker_id: new mongoose.Types.ObjectId() }),
      (err) => err.statusCode === 400 && /external broker/.test(err.message)
    );
  });

  it("TC-ACCT-104: createAccount accepts a LIVE account on an external broker", async () => {
    stub(Broker, "findById", async (id) => ({ _id: id, is_internal: false }));
    let saved;
    stub(Account.prototype, "save", async function () { saved = this; return this; });
    await createAccount(userId, { account_name: "l", account_type: "LIVE", initial_balance: 1, broker_id: new mongoose.Types.ObjectId() });
    assert.equal(saved.account_type, "LIVE");
  });

  it("TC-ACCT-105: updateAccount refuses moving a LIVE account onto the internal broker", async () => {
    stub(Account, "findOne", async () => ({ _id: "acc1", account_type: "LIVE" }));
    stub(Broker, "findById", async (id) => ({ _id: id, is_internal: true }));
    stub(Account, "findOneAndUpdate", () => { throw new Error("update must not be reached"); });
    await assert.rejects(
      updateAccount(userId, "acc1", { broker_id: new mongoose.Types.ObjectId().toString() }, false),
      /external broker/
    );
  });
});

describe("account initializer Manual deployment", () => {
  for (const [account_type, expected] of [["LIVE", "LIVE"], ["PAPER", "PAPER"], ["SIMULATION", "BACKTEST"]]) {
    it(`TC-INIT-001: a ${account_type} account's Manual deployment runs in ${expected} mode`, async () => {
      stub(Deployment, "findOne", () => Promise.resolve(null));
      let saved;
      stub(Deployment.prototype, "save", async function () { saved = this; return this; });
      const account = { _id: new mongoose.Types.ObjectId(), user_id: userId, account_type, account_name: "x" };
      await ensureManualDeploymentForAccount(userId, account._id, {
        account,
        manualStrategy: { _id: new mongoose.Types.ObjectId() },
        manualSymbol: { _id: new mongoose.Types.ObjectId() },
      });
      assert.equal(saved.strategy_mode, expected);
      assert.equal(saved.deployment_name, "Manual");
      assert.equal(isAccountTypeAllowedForMode(saved.strategy_mode, account_type), true);
    });
  }
});
