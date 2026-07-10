import {
  getAllExternalBrokers,
  createExternalBroker,
  updateExternalBroker,
  deleteExternalBroker
} from "../services/externalBroker.js";

export const getAllExternalBrokersController = async (req, res, next) => {
  try {
    const result = await getAllExternalBrokers();
    res.status(200).json({
      message: "External brokers retrieved successfully",
      items: result,
    });
  } catch (err) {
    next(err);
  }
};

export const createExternalBrokerController = async (req, res, next) => {
  try {
    const result = await createExternalBroker(req.body);
    res.status(201).json({
      message: "External broker created successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const updateExternalBrokerController = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await updateExternalBroker(id, req.body);
    res.status(200).json({
      message: "External broker updated successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const deleteExternalBrokerController = async (req, res, next) => {
  try {
    const { id } = req.params;
    await deleteExternalBroker(id);
    res.status(200).json({
      message: "External broker deleted successfully",
    });
  } catch (err) {
    next(err);
  }
};
