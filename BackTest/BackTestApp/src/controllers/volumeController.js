import {
  listVolumes,
  listFiles,
  createDirectory,
  saveFile,
  getFilePath,
  archiveDirectory,
  deleteFile,
  deleteDirectory,
} from "../services/volumeService.js";

export async function getVolumesController(req, res, next) {
  try {
    const items = await listVolumes();
    res.status(200).json({ items });
  } catch (error) {
    next(error);
  }
}

export async function getVolumeFilesController(req, res, next) {
  try {
    const { volumeName } = req.params;
    const { path } = req.query;
    const items = await listFiles(volumeName, path);
    res.status(200).json({ items });
  } catch (error) {
    next(error);
  }
}

export async function createDirectoryController(req, res, next) {
  try {
    const { volumeName } = req.params;
    const { path, dirName } = req.body;
    const result = await createDirectory(volumeName, path, dirName);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function uploadFileController(req, res, next) {
  try {
    const { volumeName } = req.params;
    const { path } = req.body;
    if (!req.file) {
      return res.status(400).json({ message: "No file was uploaded" });
    }
    const result = await saveFile(volumeName, path, req.file);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function downloadFileController(req, res, next) {
  try {
    const { volumeName } = req.params;
    const { path } = req.query;
    const { targetPath, fileName } = await getFilePath(volumeName, path);
    res.download(targetPath, fileName);
  } catch (error) {
    next(error);
  }
}

export async function downloadDirectoryController(req, res, next) {
  try {
    const { volumeName } = req.params;
    const { path } = req.query;
    await archiveDirectory(volumeName, path, res);
  } catch (error) {
    next(error);
  }
}

export async function deleteFileController(req, res, next) {
  try {
    const { volumeName } = req.params;
    const { path } = req.body;
    const result = await deleteFile(volumeName, path);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function deleteDirectoryController(req, res, next) {
  try {
    const { volumeName } = req.params;
    const { path } = req.body;
    const result = await deleteDirectory(volumeName, path);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
