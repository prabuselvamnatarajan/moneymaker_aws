import Session from "../models/session.js";
import Role from "../models/role.js";
import User from "../models/user.js";
import Permission from "../models/permission.js";


function hasUserRole(userRoles, roleId) {
  if (!Array.isArray(userRoles)) return false;
  const targetRoleId = String(roleId);
  return userRoles.some((role) => String(role) === targetRoleId);
}

async function ensureUserHasRole(user, roleId) {
  if (!user || typeof user !== "object") {
    const error = new Error("Authenticated user object is required to verify role membership");
    error.statusCode = 401;
    throw error;
  }

  const userRoles = Array.isArray(user.roles) ? user.roles : undefined;
  if (hasUserRole(userRoles, roleId)) return;

  const error = new Error("Role is not assigned to the authenticated user");
  error.statusCode = 403;
  throw error;
}

async function createSession({ user, currentRoleId, device, os, browser, ip, location }) {
  const userId = user && (user._id || user.id);
  if (!userId || !currentRoleId) {
    const error = new Error("User and current role ID are required to create a session");
    error.statusCode = 400;
    throw error;
  }

  await ensureUserHasRole(user, currentRoleId);

  const role = await Role.findOne({ _id: currentRoleId, active: true });
  if (!role) {
    const error = new Error("Invalid or inactive role cannot be used for session creation");
    error.statusCode = 400;
    throw error;
  }


  const session = new Session({
    user: userId,
    currentRole: currentRoleId,
    device: device || "Unknown Device",
    os: os || "Unknown OS",
    browser: browser || "Unknown Browser",
    ip: ip || "127.0.0.1",
    location: location || "Unknown Location",
    roleHistory: [
      {
        role: currentRoleId,
        order: 1,
        session_start_time: new Date(),
      },
    ],
  });

  return session.save();
}

async function getSessionById(sessionId, options = {}) {
  const { populateRolePermissions = true } = options;
  if (!sessionId) return null;

  let query = Session.findById(sessionId).where({ active: true });
  if (populateRolePermissions) {
    query = query.populate({
      path: "currentRole",
      populate: {
        path: "permissions",
        model: "Permission",
      },
    });
  }

  return query.exec();
}

async function switchSessionRole(sessionId, nextRoleId, options = {}) {
  const { user } = options;

  if (!sessionId || !nextRoleId) {
    const error = new Error("Session ID and next role ID are required to switch roles");
    error.statusCode = 400;
    throw error;
  }

  if (!user) {
    const error = new Error("Authenticated user information is required to switch session role");
    error.statusCode = 401;
    throw error;
  }

  const session = await Session.findOne({ _id: sessionId, active: true });
  if (!session) {
    const error = new Error("Session not found or already terminated");
    error.statusCode = 404;
    throw error;
  }

  const authenticatedUserId = String(user._id || user.id);
  if (!authenticatedUserId || String(session.user) !== authenticatedUserId) {
    const error = new Error("Unauthorized: session does not belong to the authenticated user");
    error.statusCode = 403;
    throw error;
  }

  await ensureUserHasRole(user, nextRoleId);

  const role = await Role.findOne({ _id: nextRoleId, active: true });
  if (!role) {
    const error = new Error("Invalid or inactive role cannot be selected for session switch");
    error.statusCode = 400;
    throw error;
  }

  const lastHistory = session.roleHistory[session.roleHistory.length - 1];
  if (lastHistory && !lastHistory.session_end_time) {
    lastHistory.session_end_time = new Date();
  }

  session.currentRole = nextRoleId;
  session.roleHistory.push({
    role: nextRoleId,
    order: session.roleHistory.length + 1,
    session_start_time: new Date(),
  });

  return session.save();
}

async function endSession(sessionId, user) {
  if (!sessionId) {
    const error = new Error("Session ID is required to end a session");
    error.statusCode = 400;
    throw error;
  }

  if (!user || typeof user !== "object") {
    const error = new Error("Authenticated user object is required to end a session");
    error.statusCode = 401;
    throw error;
  }

  const authenticatedUserId = String(user._id || user.id || user.userId);
  if (!authenticatedUserId) {
    const error = new Error("Authenticated user ID is required to end a session");
    error.statusCode = 401;
    throw error;
  }

  const session = await Session.findOne({ _id: sessionId, active: true });
  if (!session) {
    const error = new Error("Session not found or already terminated");
    error.statusCode = 404;
    throw error;
  }

  if (String(session.user) !== authenticatedUserId) {
    const error = new Error("Unauthorized: session does not belong to the authenticated user");
    error.statusCode = 403;
    throw error;
  }

  const lastHistory = session.roleHistory[session.roleHistory.length - 1];
  if (lastHistory && !lastHistory.session_end_time) {
    lastHistory.session_end_time = new Date();
  }

  session.active = false;
  session.endedAt = new Date();

  return session.save();
}

export { createSession, getSessionById, switchSessionRole, endSession };
