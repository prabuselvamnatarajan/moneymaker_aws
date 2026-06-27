const iamRoot = process.env.IAM_ROOT;
if (!iamRoot) {
  throw new Error("IAM_ROOT must be set");
}

const { jwtService } = await import(iamRoot);

export const {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} = jwtService;
