// Bundles tests/run.ts with esbuild and runs it in node.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const local = path.join(root, "node_modules", ".bin", process.platform == "win32" ? "esbuild.cmd" : "esbuild");
const esbuild = process.env.ESBUILD || (fs.existsSync(local) ? local : "esbuild");
execFileSync(esbuild, ["tests/run.ts", "--bundle", "--platform=node", "--alias:alt1=./vendor/alt1", "--external:sharp", "--external:canvas", "--external:electron/common", "--outfile=tests/.run.js", "--log-level=warning"], { cwd: root, stdio: "inherit", shell: process.platform == "win32" });
execFileSync(process.execPath, [path.join(root, "tests/.run.js")], { cwd: root, stdio: "inherit" });
