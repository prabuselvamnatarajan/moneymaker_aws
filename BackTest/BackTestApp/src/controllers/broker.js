import { createBroker, getAllBrokers } from "../services/broker.js";

export const createBrokerController = async (req, res, next) => {
  try {
    const result = await createBroker(req.body);
    res.status(201).json({
      message: "Broker created successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getAllBrokersController = async (req, res, next) => {
  try {
    const result = await getAllBrokers();
    res.status(200).json({
      message: "Brokers retrieved successfully",
      items: result,
    });
  } catch (err) {
    next(err);
  }
};
