import mongoose from "mongoose";
import Trade from "../models/trade.js";
import Account from "../models/account.js";
import Ledger from "../models/ledger.js";

export const createTrade = async (tradeData) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { account_id, price, quantity, type_of_order } = tradeData;

    // 1️⃣ Fetch the account
    const account = await Account.findOne({ account_id }).session(session);
    if (!account) throw new Error(`Account not found: ${account_id}`);

    const opening_balance = account.current_balance;
    const tradeValue = price * quantity;

    // 2️⃣ Validate balance
    if (type_of_order === "BUY" && opening_balance < tradeValue) {
      throw new Error("Insufficient balance for BUY order");
    }

    // 3️⃣ Calculate changes
    const change_in_balance = type_of_order === "BUY" ? -tradeValue : tradeValue;
    const closing_balance = opening_balance + change_in_balance;

    // 4️⃣ Insert trade → this will auto-generate trade_id
    const [trade] = await Trade.create([tradeData], { session });

    // 5️⃣ Insert ledger (foreign key reference to the new trade.trade_id)
    await Ledger.create(
      [
        {
          account_id,
          trade_id: trade.trade_id, // use from the saved trade
          change_in_balance,
          opening_balance,
          closing_balance,
        },
      ],
      { session }
    );

    // 6️⃣ Update account balance
    account.current_balance = closing_balance;
    await account.save({ session });

    await session.commitTransaction();
    session.endSession();

    return { trade, account, closing_balance };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};
