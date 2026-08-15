import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "/admin-app/",
  publicDir: path.resolve(currentDirectory, "..", "assets", "brand"),
  server: {
    port: 5173
  }
});
