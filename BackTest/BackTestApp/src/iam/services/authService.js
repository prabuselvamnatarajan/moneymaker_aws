import bcrypt from "bcryptjs";
import Role from "../models/role.js";

const resolveUserModel = async () => {
  const configuredModel = process.env.IAM_USER_MODEL;
  if (configuredModel) {
    const imported = await import(configuredModel);
    return imported.default || imported;
  }

  const imported = await import("../models/user.js");
  return imported.default || imported;
};

const User = await resolveUserModel();

export async function getDefaultUserRoleId() {
  let userRole = await Role.findOne({ name: "user", active: true }).lean();
  if (!userRole) {
    userRole = await Role.findOneAndUpdate(
      { name: "user" },
      { $setOnInsert: { description: "Default user role", active: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true, lean: true }
    );
  }

  return userRole._id;
}

export async function createUser({ username, name, email, password }) {
  const normalizedEmail = String(email).toLowerCase().trim();
  const normalizedUsername = String(username).trim();
  const normalizedName = String(name).trim();
  const existingUser = await User.findOne({
    $or: [{ email: normalizedEmail }, { username: normalizedUsername }],
  }).lean();

  if (existingUser) {
    const error = new Error("User already exists");
    error.statusCode = 409;
    throw error;
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const defaultRoleId = await getDefaultUserRoleId();

  const user = new User({
    username: normalizedUsername,
    name: normalizedName,
    email: normalizedEmail,
    password: hashedPassword,
    is_mfa_enabled: false,
    mfa_secret: "",
    mfa_temp_secret: "",
    backup_codes: [],
    roles: [defaultRoleId],
  });

  await user.save();
  return user;
}

export async function findUserByEmail(email) {
  if (!email) return null;
  const normalizedEmail = String(email).toLowerCase().trim();
  return User.findOne({ email: normalizedEmail });
}

export async function findUserById(userId) {
  return User.findById(userId);
}

export async function validatePassword(candidatePassword, storedHash) {
  return bcrypt.compare(candidatePassword, storedHash);
}
