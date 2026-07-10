import ExternalBrokerId from "../models/externalBrokerId.js";

export const getAllExternalBrokers = async () => {
  return await ExternalBrokerId.find({}).sort({ external_broker_id: 1 });
};

export const createExternalBroker = async (data) => {
  const ext = new ExternalBrokerId({
    external_broker_id: data.external_broker_id,
  });
  return await ext.save();
};

export const updateExternalBroker = async (id, data) => {
  const ext = await ExternalBrokerId.findById(id);
  if (!ext) {
    throw new Error("External broker not found");
  }
  ext.external_broker_id = data.external_broker_id;
  return await ext.save();
};

export const deleteExternalBroker = async (id) => {
  const result = await ExternalBrokerId.deleteOne({ _id: id });
  if (result.deletedCount === 0) {
    throw new Error("External broker not found");
  }
  return { message: "External broker deleted successfully" };
};
