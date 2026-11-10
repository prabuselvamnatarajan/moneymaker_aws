import mongoose from "mongoose";

const MONGO_URI = process.env.MONGO_URI;
export const MONGO_DB = process.env.MONGO_DB || "BacktestApp";

export const DEFAULT_MONGO_OPTIONS = {
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 5000,
  socketTimeoutMS: 20000,
};

export const buildMongoUri = (rawUri = process.env.MONGO_URI) => {
  const mongoDb = process.env.MONGO_DB || MONGO_DB;
  // MONGO_URI will not contain a database part — always append `MONGO_DB`.
  if (!rawUri) return `mongodb://localhost:27017/${mongoDb}`;
  const [base, query] = rawUri.split('?');
  const cleanBase = base.replace(/\/+$/, '');
  const uriWithDb = `${cleanBase}/${mongoDb}`;
  return query ? `${uriWithDb}?${query}` : uriWithDb;
};

export const connectDB = async ({
  retries = 30,
  delayMs = 2000,
  exitOnError = true,
  uri: overrideUri,
  options: overrideOptions,
} = {}) => {
  const uri = overrideUri || buildMongoUri();
  const options = { ...DEFAULT_MONGO_OPTIONS, ...overrideOptions };
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await mongoose.connect(uri, options);
      console.log("✅ MongoDB connected successfully");
      console.log(`Using MongoDB URI: ${uri}`);
      return mongoose.connection;
    } catch (err) {
      console.error(`❌ MongoDB connection attempt ${attempt}/${retries} failed:`, err.message);
      if (attempt === retries) {
        console.error("❌ All MongoDB connection attempts exhausted.");
        if (exitOnError) {
          process.exit(1);
        }
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
};
