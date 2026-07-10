import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectDB } from "./connection.js";
import User from "../models/user.js";

const PermissionSchema = new mongoose.Schema({
  operation: { type: String, required: true },
  entity: { type: String, required: true },
  description: { type: String, default: "" }
}, { timestamps: true });

const RoleSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: { type: String, default: "" },
  permissions: [{ type: mongoose.Schema.Types.ObjectId, ref: "Permission" }],
  active: { type: Boolean, default: true }
}, { timestamps: true });

const Permission = mongoose.models.Permission || mongoose.model("Permission", PermissionSchema);
const Role = mongoose.models.Role || mongoose.model("Role", RoleSchema);

export const seedDB = async () => {
  try {
    console.log("🌱 Seeding database...");
    
    // 1. Create permissions
    const permissionsData = [
      { operation: "read", entity: "users", description: "Read user profiles" },
      { operation: "write", entity: "users", description: "Manage user profiles" },
      { operation: "read", entity: "accounts", description: "Read accounts" },
      { operation: "write", entity: "accounts", description: "Manage accounts" },
      { operation: "read", entity: "strategies", description: "Read strategies" },
      { operation: "write", entity: "strategies", description: "Manage strategies" },
      { operation: "read", entity: "symbols", description: "Read symbols" },
      { operation: "write", entity: "symbols", description: "Manage symbols" },
      { operation: "read", entity: "deployments", description: "Read deployments" },
      { operation: "write", entity: "deployments", description: "Manage deployments" },
      { operation: "read", entity: "trades", description: "Read trades" },
      { operation: "write", entity: "trades", description: "Execute trades" },
      { operation: "read", entity: "ledger", description: "Read ledger" }
    ];

    const seededPermissions = [];
    for (const p of permissionsData) {
      let perm = await Permission.findOne({ operation: p.operation, entity: p.entity });
      if (!perm) {
        perm = new Permission(p);
        await perm.save();
      }
      seededPermissions.push(perm);
    }
    console.log(`Created/found ${seededPermissions.length} permissions.`);

    // 2. Create roles
    let adminRole = await Role.findOne({ name: "admin" });
    if (!adminRole) {
      adminRole = new Role({
        name: "admin",
        description: "Administrator role",
        permissions: seededPermissions.map(p => p._id)
      });
      await adminRole.save();
    } else {
      adminRole.permissions = seededPermissions.map(p => p._id);
      await adminRole.save();
    }

    let userRole = await Role.findOne({ name: "user" });
    if (!userRole) {
      const userPerms = seededPermissions.filter(p => p.entity !== "users");
      userRole = new Role({
        name: "user",
        description: "Standard user role",
        permissions: userPerms.map(p => p._id)
      });
      await userRole.save();
    }
    console.log("Roles verified.");

    // 3. Create admin user
    const adminPassword = process.env.SEED_ADMIN_PASSWORD || "adminpassword123";
    const userPassword = process.env.SEED_USER_PASSWORD || "userpassword123";

    if (!process.env.SEED_ADMIN_PASSWORD || !process.env.SEED_USER_PASSWORD) {
      console.warn(
        "Using default seed passwords. Set SEED_ADMIN_PASSWORD and SEED_USER_PASSWORD in production."
      );
    }

    let adminUser = await User.findOne({ email: "admin@cobratrades.com" });
    if (!adminUser) {
      const hashedAdminPassword = await bcrypt.hash(adminPassword, 10);
      adminUser = new User({
        username: "admin",
        email: "admin@cobratrades.com",
        password: hashedAdminPassword,
        name: "Admin User",
        roles: [adminRole._id],
        is_active: true
      });
      await adminUser.save();
      console.log("Admin user created (admin@cobratrades.com).");
    }

    // 4. Create standard user
    let standardUser = await User.findOne({ email: "user@cobratrades.com" });
    if (!standardUser) {
      const hashedUserPassword = await bcrypt.hash(userPassword, 10);
      standardUser = new User({
        username: "standarduser",
        email: "user@cobratrades.com",
        password: hashedUserPassword,
        name: "Standard User",
        roles: [userRole._id],
        is_active: true
      });
      await standardUser.save();
      console.log("Standard user created (user@cobratrades.com).");
    }

    console.log("✅ Database seeding completed successfully!");
  } catch (error) {
    console.error("❌ Seeding failed:", error);
  }
};

if (process.argv[1] && process.argv[1].endsWith("seed.js")) {
  connectDB().then(async () => {
    await seedDB();
    process.exit(0);
  });
}
