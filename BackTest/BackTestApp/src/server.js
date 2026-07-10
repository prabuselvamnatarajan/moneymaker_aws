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
  try {
    const { syncAllActiveSymbolsToRedis } = await import("./services/symbol.js");
    await syncAllActiveSymbolsToRedis();
    console.log("✅ Initial active symbols sync to Redis completed");
  } catch (err) {
    console.error("⚠️ Failed to perform initial active symbols sync to Redis:", err.message);
  }
  const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
  
  try {
    const { initWebSocketServer } = await import("./services/websocketService.js");
    initWebSocketServer(server);
    console.log("✅ WebSocket server initialized successfully");
  } catch (err) {
    console.error("⚠️ Failed to initialize WebSocket server:", err.message);
  }
});
