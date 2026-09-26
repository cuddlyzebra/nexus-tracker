"""
Vendors the alt1 library (github.com/skillbert/alt1) into vendor/alt1 so the app
can be built with plain esbuild instead of webpack + custom loaders.

  *.data.png      -> *.data.png.js   (raw RGBA pixels, resolves to ImageData)
  *.fontmeta.json -> *.font.js       (generated later by tools/build_fonts.mjs)

Usage: python tools/prep_alt1.py <path-to-alt1-checkout>
"""
import base64, os, re, shutil, sys
from PIL import Image

src = os.path.join(sys.argv[1], "src")
dst = os.path.join(os.path.dirname(__file__), "..", "vendor", "alt1")
KEEP = ["base", "ocr", "chatbox", "buffs", "fonts"]

shutil.rmtree(dst, ignore_errors=True)
for k in KEEP:
    shutil.copytree(os.path.join(src, k), os.path.join(dst, k))

with open(os.path.join(dst, "rawimage.js"), "w") as f:
    f.write("""// Builds an ImageData from raw RGBA bytes (replacement for alt1/imagedata-loader)
const base = require("alt1/base");
module.exports = function (w, h, b64) {
\tconst bin = typeof atob == "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
\tconst arr = new Uint8ClampedArray(bin.length);
\tfor (let i = 0; i < bin.length; i++) { arr[i] = bin.charCodeAt(i); }
\treturn Promise.resolve(new base.ImageData(arr, w, h));
};
""")

count = 0
for root, _, files in os.walk(dst):
    for fn in files:
        p = os.path.join(root, fn)
        if fn.endswith(".data.png") and not fn.endswith(".fontmeta.json"):
            im = Image.open(p).convert("RGBA")
            b64 = base64.b64encode(im.tobytes()).decode()
            rel = "alt1/rawimage"
            with open(p + ".js", "w") as f:
                f.write(f'module.exports=require("{rel}")({im.width},{im.height},"{b64}");\n')
            count += 1
        elif fn.endswith(".ts"):
            s = open(p, encoding="utf-8-sig").read()
            s = re.sub(r'\.data\.png"\)', '.data.png.js")', s)
            s = re.sub(r'\.fontmeta\.json"\)', '.font.js")', s)
            open(p, "w", encoding="utf-8").write(s)
print(f"vendored alt1 -> {dst}, {count} images converted")

# app's own detection images (src/imgs/*.data.png)
appimgs = os.path.join(os.path.dirname(__file__), "..", "src", "imgs")
for fn in os.listdir(appimgs):
    if fn.endswith(".data.png"):
        im = Image.open(os.path.join(appimgs, fn)).convert("RGBA")
        b64 = base64.b64encode(im.tobytes()).decode()
        with open(os.path.join(appimgs, fn + ".js"), "w") as f:
            f.write(f'module.exports=require("alt1/rawimage")({im.width},{im.height},"{b64}");\n')
        print("app image", fn)
