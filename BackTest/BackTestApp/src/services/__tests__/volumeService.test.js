import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import {
  listVolumes,
  resolveVolumePath,
  listFiles,
  createDirectory,
  saveFile,
  getFilePath,
  deleteFile,
  deleteDirectory,
} from "../volumeService.js";

test("volumeService unit & security edge cases", async (t) => {
  const testVolName = "backtest-data";

  // Cleanup leftover test directories for test idempotency
  const { basePath } = await resolveVolumePath(testVolName, "");
  ["dup-test-dir", "level1", "temp-zero-byte-folder", "temp-not-dir-folder", "temp-type-mismatch-folder", "symlink-test-folder"].forEach((dir) => {
    const p = path.join(basePath, dir);
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  });

  await t.test("listVolumes should return an array of volumes", async () => {
    const volumes = await listVolumes();
    assert.ok(Array.isArray(volumes));
    assert.ok(volumes.length > 0);
    assert.ok(volumes[0].name);
    assert.ok(volumes[0].mountpoint);
  });

  await t.test("Security: resolveVolumePath path traversal defenses", async () => {
    // 1. Relative parent directory traversal
    await assert.rejects(
      async () => {
        await resolveVolumePath(testVolName, "../../etc/passwd");
      },
      (err) => Boolean(err?.message?.includes("Path traversal detected"))
    );

    // 2. Deep nested traversal attempt
    await assert.rejects(
      async () => {
        await resolveVolumePath(testVolName, "subfolder/../../../etc/shadow");
      },
      (err) => Boolean(err?.message?.includes("Path traversal detected"))
    );

    // 3. Absolute path parameter
    await assert.rejects(
      async () => {
        await resolveVolumePath(testVolName, "/etc/passwd");
      },
      (err) => Boolean(err?.message?.includes("Path traversal detected"))
    );

    // 4. Volume name traversal attempt
    await assert.rejects(
      async () => {
        await resolveVolumePath("../etc", "somepath");
      },
      (err) => Boolean(err?.message?.includes("Path traversal detected") || err?.message?.includes("does not exist"))
    );

    // 5. Backslash path traversal attempt (Windows/cross-platform)
    await assert.rejects(
      async () => {
        await resolveVolumePath(testVolName, "..\\..\\etc\\passwd");
      },
      (err) => Boolean(err?.message?.includes("Path traversal detected"))
    );
  });

  await t.test("Security: saveFile and createDirectory path traversal defenses", async () => {
    // 1. saveFile with dangerous filename
    await assert.rejects(
      async () => {
        await saveFile(testVolName, "", {
          originalname: "../../../etc/bashrc",
          buffer: Buffer.from("malicious"),
        });
      },
      (err) => Boolean(err?.message?.includes("Path traversal detected"))
    );

    // 2. createDirectory with dangerous subfolder name
    await assert.rejects(
      async () => {
        await createDirectory(testVolName, "", "../../dangerous_dir");
      },
      (err) => Boolean(err?.message?.includes("Path traversal detected"))
    );
  });

  await t.test("Edge Case: Zero-byte file handling and empty folder operations", async () => {
    const tempDir = "temp-zero-byte-folder";
    await createDirectory(testVolName, "", tempDir);

    // Upload zero-byte file
    const emptyFile = { originalname: "empty.bin", buffer: Buffer.alloc(0) };
    await saveFile(testVolName, tempDir, emptyFile);

    const items = await listFiles(testVolName, tempDir);
    assert.equal(items.length, 1);
    assert.equal(items[0].name, "empty.bin");
    assert.equal(items[0].size, 0);

    const { targetPath, fileName } = await getFilePath(testVolName, `${tempDir}/empty.bin`);
    assert.equal(fileName, "empty.bin");
    assert.ok(fs.existsSync(targetPath));

    // Clean up
    await deleteFile(testVolName, `${tempDir}/empty.bin`);
    await deleteDirectory(testVolName, tempDir);
  });

  await t.test("Edge Case: Invalid or non-existent path reading", async () => {
    // Non-existent directory
    await assert.rejects(
      async () => {
        await listFiles(testVolName, "non_existent_folder_xyz_123");
      },
      (err) => Boolean(err?.message?.includes("Path does not exist"))
    );

    // Calling listFiles on a file path instead of directory
    const tempDir = "temp-not-dir-folder";
    await createDirectory(testVolName, "", tempDir);
    const testFile = { originalname: "file.txt", buffer: Buffer.from("data") };
    await saveFile(testVolName, tempDir, testFile);

    await assert.rejects(
      async () => {
        await listFiles(testVolName, `${tempDir}/file.txt`);
      },
      (err) => Boolean(err?.message?.includes("Path is not a directory"))
    );

    // Clean up temp
    await deleteFile(testVolName, `${tempDir}/file.txt`);
    await deleteDirectory(testVolName, tempDir);
  });

  await t.test("Edge Case: Type mismatch on download and deletion", async () => {
    const tempDir = "temp-type-mismatch-folder";
    await createDirectory(testVolName, "", tempDir);
    const testFile = { originalname: "file.txt", buffer: Buffer.from("data") };
    await saveFile(testVolName, tempDir, testFile);

    // 1. getFilePath on a directory should fail
    await assert.rejects(
      async () => {
        await getFilePath(testVolName, tempDir);
      },
      (err) => Boolean(err?.message?.includes("Target path is not a file") || err?.message?.includes("does not exist"))
    );

    // 2. deleteFile on a directory should fail
    await assert.rejects(
      async () => {
        await deleteFile(testVolName, tempDir);
      },
      (err) => Boolean(err?.message?.includes("Cannot delete directory as file"))
    );

    // 3. deleteDirectory on a file should fail
    await assert.rejects(
      async () => {
        await deleteDirectory(testVolName, `${tempDir}/file.txt`);
      },
      (err) => Boolean(err?.message?.includes("Target path is not a directory"))
    );

    // Clean up
    await deleteFile(testVolName, `${tempDir}/file.txt`);
    await deleteDirectory(testVolName, tempDir);
  });

  await t.test("Edge Case: Multi-level nested folder creation, upload & special characters", async () => {
    const deepLevel = "level1/level2/level3";
    const specialFileName = "special test #1 @2026.json";

    // 1. Create deep directory
    await createDirectory(testVolName, "", deepLevel);

    // 2. List empty deep directory
    const emptyItems = await listFiles(testVolName, deepLevel);
    assert.equal(emptyItems.length, 0);

    // 3. Upload file with special characters
    const file = { originalname: specialFileName, buffer: Buffer.from('{"status":"ok"}') };
    await saveFile(testVolName, deepLevel, file);

    // 4. List files inside deep directory
    const items = await listFiles(testVolName, deepLevel);
    assert.equal(items.length, 1);
    assert.equal(items[0].name, specialFileName);

    // 5. Clean up deep level recursively
    await deleteDirectory(testVolName, "level1");
  });

  await t.test("Edge Case: Duplicate directory creation & root deletion prevention", async () => {
    const dupDir = "dup-test-dir";
    await createDirectory(testVolName, "", dupDir);

    // Duplicate creation should fail
    await assert.rejects(
      async () => {
        await createDirectory(testVolName, "", dupDir);
      },
      (err) => Boolean(err?.message?.includes("Directory already exists"))
    );

    // Attempting to delete volume root directory should fail
    await assert.rejects(
      async () => {
        await deleteDirectory(testVolName, "");
      },
      (err) => Boolean(err?.message?.includes("Cannot delete volume root directory"))
    );

    // Clean up
    await deleteDirectory(testVolName, dupDir);
  });
});
