const iamRoot = process.env.IAM_ROOT;
if (!iamRoot) {
  throw new Error("IAM_ROOT must be set");
}

const { authService } = await import(iamRoot);

export const {
  createUser,
  findUserByEmail,
  findUserById,
  validatePassword,
} = authService;
