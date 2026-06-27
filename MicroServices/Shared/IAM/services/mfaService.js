import { authenticator } from "otplib";
import QRCode from "qrcode";
import User from "../models/user.js";
import * as config from "../config.js";

function generateBackupCodes(count = 8, length = 8) {
  const codes = [];
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  for (let i = 0; i < count; i += 1) {
    let code = "";
    for (let j = 0; j < length; j += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    codes.push(code);
  }
  return codes;
}

async function generateMfaSetup(user) {
  if (!user) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  if (user.is_mfa_enabled) {
    const error = new Error("MFA is already enabled for this user");
    error.statusCode = 400;
    throw error;
  }

  const tempSecret = authenticator.generateSecret();
  user.mfa_temp_secret = tempSecret;
  await user.save();

  const otpauthUrl = authenticator.keyuri(user.email, config.MFA_ISSUER, tempSecret);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

  return {
    otpauthUrl,
    qrCodeDataUrl,
    tempSecret,
  };
}

async function verifyMfaSetup(user, token) {
  if (!user) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  if (user.is_mfa_enabled) {
    const error = new Error("MFA is already enabled");
    error.statusCode = 400;
    throw error;
  }

  if (!user.mfa_temp_secret) {
    const error = new Error("MFA setup has not been initiated");
    error.statusCode = 400;
    throw error;
  }

  const isValid = authenticator.check(token, user.mfa_temp_secret);
  if (!isValid) {
    const error = new Error("Invalid MFA token");
    error.statusCode = 401;
    throw error;
  }

  user.mfa_secret = user.mfa_temp_secret;
  user.mfa_temp_secret = "";
  user.is_mfa_enabled = true;
  user.backup_codes = generateBackupCodes();
  await user.save();

  return { message: "MFA enabled successfully" };
}

async function verifyLoginMfa(email, token) {
  const normalizedEmail = String(email).toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail });
  if (!user) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  if (!user.is_mfa_enabled || !user.mfa_secret) {
    const error = new Error("MFA is not enabled for this user");
    error.statusCode = 400;
    throw error;
  }

  const isValid = authenticator.check(token, user.mfa_secret);
  if (!isValid) {
    const error = new Error("Invalid MFA token");
    error.statusCode = 401;
    throw error;
  }

  return user;
}

export { generateMfaSetup, verifyMfaSetup, verifyLoginMfa };
