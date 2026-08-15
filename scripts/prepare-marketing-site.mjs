import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function copyDirectory(source, destination, extension) {
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(extension));

  await Promise.all(files.map((entry) => copyFile(
    path.join(source, entry.name),
    path.join(destination, entry.name),
  )));

  return files.length;
}

const videoCount = await copyDirectory(
  path.join(root, "docs", "videos"),
  path.join(root, "marketing-site", "media"),
  ".mp4",
);
const screenshotCount = await copyDirectory(
  path.join(root, "docs", "screenshots"),
  path.join(root, "marketing-site", "assets"),
  ".png",
);

console.log(`Prepared landing page with ${videoCount} videos and ${screenshotCount} screenshots.`);
