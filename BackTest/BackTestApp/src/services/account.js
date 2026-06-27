import Account from "../models/account.js";

export const createAccount = async (userId, accountData) => {
  const account = new Account({ ...accountData, user_id: userId });
  return await account.save();
};

export const getAllAccounts = async (userId, filters = {}) => {
  const query = { user_id: userId, ...filters };

  if (typeof query.is_active === "string") {
    query.is_active = query.is_active === "true";
  }

  return await Account.find(query).sort({ created_on: -1 });
};

export const getAccountById = async (userId, id) => {
  return await Account.findOne({ _id: id, user_id: userId });
};

export const updateAccount = async (userId, id, updateData) => {
  return await Account.findOneAndUpdate(
    { _id: id, user_id: userId },
    updateData,
    {
      new: true,
      runValidators: true,
    }
  );
};

export const deleteAccount = async (userId, id) => {
  return await Account.findOneAndDelete({ _id: id, user_id: userId });
};
