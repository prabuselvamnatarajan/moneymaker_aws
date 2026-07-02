import app from "./app.js";
import { connectDB } from "./db/connection.js";

const PORT = process.env.PORT || 4000;

connectDB().then(async () => {
  try {
    const { syncAllDeploymentsToRedis } = await import("./services/deployment.js");
    await syncAllDeploymentsToRedis();
    console.log("✅ Initial deployment sync to Redis completed");
  } catch (err) {
    console.error("⚠️ Failed to perform initial deployment sync to Redis:", err.message);
  }
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
});
