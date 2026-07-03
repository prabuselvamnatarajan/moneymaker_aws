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
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  }
};