import mongoose from "mongoose";

const ledgerSchema = new mongoose.Schema({
  ledger_id: {
    type: String,
    default: () => new mongoose.Types.ObjectId().toString(),
    unique: true,
  },
  account_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Account",
    required: true,
  },
  trade_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Trade",
    required: true,
    unique: true,
  },
  deployment_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Deployment",
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  strategy_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Strategy",
  },
  user_symbol_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "UserSymbol",
  },
  change_in_balance: {
    type: Number,
    required: true,
  },
  opening_balance: {
    type: Number,
    required: true,
  },
  closing_balance: {
    type: Number,
    required: true,
  },
  symbol: {
    type: String,
    uppercase: true,
  },
  order_type: {
    type: String,
    enum: ["BUY", "SELL"],
  },
  quantity: {
    type: Number,
  },
  price: {
    type: Number,
  },
  created_on: {
    type: Date,
    default: Date.now,
    immutable: true,
  },
});

// Validate closing_balance = opening_balance + change_in_balance
ledgerSchema.pre("save", function (next) {
  const calculated = this.opening_balance + this.change_in_balance;
  if (Math.abs(calculated - this.closing_balance) > 0.01) {
    next(new Error("closing_balance must equal opening_balance + change_in_balance"));
  } else {
    next();
  }
});

// Indexes
ledgerSchema.index({ account_id: 1 });
ledgerSchema.index({ trade_id: 1 });
ledgerSchema.index({ user_id: 1 });
ledgerSchema.index({ strategy_id: 1 });
ledgerSchema.index({ user_symbol_id: 1 });
ledgerSchema.index({ created_on: 1 });
ledgerSchema.index({ account_id: 1, created_on: 1 });
ledgerSchema.index({ deployment_id: 1 });

export default mongoose.model("Ledger", ledgerSchema);
