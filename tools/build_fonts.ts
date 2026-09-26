// Replacement for alt1/font-loader: turns every *.fontmeta.json + *.data.png pair
// in vendor/alt1/fonts into a ready-to-use *.font.js font definition module.
import * as OCR from "alt1/ocr";
import { ImageData } from "alt1/base";
import * as fs from "fs";
import * as path from "path";

const root = path.resolve(process.argv[2] || "vendor/alt1/fonts");

function walk(dir: string): string[] {
	return fs.readdirSync(dir).flatMap(f => {
		const p = path.join(dir, f);
		return fs.statSync(p).isDirectory() ? walk(p) : [p];
	});
}

(async () => {
	for (const file of walk(root).filter(f => f.endsWith(".fontmeta.json"))) {
		const meta = JSON.parse(fs.readFileSync(file, "utf8"));
		const imgmod = file.replace(/\.fontmeta\.json$/, ".data.png.js");
		const m = fs.readFileSync(imgmod, "utf8").match(/\((\d+),(\d+),"([^"]+)"\)/)!;
		const img = new ImageData(new Uint8ClampedArray(Buffer.from(m[3], "base64")), +m[1], +m[2]);
		const font = OCR.loadFontImage(img, meta);
		fs.writeFileSync(file.replace(/\.fontmeta\.json$/, ".font.js"), "module.exports=" + JSON.stringify(font) + ";\n");
		console.log("font", path.relative(root, file));
	}
})();
