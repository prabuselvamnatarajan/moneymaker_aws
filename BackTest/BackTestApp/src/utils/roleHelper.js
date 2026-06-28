import mongoose from "mongoose";

export async function checkAdmin(userId) {
  const Role = mongoose.model("Role");
  const User = mongoose.model("User");
  const user = await User.findById(userId);
  if (!user) return false;
  const roles = await Role.find({ _id: { $in: user.roles } });
  return roles.some((role) => role.name === "admin");
}
