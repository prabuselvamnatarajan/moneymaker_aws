const iamRoot = process.env.IAM_ROOT;
if (!iamRoot) {
  throw new Error("IAM_ROOT must be set");
}

const { signup, login } = await import(iamRoot);

export { signup, login };
