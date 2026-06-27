import bcrypt from "bcryptjs";
import User from "../models/user.js";

export async function createUser({ name, email, password }) {
  const normalizedEmail = String(email).toLowerCase().trim();
  const existingUser = await User.findOne({ email: normalizedEmail }).lean();
  if (existingUser) {
    const error = new Error("User already exists");
    error.statusCode = 409;
    throw error;
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = new User({
    name: String(name).trim(),
    email: normalizedEmail,
    password: hashedPassword,
    is_mfa_enabled: false,
    mfa_secret: "",
    mfa_temp_secret: "",
    backup_codes: [],
    roles: [],
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
