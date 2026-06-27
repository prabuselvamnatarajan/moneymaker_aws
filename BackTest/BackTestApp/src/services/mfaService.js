const iamRoot = process.env.IAM_ROOT;
if (!iamRoot) {
  throw new Error("IAM_ROOT must be set");
}

const { mfaService } = await import(iamRoot);

export const {
  generateMfaSetup,
  verifyMfaSetup,
  verifyLoginMfa,
} = mfaService;
