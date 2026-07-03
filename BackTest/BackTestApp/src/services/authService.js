import { authService } from "../iam/index.js";

export const {
  createUser,
  findUserByEmail,
  findUserById,
  validatePassword,
} = authService;
