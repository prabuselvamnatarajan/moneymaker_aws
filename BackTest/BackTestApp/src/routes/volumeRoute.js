import express from "express";
import multer from "multer";
import { authenticate } from "../middlewares/authMiddleware.js";
import { isAdmin } from "../middlewares/adminMiddleware.js";
import {
  getVolumesController,
  getVolumeFilesController,
  createDirectoryController,
  uploadFileController,
  downloadFileController,
  downloadDirectoryController,
  deleteFileController,
  deleteDirectoryController,
} from "../controllers/volumeController.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB max single file upload
});

const router = express.Router();

// Require Authentication and Admin Privileges for all Docker Volume routes
router.use(authenticate);
router.use(isAdmin);

router.get("/", getVolumesController);
router.get("/:volumeName", getVolumeFilesController);
router.post("/:volumeName/directories", createDirectoryController);
router.post("/:volumeName/files", upload.single("file"), uploadFileController);
router.get("/:volumeName/download", downloadFileController);
router.get("/:volumeName/download-dir", downloadDirectoryController);
router.delete("/:volumeName/files", deleteFileController);
router.delete("/:volumeName/directories", deleteDirectoryController);

export default router;
