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

test("volumeService unit tests", async (t) => {
  await t.test("listVolumes should return an array of volumes", async () => {
    const volumes = await listVolumes();
    assert.ok(Array.isArray(volumes));
    assert.ok(volumes.length > 0);
    assert.ok(volumes[0].name);
    assert.ok(volumes[0].mountpoint);
  });

  await t.test("resolveVolumePath should prevent path traversal attacks", async () => {
    await assert.rejects(
      async () => {
        await resolveVolumePath("backtest-data", "../../etc/passwd");
      },
      (err) => {
        return err.message.includes("Path traversal detected");
      }
    );
  });

  await t.test("directory and file operations inside test volume", async () => {
    const testVolName = "backtest-data";
    const testSubDir = "unit-test-subfolder";

    // 1. Create a directory inside volume
    const mkdirRes = await createDirectory(testVolName, "", testSubDir);
    assert.ok(mkdirRes.message.includes("created successfully"));

    // 2. Save a file inside created directory
    const testFile = {
      originalname: "sample-data.txt",
      buffer: Buffer.from("Hello Docker Volume Management", "utf-8"),
    };
    const saveRes = await saveFile(testVolName, testSubDir, testFile);
    assert.ok(saveRes.message.includes("uploaded successfully"));

    // 3. List files inside testSubDir
    const items = await listFiles(testVolName, testSubDir);
    assert.ok(Array.isArray(items));
    assert.equal(items.length, 1);
    assert.equal(items[0].name, "sample-data.txt");
    assert.equal(items[0].type, "file");

    // 4. Get file path for downloading
    const fileRes = await getFilePath(testVolName, `${testSubDir}/sample-data.txt`);
    assert.ok(fs.existsSync(fileRes.targetPath));

    // 5. Delete file
    const delFileRes = await deleteFile(testVolName, `${testSubDir}/sample-data.txt`);
    assert.ok(delFileRes.message.includes("deleted successfully"));

    // 6. Delete directory
    const delDirRes = await deleteDirectory(testVolName, testSubDir);
    assert.ok(delDirRes.message.includes("deleted successfully"));
  });
});
