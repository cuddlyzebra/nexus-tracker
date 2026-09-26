// Builds an ImageData from raw RGBA bytes (replacement for alt1/imagedata-loader)
const base = require("alt1/base");
module.exports = function (w, h, b64) {
	const bin = typeof atob == "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
	const arr = new Uint8ClampedArray(bin.length);
	for (let i = 0; i < bin.length; i++) { arr[i] = bin.charCodeAt(i); }
	return Promise.resolve(new base.ImageData(arr, w, h));
};
