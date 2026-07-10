import User from "../models/user.js";

export const getMeController = async (req, res, next) => {
  try {
    const user = await User.findById(req.auth.userId).select("-password").populate("roles");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json({
      message: "Current user retrieved successfully",
      data: user
    });
  } catch (error) {
    next(error);
  }
};

export const updateMeController = async (req, res, next) => {
  try {
    const { name, username, email } = req.body;
    const userId = req.auth.userId;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (email && email.toLowerCase() !== user.email.toLowerCase()) {
      const emailExists = await User.findOne({ email: email.toLowerCase() });
      if (emailExists) {
        return res.status(409).json({ message: "Email is already taken" });
      }
      user.email = email.toLowerCase();
    }

    if (username && username !== user.username) {
      const usernameExists = await User.findOne({ username });
      if (usernameExists) {
        return res.status(409).json({ message: "Username is already taken" });
      }
      user.username = username;
    }

    if (name) user.name = name;

    await user.save();
    const updated = await User.findById(userId).select("-password").populate("roles");

    res.status(200).json({
      message: "Profile updated successfully",
      data: updated
    });
  } catch (error) {
    next(error);
  }
};

export const deleteMeController = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const user = await User.findByIdAndDelete(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json({
      message: "Account deleted successfully"
    });
  } catch (error) {
    next(error);
  }
};
