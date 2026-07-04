import Broker from "../models/broker.js";

export const createBroker = async (brokerData) => {
  const broker = new Broker(brokerData);
  return await broker.save();
};

export const getAllBrokers = async () => {
  return await Broker.find({}).sort({ name: 1 });
};
