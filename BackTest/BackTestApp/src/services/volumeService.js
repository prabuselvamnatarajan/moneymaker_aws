import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import * as archiverPkg from "archiver";

const execAsync = promisify(exec);

function createArchiver(format, options) {
  const pkg = archiverPkg.default || archiverPkg;
  if (typeof pkg === "function") {
    return pkg(format, options);
  }
  if (typeof pkg.create === "function") {
    return pkg.create(format, options);
  }
  if (format === "zip" && pkg.ZipArchive) {
    return new pkg.ZipArchive(options);
  }
  throw new Error(`Unsupported archiver format: ${format}`);
}

// Function to resolve default shared directory safely
function getSharedDirRoot() {
  if (process.env.SHARED_DIR) return process.env.SHARED_DIR;
  if (fs.existsSync("/shared")) return "/shared";
  return path.join(process.cwd(), "shared");
}

// Standard known volume locations and environment overrides
const SYSTEM_VOLUMES = [
  { name: "backtest-data", path: getSharedDirRoot(), driver: "local" },
  { name: "shared-space", path: path.join(getSharedDirRoot(), "space"), driver: "local" },
  { name: "exported_stock_data", path: path.join(getSharedDirRoot(), "exported_stock_data"), driver: "local" },
  { name: "mongo1-data", path: "/var/lib/docker/volumes/moneymaker_mongo1-data/_data", driver: "local" },
  { name: "redis_data", path: "/var/lib/docker/volumes/moneymaker_redis_data/_data", driver: "local" },
];

/**
 * Dynamically list Docker volumes or system volume locations.
 */
export async function listVolumes() {
  const volumeMap = new Map();

  // Initialize with system default/configured volume locations
  for (const vol of SYSTEM_VOLUMES) {
    if (fs.existsSync(vol.path)) {
      try {
        const stats = await fs.promises.stat(vol.path);
        volumeMap.set(vol.name, {
          id: vol.name,
          name: vol.name,
          driver: vol.driver,
          mountpoint: vol.path,
          createdAt: stats.birthtime ? stats.birthtime.toISOString() : undefined,
        });
      } catch (err) {
        // Skip inaccessible path
      }
    }
  }

  // Attempt to query Docker CLI for Swarm / application volumes if docker command is available
  try {
    const { stdout } = await execAsync("docker volume ls --format '{\"name\":\"{{.Name}}\",\"driver\":\"{{.Driver}}\",\"scope\":\"{{.Scope}}\"}'");
    const lines = stdout.trim().split("\n");
    
    for (const line of lines) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.name) {
          // If we can inspect it to get actual mountpoint
          let mountpoint = `/var/lib/docker/volumes/${parsed.name}/_data`;
          try {
            const { stdout: inspectOut } = await execAsync(`docker volume inspect "${parsed.name}"`);
            const inspectData = JSON.parse(inspectOut);
            if (inspectData && inspectData[0] && inspectData[0].Mountpoint) {
              mountpoint = inspectData[0].Mountpoint;
            }
          } catch (e) {
            // Ignore inspect error, use default mountpoint pattern
          }

          if (fs.existsSync(mountpoint)) {
            volumeMap.set(parsed.name, {
              id: parsed.name,
              name: parsed.name,
              driver: parsed.driver || "local",
              mountpoint: mountpoint,
            });
          }
        }
      } catch (err) {
        // Skip malformed lines
      }
    }
  } catch (err) {
    // Docker CLI not available or insufficient permissions inside container — fallback to system volume map
  }

  // Ensure at least shared application volume is present if no volume exists
  if (volumeMap.size === 0) {
    const defaultShared = getSharedDirRoot();
    if (!fs.existsSync(defaultShared)) {
      await fs.promises.mkdir(defaultShared, { recursive: true });
    }
    volumeMap.set("backtest-data", {
      id: "backtest-data",
      name: "backtest-data",
      driver: "local",
      mountpoint: defaultShared,
    });
  }

  return Array.from(volumeMap.values());
}

/**
 * Resolve volume base path safely and validate against path traversal attack.
 */
export async function resolveVolumePath(volumeName, subPath = "") {
  if (!volumeName || typeof volumeName !== "string") {
    throw new Error("Volume name is required");
  }

  if (volumeName.includes("..") || volumeName.includes("/") || volumeName.includes("\\")) {
    throw new Error("Invalid volume name: Path traversal detected");
  }

  // Sanitize volumeName to prevent directory traversal in volume name itself
  const safeVolumeName = path.basename(volumeName);
  
  // Find volume base path
  const volumes = await listVolumes();
  const matchedVolume = volumes.find(v => v.name === safeVolumeName || v.id === safeVolumeName);
  
  let basePath;
  if (matchedVolume && fs.existsSync(matchedVolume.mountpoint)) {
    basePath = matchedVolume.mountpoint;
  } else {
    // Fallback path calculation based on process environment or shared volume root
    const rootShared = getSharedDirRoot();
    basePath = path.join(rootShared, safeVolumeName);
    if (!fs.existsSync(basePath)) {
      // Create missing volume folder inside root shared directory dynamically
      await fs.promises.mkdir(basePath, { recursive: true });
    }
  }

  const normalizedSubPath = path.normalize(subPath || "");
  const targetPath = path.resolve(basePath, normalizedSubPath);

  // Strict path traversal check: target path MUST be inside or equal to basePath
  const relative = path.relative(basePath, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid path: Path traversal detected");
  }

  if (!fs.existsSync(basePath)) {
    throw new Error(`Volume base path does not exist: ${basePath}`);
  }

  return { basePath, targetPath, relativePath: relative };
}

