import express from "express";
import mongoose from "mongoose";
import * as config from "./config.js";
import signupRoute from "./routes/signup.js";
import loginRoute from "./routes/login.js";
import mfaRoute from "./routes/mfa.js";

const app = express();
app.use(express.json());
app.use("/auth", signupRoute);
app.use("/auth", loginRoute);
app.use("/auth", mfaRoute);

app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal server error";
  res.status(statusCode).json({ error: message });
});

async function start() {
  try {
    await mongoose.connect(config.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("Connected to MongoDB");
    app.listen(config.PORT, () => {
      console.log(`IAM service listening on port ${config.PORT}`);
    });
  } catch (error) {
    console.error("Failed to start IAM service", error);
    process.exit(1);
  }
}

export { app, start };
