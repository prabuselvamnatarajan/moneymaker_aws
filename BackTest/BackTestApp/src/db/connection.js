import mongoose from "mongoose";

const MONGO_URI = process.env.MONGO_URI;
export const MONGO_DB = process.env.MONGO_DB || "BacktestApp";

const buildMongoUri = () => {
  // MONGO_URI will not contain a database part — always append `MONGO_DB`.
  if (!MONGO_URI) return `mongodb://localhost:27017/${MONGO_DB}`;
  const [base, query] = MONGO_URI.split('?');
  const cleanBase = base.replace(/\/+$/, '');
  const uriWithDb = `${cleanBase}/${MONGO_DB}`;
  return query ? `${uriWithDb}?${query}` : uriWithDb;
};

export const connectDB = async () => {
  const uri = buildMongoUri();
  try {
    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ MongoDB connected successfully");
    console.log(`Using MongoDB URI: ${uri}`);

    const iamRoot = process.env.IAM_ROOT;
    if (iamRoot) {
      try {
        const iamMongoosePath = iamRoot.replace('index.js', 'node_modules/mongoose/index.js');
        const iamMongoose = await import(iamMongoosePath);
        await iamMongoose.default.connect(uri, {
          useNewUrlParser: true,
          useUnifiedTopology: true,
        });
        console.log("✅ Connected IAM mongoose instance successfully");

        // Dynamically register Role and Permission models on the parent mongoose instance
        const iamRolePath = iamRoot.replace('index.js', 'models/role.js');
        const iamPermissionPath = iamRoot.replace('index.js', 'models/permission.js');
        
        const iamRoleModule = await import(iamRolePath);
        const iamPermissionModule = await import(iamPermissionPath);
        
        if (!mongoose.models.Permission) {
          mongoose.model("Permission", iamPermissionModule.default.schema);
          console.log("✅ Registered Permission schema on parent mongoose");
        }
        if (!mongoose.models.Role) {
          mongoose.model("Role", iamRoleModule.default.schema);
          console.log("✅ Registered Role schema on parent mongoose");
        }
      } catch (err) {
        console.warn("⚠️ Could not register/connect separate IAM mongoose:", err.message);
      }
    }
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  }
};
    