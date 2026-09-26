// Builds docs/ (what GitHub Pages serves): bundles src/app.ts with esbuild and copies the static files.
//   npm install   (only needed once, installs esbuild)
//   npm run build
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "docs");
const local = path.join(root, "node_modules", ".bin", process.platform == "win32" ? "esbuild.cmd" : "esbuild");
const esbuild = process.env.ESBUILD || (fs.existsSync(local) ? local : "esbuild");

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
execFileSync(esbuild, [
	"src/app.ts", "--bundle", "--format=iife", "--target=chrome80",
	"--alias:alt1=./vendor/alt1",
	"--external:sharp", "--external:canvas", "--external:electron/common",
	"--outfile=docs/app.js", "--log-level=warning",
	...(process.argv.includes("--dev") ? ["--sourcemap"] : ["--minify"]),
], { cwd: root, stdio: "inherit", shell: process.platform == "win32" });

const copy = (from, to) => fs.cpSync(path.join(root, from), path.join(dist, to), { recursive: true });
copy("static", ".");
copy("src/index.html", "index.html");
copy("src/style.css", "style.css");
fs.writeFileSync(path.join(dist, ".nojekyll"), "");
console.log("built docs/");