/**
 * List files and subdirectories inside a volume at any depth level.
 */
export async function listFiles(volumeName, subPath = "") {
  const { targetPath, relativePath } = await resolveVolumePath(volumeName, subPath);

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Path does not exist: ${subPath || "/"}`);
  }

  const stat = await fs.promises.stat(targetPath);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${subPath}`);
  }

  const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
  const items = [];

  for (const entry of entries) {
    const entryFullPath = path.join(targetPath, entry.name);
    const itemRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    
    try {
      const entryStat = await fs.promises.stat(entryFullPath);
      items.push({
        name: entry.name,
        path: itemRelPath,
        type: entry.isDirectory() ? "directory" : "file",
        size: entry.isDirectory() ? undefined : entryStat.size,
        modifiedAt: entryStat.mtime ? entryStat.mtime.toISOString() : undefined,
      });
    } catch (err) {
      // Skip inaccessible entries
    }
  }

  // Sort directories first, then files alphabetically
  items.sort((a, b) => {
    if (a.type === b.type) {
      return a.name.localeCompare(b.name);
    }
    return a.type === "directory" ? -1 : 1;
  });

  return items;
}

/**
 * Create a new directory inside a volume at any subfolder level.
 */
export async function createDirectory(volumeName, subPath = "", dirName) {
  if (!dirName || !dirName.trim()) {
    throw new Error("Directory name is required");
  }

  const normalizedDirName = path.normalize(dirName.trim());
  const { targetPath, basePath } = await resolveVolumePath(volumeName, subPath);

  const newDirPath = path.resolve(targetPath, normalizedDirName);
  
  // Re-verify path traversal on the new directory target path
  const relative = path.relative(basePath, newDirPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid directory name: Path traversal detected");
  }

  if (fs.existsSync(newDirPath)) {
    throw new Error(`Directory already exists: ${dirName}`);
  }

  await fs.promises.mkdir(newDirPath, { recursive: true });
  return { message: `Directory '${dirName}' created successfully`, path: relative };
}

/**
 * Save an uploaded file into a target directory in the volume.
 */
export async function saveFile(volumeName, subPath = "", file) {
  if (!file || !file.buffer || !file.originalname) {
    throw new Error("Invalid file upload data");
  }

  const sanitizedFileName = path.basename(file.originalname);
  const { targetPath, basePath } = await resolveVolumePath(volumeName, subPath);

  if (!fs.existsSync(targetPath)) {
    await fs.promises.mkdir(targetPath, { recursive: true });
  }

  const destPath = path.join(targetPath, sanitizedFileName);

  // Validate path safety
  const relative = path.relative(basePath, destPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid file path: Path traversal detected");
  }

  await fs.promises.writeFile(destPath, file.buffer);
  return { message: `File '${sanitizedFileName}' uploaded successfully`, path: relative };
}

/**
 * Get single file path for downloading.
 */
export async function getFilePath(volumeName, filePath) {
  if (!filePath) {
    throw new Error("File path is required");
  }

  const { targetPath } = await resolveVolumePath(volumeName, filePath);

  if (!fs.existsSync(targetPath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stat = await fs.promises.stat(targetPath);
  if (!stat.isFile()) {
    throw new Error(`Target path is not a file: ${filePath}`);
  }

  return { targetPath, fileName: path.basename(targetPath) };
}

/**
 * Stream directory zip archive for export.
 */
export async function archiveDirectory(volumeName, dirPath, res) {
  const { targetPath } = await resolveVolumePath(volumeName, dirPath);

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Directory not found: ${dirPath}`);
  }

  const stat = await fs.promises.stat(targetPath);
  if (!stat.isDirectory()) {
    throw new Error(`Target path is not a directory: ${dirPath}`);
  }

  const folderName = path.basename(targetPath) || volumeName;
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(folderName)}.zip"`);

  const archive = createArchiver("zip", { zlib: { level: 6 } });

  archive.on("error", (err) => {
    if (!res.headersSent) {
      res.status(500).json({ message: `Archive error: ${err.message}` });
    }
  });

  archive.pipe(res);
  archive.directory(targetPath, false);
  await archive.finalize();
}

/**
 * Delete a file inside a volume.
 */
export async function deleteFile(volumeName, filePath) {
  if (!filePath) {
    throw new Error("File path is required");
  }

  const { targetPath } = await resolveVolumePath(volumeName, filePath);

  if (!fs.existsSync(targetPath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stat = await fs.promises.stat(targetPath);
  if (stat.isDirectory()) {
    throw new Error(`Cannot delete directory as file: ${filePath}`);
  }

  await fs.promises.unlink(targetPath);
  return { message: `File deleted successfully` };
}

/**
 * Delete a directory inside a volume recursively.
 */
export async function deleteDirectory(volumeName, dirPath) {
  if (dirPath === undefined || dirPath === null) {
    throw new Error("Directory path is required");
  }

  const { targetPath, relativePath } = await resolveVolumePath(volumeName, dirPath);

  if (!dirPath || !relativePath || relativePath === "." || relativePath === "") {
    throw new Error("Cannot delete volume root directory");
  }

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Directory not found: ${dirPath}`);
  }

  const stat = await fs.promises.stat(targetPath);
  if (!stat.isDirectory()) {
    throw new Error(`Target path is not a directory: ${dirPath}`);
  }

  await fs.promises.rm(targetPath, { recursive: true, force: true });
  return { message: `Directory deleted successfully` };
}
