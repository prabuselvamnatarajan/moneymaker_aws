import Broker from "../models/broker.js";

export const createBroker = async (userId, brokerData) => {
  const broker = new Broker({
    ...brokerData,
    user_id: userId,
  });
  return await broker.save();
};

export const getAllBrokers = async (userId, isAdmin = false) => {
  if (isAdmin) {
    return await Broker.find({}).sort({ name: 1 });
  }
  return await Broker.find({
    $or: [
      { is_internal: true },
      { user_id: userId }
    ]
  }).sort({ name: 1 });
};

export const updateBroker = async (brokerId, userId, isAdmin, updateData) => {
  const query = isAdmin ? { _id: brokerId } : { _id: brokerId, user_id: userId, is_internal: false };
  const broker = await Broker.findOne(query);
  if (!broker) {
    throw new Error("Broker not found or you are not authorized to modify it.");
  }
  
  if (updateData.name !== undefined) broker.name = updateData.name;
  if (updateData.external_broker_id !== undefined) broker.external_broker_id = updateData.external_broker_id;
  if (updateData.credentials !== undefined) {
    broker.credentials = {
      ...broker.credentials,
      ...updateData.credentials
    };
  }
  if (updateData.access_token !== undefined) broker.access_token = updateData.access_token;
  
  return await broker.save();
};

export const deleteBroker = async (brokerId, userId, isAdmin) => {
  const query = isAdmin ? { _id: brokerId } : { _id: brokerId, user_id: userId, is_internal: false };
  const result = await Broker.deleteOne(query);
  if (result.deletedCount === 0) {
    throw new Error("Broker not found or you are not authorized to delete it.");
  }
  return { message: "Broker deleted successfully" };
};
