import { createClient } from "redis";
import Broker from "../models/broker.js";
import {
  getUpstoxRedisKey,
  getUpstoxTokenStatus,
  isUpstoxTokenExpired,
} from "../utils/upstoxToken.js";

const DEFAULT_REDIS_KEY = "redis_upstox_access_token";

async function withRedisClient(callback) {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn("[Broker Service] REDIS_URL not set, skipping Redis token cleanup.");
    return;
  }

  let client;
  try {
    client = createClient({ url: redisUrl });
    await client.connect();
    await callback(client);
  } catch (err) {
    console.error("[Broker Service] Redis operation failed:", err.message);
  } finally {
    if (client) {
      await client.disconnect();
    }
  }
}

async function clearBrokerAccessToken(broker) {
  broker.access_token = "";
  await broker.save();

  await withRedisClient(async (client) => {
    const userKey = getUpstoxRedisKey(broker.user_id || "");
    await client.del(userKey);
    await client.del(DEFAULT_REDIS_KEY);

    const payload = JSON.stringify({
      event: "broker_updated",
      userId: broker.user_id || "",
      brokerId: broker.external_broker_id || "upstox",
    });
    await client.publish("broker_updates", payload);
  });

  console.log(
    `[Broker Service] Cleared expired Upstox access token for broker ${broker._id} (user: ${broker.user_id || "default"})`
  );
}

function attachTokenStatus(broker) {
  if (broker.is_internal || broker.external_broker_id !== "upstox") {
    return broker;
  }

  const plainBroker = broker.toObject ? broker.toObject() : { ...broker };
  plainBroker.token_status = getUpstoxTokenStatus(plainBroker.access_token);
  return plainBroker;
}

async function sanitizeExpiredUpstoxBrokers(brokers) {
  const sanitized = [];

  for (const broker of brokers) {
    if (
      !broker.is_internal &&
      broker.external_broker_id === "upstox" &&
      broker.access_token &&
      isUpstoxTokenExpired(broker.access_token)
    ) {
      await clearBrokerAccessToken(broker);
      sanitized.push({
        ...broker.toObject(),
        access_token: "",
        token_status: "expired",
      });
      continue;
    }

    sanitized.push(attachTokenStatus(broker));
  }

  return sanitized;
}

export const createBroker = async (userId, brokerData) => {
  const broker = new Broker({
    ...brokerData,
    user_id: userId,
  });
  return await broker.save();
};

export const getAllBrokers = async (userId, isAdmin = false) => {
  let brokers;
  if (isAdmin) {
    brokers = await Broker.find({}).sort({ name: 1 });
  } else {
    brokers = await Broker.find({
      $or: [{ is_internal: true }, { user_id: userId }],
    }).sort({ name: 1 });
  }

  return sanitizeExpiredUpstoxBrokers(brokers);
};

export async function syncOrgAccessTokenIfAdmin(userOrUserId) {
  try {
    const User = (await import("../models/user.js")).default;
    const Role = (await import("../models/role.js")).default;

    let userId = typeof userOrUserId === "string" ? userOrUserId : userOrUserId?._id;
    let user = typeof userOrUserId === "object" && userOrUserId.username ? userOrUserId : await User.findById(userId);
    if (!user) return;

    const adminRole = await Role.findOne({ name: "admin" }).lean();
    if (!adminRole) return;
    const adminRoleIdStr = adminRole._id.toString();

    const isAdmin = user.roles && Array.isArray(user.roles) && user.roles.some((r) => String(r._id || r) === adminRoleIdStr);

    if (!isAdmin) return;

    const broker = await Broker.findOne({
      user_id: user._id.toString(),
      external_broker_id: "upstox",
    });

    if (broker && broker.access_token && !isUpstoxTokenExpired(broker.access_token)) {
      await withRedisClient(async (client) => {
        await client.set(`${DEFAULT_REDIS_KEY}:admin`, broker.access_token);
        await client.set(DEFAULT_REDIS_KEY, broker.access_token);
        await client.set(`redis_upstox_access_token:${user._id.toString()}`, broker.access_token);

        const payload = JSON.stringify({
          event: "broker_updated",
          userId: user._id.toString(),
          brokerId: "upstox",
        });
        await client.publish("broker_updates", payload);
      });
      console.log(`[Broker Service] Synced Org/Admin Upstox access token to Redis for admin user: ${user._id}`);
    }
  } catch (err) {
    console.error("[Broker Service] Error syncing Org access token for admin:", err.message);
  }
}

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
  if (updateData.access_token !== undefined) {
    broker.access_token = updateData.access_token;
  }

  const savedBroker = await broker.save();

  if (savedBroker.external_broker_id === "upstox" && savedBroker.access_token && !isUpstoxTokenExpired(savedBroker.access_token)) {
    await syncOrgAccessTokenIfAdmin(savedBroker.user_id);
  }
  
  return savedBroker;
};

export const deleteBroker = async (brokerId, userId, isAdmin) => {
  const query = isAdmin ? { _id: brokerId } : { _id: brokerId, user_id: userId, is_internal: false };
  const result = await Broker.deleteOne(query);
  if (result.deletedCount === 0) {
    throw new Error("Broker not found or you are not authorized to delete it.");
  }
  return { message: "Broker deleted successfully" };
};
