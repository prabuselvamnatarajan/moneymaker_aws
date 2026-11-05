import mongoose from "mongoose";

export async function checkAdmin(userId) {
  const Role = mongoose.model("Role");
  const User = mongoose.model("User");
  // ⚡ Bolt Optimization: Use .lean() to bypass Mongoose Document instantiation overhead for read-only query
  const user = await User.findById(userId).lean();
  if (!user) return false;
  // ⚡ Bolt Optimization: Use .lean() to bypass Mongoose Document instantiation overhead for read-only query
  const roles = await Role.find({ _id: { $in: user.roles } }).lean();
  return roles.some((role) => role.name === "admin");
}
