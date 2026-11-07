import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { createAccount, deleteAccount } from "../account.js";
import { transferBalance } from "../ledger.js";

// Ensure models are registered on mongoose
import "../../models/account.js";
import "../../models/broker.js";
import "../../models/deployment.js";
import "../../models/position.js";
import "../../models/trade.js";
import "../../models/ledger.js";

describe("BackTestApp Account & Ledger Business Logic & Cascade Rules (Real Codebase)", () => {

  const Broker = mongoose.model("Broker");
  const Account = mongoose.model("Account");
  const Deployment = mongoose.model("Deployment");
  const Position = mongoose.model("Position");
  const Trade = mongoose.model("Trade");
  const Ledger = mongoose.model("Ledger");

  it("TC-ACC-005: createAccount rejects associating external broker with PAPER account", async () => {
    // Stub Broker.findById to return an external broker
    const origFindById = Broker.findById;
    Broker.findById = async (id) => ({ _id: id, is_internal: false });

    try {
      await assert.rejects(
        async () => {
          await createAccount("user_123", {
            account_name: "My Paper Account",
            account_type: "PAPER",
            broker_id: new mongoose.Types.ObjectId(),
          });
        },
        { message: /Only LIVE accounts can be associated with external brokers/ }
      );
    } finally {
      Broker.findById = origFindById;
    }
  });

  it("TC-LED-007: transferBalance rejects self-transfer (from_account === to_account)", async () => {
    await assert.rejects(
      async () => {
        await transferBalance("user_1", "acc_same", "acc_same", 100);
      },
      { message: /Source and destination accounts must be different/ }
    );
  });

  it("TC-LED-008: transferBalance guards against non-positive transfer amounts", async () => {
    await assert.rejects(
      async () => {
        await transferBalance("user_1", "acc_1", "acc_2", 0);
      },
      { message: /Amount must be greater than zero/ }
    );
    await assert.rejects(
      async () => {
        await transferBalance("user_1", "acc_1", "acc_2", -50);
      },
      { message: /Amount must be greater than zero/ }
    );
  });

  it("TC-LED-009: transferBalance guards against overdraft (insufficient funds)", async () => {
    const origFindOne = Account.findOne;
    Account.findOne = async ({ user_id, $or }) => {
      return {
        _id: "acc_1",
        user_id,
        current_balance: 50,
      };
    };

    try {
      await assert.rejects(
        async () => {
          await transferBalance("user_1", "acc_1", "acc_2", 500);
        },
        { message: /Insufficient funds/ }
      );
    } finally {
      Account.findOne = origFindOne;
    }
  });

  it("Cascading Deletions: deleteAccount executes real cascading deletion plan across deployments, positions, trades, and ledgers", async () => {
    const targetAccountId = new mongoose.Types.ObjectId();
    const userId = "user_test_cascade";

    // Track delete calls
    const deletedCollections = [];

    const origAccountFindOne = Account.findOne;
    const origAccountDeleteOne = Account.deleteOne;
    const origDeploymentFind = Deployment.find;
    const origDeploymentDeleteMany = Deployment.deleteMany;
    const origTradeDeleteMany = Trade.deleteMany;
    const origPositionDeleteMany = Position.deleteMany;
    const origLedgerDeleteMany = Ledger.deleteMany;

    const mockDeployments = [
      { _id: new mongoose.Types.ObjectId() },
      { _id: new mongoose.Types.ObjectId() },
    ];

    Account.findOne = async () => ({ _id: targetAccountId, user_id: userId });
    Account.deleteOne = async (query) => {
      deletedCollections.push({ entity: "Account", query });
      return { deletedCount: 1 };
    };

    Deployment.find = () => ({
      lean: async () => mockDeployments,
    });
    Deployment.deleteMany = async (query) => {
      deletedCollections.push({ entity: "Deployment", query });
      return { deletedCount: 2 };
    };

    Trade.deleteMany = async (query) => {
      deletedCollections.push({ entity: "Trade", query });
      return { deletedCount: 5 };
    };
    Position.deleteMany = async (query) => {
      deletedCollections.push({ entity: "Position", query });
      return { deletedCount: 2 };
    };
    Ledger.deleteMany = async (query) => {
      deletedCollections.push({ entity: "Ledger", query });
      return { deletedCount: 8 };
    };

    try {
      const deleted = await deleteAccount(userId, targetAccountId, false);
      assert.ok(deleted);

      // Verify cascading sequence executed in real deleteAccount function
      const entitiesDeleted = deletedCollections.map((d) => d.entity);
      assert.ok(entitiesDeleted.includes("Trade"), "Trades must be cascaded");
      assert.ok(entitiesDeleted.includes("Position"), "Positions must be cascaded");
      assert.ok(entitiesDeleted.includes("Ledger"), "Ledgers must be cascaded");
      assert.ok(entitiesDeleted.includes("Deployment"), "Deployments must be cascaded");
      assert.ok(entitiesDeleted.includes("Account"), "Target account must be deleted");

      // Verify that deleteMany scoped to deployment IDs was called
      const depTradeDelete = deletedCollections.find(
        (d) => d.entity === "Trade" && d.query?.deployment_id?.$in
      );
      assert.ok(depTradeDelete, "Expected Trade deletion by deployment_id $in");
      assert.equal(depTradeDelete.query.deployment_id.$in.length, 2);
    } finally {
      Account.findOne = origAccountFindOne;
      Account.deleteOne = origAccountDeleteOne;
      Deployment.find = origDeploymentFind;
      Deployment.deleteMany = origDeploymentDeleteMany;
      Trade.deleteMany = origTradeDeleteMany;
      Position.deleteMany = origPositionDeleteMany;
      Ledger.deleteMany = origLedgerDeleteMany;
    }
  });
});
