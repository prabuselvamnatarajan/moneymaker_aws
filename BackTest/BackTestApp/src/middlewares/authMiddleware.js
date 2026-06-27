const iamRoot = process.env.IAM_ROOT;
if (!iamRoot) {
  throw new Error("IAM_ROOT must be set");
}

const { authenticate } = await import(iamRoot);

export { authenticate };
