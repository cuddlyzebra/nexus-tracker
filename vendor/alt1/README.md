Copy of the `base`, `ocr`, `chatbox` and `buffs` libraries from https://github.com/skillbert/alt1
(commit 02bf42fb9ec4296a532edbdb619082d8a854ed1d), converted so they bundle with plain esbuild:

- `*.data.png.js` hold the raw RGBA pixels of each `*.data.png` (replaces alt1/imagedata-loader)
- `*.font.js` hold the pre-built OCR font definitions (replaces alt1/font-loader)

To refresh from a newer alt1 checkout:

    python tools/prep_alt1.py <path-to-alt1-checkout>        (needs Pillow)
    npx esbuild tools/build_fonts.ts --bundle --platform=node --alias:alt1=./vendor/alt1 --external:sharp --external:canvas --external:electron/common --outfile=tools/.build_fonts.js
    node tools/.build_fonts.js vendor/alt1/fonts
