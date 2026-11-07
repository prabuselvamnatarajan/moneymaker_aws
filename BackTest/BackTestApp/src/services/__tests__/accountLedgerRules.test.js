import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("BackTestApp Account & Ledger Business Logic & Cascade Rules", () => {

  function validateAccountCreation({ account_type, broker_id, is_internal_broker, initial_balance }) {
    if (initial_balance != null && initial_balance < 0) {
      throw new Error("Initial balance cannot be negative");
    }

    if ((account_type === "PAPER" || account_type === "SIMULATION") && broker_id && !is_internal_broker) {
      throw new Error("Only LIVE accounts can be associated with external brokers");
    }

    if (account_type === "LIVE" && !broker_id) {
      throw new Error("LIVE accounts require an explicit broker_id");
    }

    return true;
  }

  function validateTransfer({ from_account_id, to_account_id, amount, from_balance }) {
    if (!from_account_id || !to_account_id) {
      throw new Error("from_account_id and to_account_id are required");
    }

    if (String(from_account_id) === String(to_account_id)) {
      throw new Error("Self-transfer is not permitted: sender and receiver must be different accounts");
    }

    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      throw new Error("Transfer amount must be a positive number");
    }

    if (from_balance < numAmount) {
      throw new Error("Insufficient funds for transfer");
    }

    return {
      fromNewBalance: from_balance - numAmount,
      toAmount: numAmount,
    };
  }

  function executeCascadingDeletionPlan(entityType, entityId, userId, db) {
    if (!userId || !entityId) {
      throw new Error("userId and entityId are required for cascade delete");
    }

    const deletionPlan = {
      deletedDeployments: 0,
      deletedPositions: 0,
      deletedTrades: 0,
      deletedLedgers: 0,
    };

    if (entityType === "ACCOUNT") {
      // Deleting an account deletes associated deployments, positions, trades, ledgers belonging to user
      const affectedDeployments = db.deployments.filter(d => String(d.account_id) === String(entityId) && String(d.user_id) === String(userId));
      const deploymentIds = new Set(affectedDeployments.map(d => String(d._id)));

      deletionPlan.deletedDeployments = affectedDeployments.length;
      deletionPlan.deletedTrades = db.trades.filter(t => (String(t.account_id) === String(entityId) || deploymentIds.has(String(t.deployment_id))) && String(t.user_id) === String(userId)).length;
      deletionPlan.deletedPositions = db.positions.filter(p => (String(p.account_id) === String(entityId) || deploymentIds.has(String(p.deployment_id))) && String(p.user_id) === String(userId)).length;
      deletionPlan.deletedLedgers = db.ledgers.filter(l => String(l.account_id) === String(entityId) && String(l.user_id) === String(userId)).length;
    } else if (entityType === "DEPLOYMENT") {
      deletionPlan.deletedDeployments = 1;
      deletionPlan.deletedTrades = db.trades.filter(t => String(t.deployment_id) === String(entityId) && String(t.user_id) === String(userId)).length;
      deletionPlan.deletedPositions = db.positions.filter(p => String(p.deployment_id) === String(entityId) && String(p.user_id) === String(userId)).length;
      deletionPlan.deletedLedgers = db.ledgers.filter(l => String(l.deployment_id) === String(entityId) && String(l.user_id) === String(userId)).length;
    }

    return deletionPlan;
  }

  it("TC-ACC-005: rejects associating external broker with PAPER account", () => {
    assert.throws(
      () => validateAccountCreation({ account_type: "PAPER", broker_id: "ext_1", is_internal_broker: false }),
      { message: /Only LIVE accounts can be associated with external brokers/ }
    );
  });

  it("TC-ACC-003: requires broker_id when creating LIVE account", () => {
    assert.throws(
      () => validateAccountCreation({ account_type: "LIVE", broker_id: null }),
      { message: /LIVE accounts require an explicit broker_id/ }
    );
  });

  it("rejects negative initial balance on account creation", () => {
    assert.throws(
      () => validateAccountCreation({ account_type: "PAPER", initial_balance: -500 }),
      { message: /Initial balance cannot be negative/ }
    );
  });

  it("TC-LED-007: guards against self-transfer (from_account === to_account)", () => {
    assert.throws(
      () => validateTransfer({ from_account_id: "acc_1", to_account_id: "acc_1", amount: 100, from_balance: 500 }),
      { message: /Self-transfer is not permitted/ }
    );
  });

  it("TC-LED-008: guards against non-positive transfer amounts", () => {
    assert.throws(
      () => validateTransfer({ from_account_id: "acc_1", to_account_id: "acc_2", amount: 0, from_balance: 500 }),
      { message: /Transfer amount must be a positive number/ }
    );
    assert.throws(
      () => validateTransfer({ from_account_id: "acc_1", to_account_id: "acc_2", amount: -50, from_balance: 500 }),
      { message: /Transfer amount must be a positive number/ }
    );
  });

  it("TC-LED-009: guards against overdraft (insufficient funds)", () => {
    assert.throws(
      () => validateTransfer({ from_account_id: "acc_1", to_account_id: "acc_2", amount: 1000, from_balance: 500 }),
      { message: /Insufficient funds for transfer/ }
    );
  });

  it("successfully validates transfer when balance is sufficient", () => {
    const result = validateTransfer({ from_account_id: "acc_1", to_account_id: "acc_2", amount: 200, from_balance: 500 });
    assert.equal(result.fromNewBalance, 300);
    assert.equal(result.toAmount, 200);
  });

  it("Cascading Deletions: deleting account deletes associated deployments, positions, trades, and ledgers belonging to user", () => {
    const mockDb = {
      deployments: [
        { _id: "dep_1", account_id: "acc_1", user_id: "user_a" },
        { _id: "dep_2", account_id: "acc_2", user_id: "user_a" }, // other account
        { _id: "dep_3", account_id: "acc_1", user_id: "user_b" }, // other user
      ],
      positions: [
        { _id: "pos_1", account_id: "acc_1", deployment_id: "dep_1", user_id: "user_a" },
        { _id: "pos_2", account_id: "acc_2", deployment_id: "dep_2", user_id: "user_a" },
      ],
      trades: [
        { _id: "trd_1", account_id: "acc_1", deployment_id: "dep_1", user_id: "user_a" },
        { _id: "trd_2", account_id: "acc_2", deployment_id: "dep_2", user_id: "user_a" },
      ],
      ledgers: [
        { _id: "led_1", account_id: "acc_1", user_id: "user_a" },
        { _id: "led_2", account_id: "acc_2", user_id: "user_a" },
      ],
    };

    const plan = executeCascadingDeletionPlan("ACCOUNT", "acc_1", "user_a", mockDb);
    assert.equal(plan.deletedDeployments, 1);
    assert.equal(plan.deletedPositions, 1);
    assert.equal(plan.deletedTrades, 1);
    assert.equal(plan.deletedLedgers, 1);
  });

  it("Cascading Deletions: deleting deployment deletes associated positions, trades, and ledgers", () => {
    const mockDb = {
      deployments: [{ _id: "dep_1", user_id: "user_a" }],
      positions: [
        { _id: "pos_1", deployment_id: "dep_1", user_id: "user_a" },
        { _id: "pos_2", deployment_id: "dep_9", user_id: "user_a" },
      ],
      trades: [
        { _id: "trd_1", deployment_id: "dep_1", user_id: "user_a" },
        { _id: "trd_2", deployment_id: "dep_9", user_id: "user_a" },
      ],
      ledgers: [
        { _id: "led_1", deployment_id: "dep_1", user_id: "user_a" },
        { _id: "led_2", deployment_id: "dep_9", user_id: "user_a" },
      ],
    };

    const plan = executeCascadingDeletionPlan("DEPLOYMENT", "dep_1", "user_a", mockDb);
    assert.equal(plan.deletedDeployments, 1);
    assert.equal(plan.deletedPositions, 1);
    assert.equal(plan.deletedTrades, 1);
    assert.equal(plan.deletedLedgers, 1);
  });
});
