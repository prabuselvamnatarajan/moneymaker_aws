import Deployment from "../models/deployment.js";

export const createDeployment = async (userId, deploymentData) => {
  const deployment = new Deployment({ ...deploymentData, user_id: userId });
  return await deployment.save();
};

export const getAllDeployments = async (userId, filters = {}) => {
  const query = { user_id: userId, ...filters };

  if (typeof query.current_status === "string") {
    query.current_status = query.current_status.toUpperCase();
  }

  return await Deployment.find(query).sort({ start_time: -1 });
};

export const getDeploymentById = async (userId, id) => {
  return await Deployment.findOne({ _id: id, user_id: userId });
};

export const updateDeployment = async (userId, id, updateData) => {
  return await Deployment.findOneAndUpdate(
    { _id: id, user_id: userId },
    updateData,
    {
      new: true,
      runValidators: true,
    }
  );
};

export const deleteDeployment = async (userId, id) => {
  return await Deployment.findOneAndDelete({ _id: id, user_id: userId });
};
