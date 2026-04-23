const express = require("express");
const mongoose = require("mongoose");
const config = require("./config");
const signupRoute = require("./routes/signup");
const loginRoute = require("./routes/login");
const mfaRoute = require("./routes/mfa");

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

if (require.main === module) {
  start();
}

module.exports = { app, start };
