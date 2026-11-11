import { createClient } from "redis";
import Broker from "../models/broker.js";
import {
  getUpstoxRedisKey,
  getUpstoxTokenStatus,
  isUpstoxTokenExpired,
} from "../utils/upstoxToken.js";

const DEFAULT_REDIS_KEY = "redis_upstox_access_token";

const UPSTOX_REQUIRED_CREDENTIAL_KEYS = ["client_id", "client_secret", "redirect_uri"];

export function isDummyCredential(value) {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("dummy") || trimmed === "dummy";
}

export function validateUpstoxCredentials(credentials, { allowPartialSecret = false } = {}) {
  if (!credentials || typeof credentials !== "object") {
    throw new Error("Upstox credentials are required.");
  }

  for (const key of UPSTOX_REQUIRED_CREDENTIAL_KEYS) {
    const value = credentials[key];
    if (key === "client_secret" && allowPartialSecret && !value) {
      continue;
    }
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Upstox credential "${key}" is required.`);
    }
    if (isDummyCredential(value)) {
      throw new Error(`Upstox credential "${key}" contains an invalid dummy placeholder.`);
    }
  }
}

function normalizeUpstoxCredentials(existingCredentials = {}, incomingCredentials = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(incomingCredentials)) {
    if (typeof value === "string") {
      normalized[key] = value.trim();
    }
  }

  if (!normalized.client_secret && existingCredentials.client_secret) {
    normalized.client_secret = existingCredentials.client_secret;
  }

  validateUpstoxCredentials(normalized, { allowPartialSecret: true });
  return normalized;
}

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

async function isUserAdmin(userId) {
  if (!userId) return false;
  try {
    const User = (await import("../models/user.js")).default;
    const Role = (await import("../iam/models/role.js")).default;
    const adminRole = await Role.findOne({ name: "admin" }).lean();
    if (!adminRole) return false;
    const adminRoleIdStr = adminRole._id.toString();
    const user = await User.findById(userId).lean();
    if (!user || !Array.isArray(user.roles)) return false;
    return user.roles.some((r) => {
      const roleIdStr = typeof r === "object" && r !== null ? String(r._id || r) : String(r);
      return roleIdStr === adminRoleIdStr;
    });
  } catch (err) {
    console.error("[Broker Service] Failed to check admin role:", err.message);
    return false;
  }
}

async function clearBrokerAccessToken(broker) {
  broker.access_token = "";
  await broker.save();

  const ownerIsAdmin = await isUserAdmin(broker.user_id);

  await withRedisClient(async (client) => {
    const userKey = getUpstoxRedisKey(broker.user_id || "");
    await client.del(userKey);

    // Only clear shared org keys when the expired broker belongs to an admin.
    // Clearing them for regular users would knock out the vendor market-data feed.
    if (ownerIsAdmin) {
      await client.del(DEFAULT_REDIS_KEY);
      await client.del(`${DEFAULT_REDIS_KEY}:admin`);
      await client.del(`${DEFAULT_REDIS_KEY}:org`);
    }

    const payload = JSON.stringify({
      event: "broker_updated",
      userId: broker.user_id || "",
      brokerId: broker.external_broker_id || "upstox",
    });
    await client.publish("broker_updates", payload);
  });

  // After clearing an admin token, try to repopulate org keys from another valid admin broker.
  if (ownerIsAdmin) {
    await syncOrgAccessTokenIfAdmin();
  }

  console.log(
    `[Broker Service] Cleared expired Upstox access token for broker ${broker._id} (user: ${broker.user_id || "default"}, admin=${ownerIsAdmin})`
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
    // Sanitize any legacy or accidental dummy credentials in stored broker document
    if (!broker.is_internal && broker.external_broker_id === "upstox" && broker.credentials) {
      const creds = broker.credentials;
      let modifiedCreds = false;

      if (isDummyCredential(creds.client_id)) {
        creds.client_id = "";
        modifiedCreds = true;
      }
      if (isDummyCredential(creds.client_secret)) {
        creds.client_secret = "";
        modifiedCreds = true;
      }
      if (modifiedCreds && broker.save) {
        broker.markModified("credentials");
        await broker.save();
      }
    }

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
  const payload = { ...brokerData, user_id: userId };

  if (payload.external_broker_id === "upstox") {
    payload.credentials = normalizeUpstoxCredentials({}, payload.credentials || {});
  }

  const broker = new Broker(payload);
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
    const Role = (await import("../iam/models/role.js")).default;

    const adminRole = await Role.findOne({ name: "admin" }).lean();
    if (!adminRole) return;
    const adminRoleIdStr = adminRole._id.toString();

    let user = null;
    if (userOrUserId) {
      let userId = typeof userOrUserId === "string" ? userOrUserId : userOrUserId?._id;
      user = typeof userOrUserId === "object" && userOrUserId.username ? userOrUserId : await User.findById(userId);
    }

    let broker = null;
    let targetUserId = "";

    if (user) {
      const isAdmin = user.roles && Array.isArray(user.roles) && user.roles.some((r) => {
        const roleIdStr = typeof r === "object" && r !== null ? String(r._id || r) : String(r);
        return roleIdStr === adminRoleIdStr;
      });
      if (!isAdmin) return;
      targetUserId = user._id.toString();
      broker = await Broker.findOne({
        user_id: targetUserId,
        external_broker_id: "upstox",
        access_token: { $ne: "" },
      });
    } else {
      const adminUsers = await User.find({
        roles: { $in: [adminRole._id, adminRoleIdStr] }
      }).select("_id").lean();
      const adminUserIds = adminUsers.map((u) => u._id.toString());
      if (adminUserIds.length > 0) {
        broker = await Broker.findOne({
          user_id: { $in: adminUserIds },
          external_broker_id: "upstox",
          access_token: { $ne: "" },
        });
        if (broker) targetUserId = broker.user_id;
      }
    }

    if (broker && broker.access_token && !isUpstoxTokenExpired(broker.access_token)) {
      await withRedisClient(async (client) => {
        await client.set(`${DEFAULT_REDIS_KEY}:admin`, broker.access_token);
        await client.set(`${DEFAULT_REDIS_KEY}:org`, broker.access_token);
        await client.set(DEFAULT_REDIS_KEY, broker.access_token);
        if (targetUserId) {
          await client.set(`redis_upstox_access_token:${targetUserId}`, broker.access_token);
        }

        const payload = JSON.stringify({
          event: "broker_updated",
          userId: targetUserId,
          brokerId: "upstox",
        });
        await client.publish("broker_updates", payload);
      });
      console.log(`[Broker Service] Synced Org/Admin Upstox access token to Redis for admin user: ${targetUserId}`);
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
    const platform = updateData.external_broker_id || broker.external_broker_id;
    if (platform === "upstox") {
      broker.credentials = normalizeUpstoxCredentials(
        broker.credentials || {},
        updateData.credentials
      );
    } else {
      broker.credentials = {
        ...broker.credentials,
        ...updateData.credentials,
      };
    }
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
  const broker = await Broker.findOne(query);
  if (!broker) {
    throw new Error("Broker not found or you are not authorized to delete it.");
  }
  if (broker.is_internal && !broker.user_id) {
    throw new Error("Internal broker Cobra Trades cannot be deleted.");
  }

  const Account = (await import("../models/account.js")).default;
  const linkedAccounts = await Account.find({ broker_id: broker._id }).lean();
  if (linkedAccounts.length > 0) {
    const liveAccounts = linkedAccounts.filter(a => a.account_type === "LIVE");
    if (liveAccounts.length > 0) {
      throw new Error(`Cannot delete broker with active LIVE account associations (${liveAccounts.length} live account(s) linked).`);
    }
    // For non-live accounts linked to an external broker being deleted, fall back to Cobra Trades internal broker
    let internalBroker = await Broker.findOne({ is_internal: true, user_id: { $in: [null, undefined] } });
    if (!internalBroker) {
      internalBroker = await Broker.findOne({ is_internal: true });
    }
    if (!internalBroker) {
      internalBroker = await Broker.create({ name: "Cobra Trades", is_internal: true });
    }
    await Account.updateMany({ broker_id: broker._id }, { $set: { broker_id: internalBroker._id } });
  }

  await Broker.deleteOne({ _id: broker._id });
  return { message: "Broker deleted successfully" };
};
