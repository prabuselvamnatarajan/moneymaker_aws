const iamRoot = process.env.IAM_ROOT;
if (!iamRoot) {
  throw new Error("IAM_ROOT must be set");
}

const { setup, verifySetup, loginVerify } = await import(iamRoot);

export { setup, verifySetup, loginVerify };
