const sessionService = require("../services/sessionService");

function normalizePermission(permission) {
  if (!permission) return null;

  if (typeof permission === "string") {
    const [operation, entity] = permission.split(":").map((item) => String(item || "").trim());
    if (!operation || !entity) return null;
    return { operation, entity };
  }

  if (typeof permission === "object") {
    const operation = String(permission.operation || "").trim();
    const entity = String(permission.entity || "").trim();
    if (!operation || !entity) return null;
    return { operation, entity };
  }

  return null;
}

function permissionKey(permission) {
  return `${permission.operation}:${permission.entity}`.toLowerCase();
}

function buildPermissionMap(permissions = []) {
  return new Set(
    permissions
      .map(normalizePermission)
      .filter(Boolean)
      .map(permissionKey)
  );
}

function buildRequiredPermissionKeys(requiredPermissions) {
  if (!Array.isArray(requiredPermissions)) return [];
  return requiredPermissions
    .map(normalizePermission)
    .filter(Boolean)
    .map(permissionKey);
}

function authorize(requiredPermissions = []) {
  return async (req, res, next) => {
    try {
      if (!req.auth || !req.auth.sessionID) {
        const error = new Error("Authorization failed: missing session information");
        error.statusCode = 401;
        throw error;
      }

      const session = await sessionService.getSessionById(req.auth.sessionID, {
        populateRolePermissions: true,
      });
      if (!session) {
        const error = new Error("Authorization failed: invalid or expired session");
        error.statusCode = 401;
        throw error;
      }

      const currentRole = session.currentRole;
      if (!currentRole) {
        const error = new Error("Authorization failed: session has no current role");
        error.statusCode = 403;
        throw error;
      }

      const rolePermissionKeys = buildPermissionMap(currentRole.permissions || []);
      const requiredKeys = buildRequiredPermissionKeys(requiredPermissions);

      if (requiredKeys.length === 0) {
        const error = new Error("Authorization failed: required permissions are not configured correctly");
        error.statusCode = 500;
        throw error;
      }

      const hasMatchingPermission = requiredKeys.some((key) => rolePermissionKeys.has(key));
      if (!hasMatchingPermission) {
        const error = new Error("Authorization failed: you do not have access to the resource");
        error.statusCode = 403;
        throw error;
      }

      req.session = session;
      req.currentRole = currentRole;
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  authorize,
};
