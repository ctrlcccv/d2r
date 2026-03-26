import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const WEB_DIR = path.join(ROOT, "web");
const DIST_DIR = path.join(ROOT, "dist");
const SHARED_DIR = path.join(DIST_DIR, "shared");
const SOURCE_PRICING = path.join(ROOT, "src", "lib", "pricing.mjs");
const DIST_PRICING = path.join(SHARED_DIR, "pricing.mjs");

async function buildPages() {
  await fs.rm(DIST_DIR, { recursive: true, force: true });
  await fs.mkdir(DIST_DIR, { recursive: true });
  await fs.mkdir(SHARED_DIR, { recursive: true });

  const webEntries = await fs.readdir(WEB_DIR, { withFileTypes: true });
  for (const entry of webEntries) {
    const sourcePath = path.join(WEB_DIR, entry.name);
    const destPath = path.join(DIST_DIR, entry.name);

    if (entry.isDirectory()) {
      await fs.cp(sourcePath, destPath, { recursive: true });
      continue;
    }

    await fs.copyFile(sourcePath, destPath);
  }

  await fs.copyFile(SOURCE_PRICING, DIST_PRICING);
  await fs.writeFile(path.join(DIST_DIR, ".nojekyll"), "");
}

buildPages().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
