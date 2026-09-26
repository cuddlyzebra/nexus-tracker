import * as a1lib from "alt1/base";
import * as OCR from "alt1/ocr";
import { webpackImages, ImgRef } from "alt1/base";

export type BuffTextTypes = "time" | "timearg" | "arg";

var imgs = webpackImages({
	buff: require("./imgs/buffborder.data.png.js"),
	debuff: require("./imgs/debuffborder.data.png.js")
});


// var font = require("./imgs/font_small_main.font.js");
let fonttemplate: ImageData;
let font: OCR.FontDefinition;
require("./imgs/font_small_main.data.png.js").then(img => {
	fonttemplate = img;
	font = OCR.loadFontImage(img, {
		"basey": 9,
		"spacewidth": 3,
		"treshold": 0.3,
		"color": [255, 255, 255],
		"unblendmode": "raw",
		"shadow": true,
		"chars": "0123456789m%hr.",
		"seconds": "."
	});
});

const buffsizes = {
	small: {
		buffsize: 27
	},
	// medium
	// large
}


function negmod(a: number, b: number) {
	return ((a % b) + b) % b;
}

function removeTextPixels(buffer: ImageData, font: OCR.FontDefinition, fontbuffer: ImageData, text: string, x: number, y: number) {
	for (let i = 0; i < text.length; i++) {
		let chr = text[i];
		if (chr == " ") {
			x += font.spacewidth;
			continue;
		}
		let chrobj = font.chars.find(c => c.chr == chr)!;
		for (let dy = 0; dy < fontbuffer.height - 1; dy++) {
			for (let dx = 0; dx < chrobj.width; dx++) {
				let fonti = fontbuffer.pixelOffset(chrobj.templatex + dx, dy);
				if (fontbuffer.data[fonti + 3] > 10) {
					let i = buffer.pixelOffset(x + dx, y + dy);
					buffer.data[i + 0] = 0;
					buffer.data[i + 1] = 0;
					buffer.data[i + 2] = 0;
					buffer.data[i + 3] = 0;
				}
			}
		}
		x += chrobj.width;
	}
}


function countMatch(img1: ImageData, img2: ImageData) {
	let tested = 0;
	let failed = 0;
	let skipped = 0;
	let passed = 0;

	var data1 = img1.data;
	var data2 = img2.data;
	//var debug = new ImageData(buffimg.width, buffimg.height);
	outer: for (var y = 0; y < img2.height; y++) {
		for (var x = 0; x < img2.width; x++) {
			var i1 = img1.pixelOffset(x, y);
			var i2 = img2.pixelOffset(x, y);

			//debug.data[i2] = 255; debug.data[i2 + 1] = debug.data[i2 + 2] = 0; debug.data[i2 + 3] = 255;
			if (data2[i2 + 3] != 255) { skipped++; continue; }//transparent buff pixel
			if (data1[i1] == 255 && data1[i1 + 1] == 255 && data1[i1 + 2] == 255) { skipped++; continue; }//white pixel - part of buff time text
			if (data1[i1] == 0 && data1[i1 + 1] == 0 && data1[i1 + 2] == 0) { skipped++; continue; }//black pixel - part of buff time text

			var d = a1lib.ImageDetect.coldif(data1[i1], data1[i1 + 1], data1[i1 + 2], data2[i2], data2[i2 + 1], data2[i2 + 2], 255);
			tested++;
			//debug.data[i2] = debug.data[i2 + 1] = debug.data[i2 + 2] = d * 10;
			if (d > 5) {
				//qw(pixelschecked); debug.show();
				failed++;
			}
			else {
				passed++;
			}
		}
	}
	//debug.show(); qw(pixelschecked);
	return { tested, failed, skipped, passed };
}

export class BuffInfo {
	imgdata: ImageData;
	isdebuff: boolean;

	buffid: string;
	final: boolean;
	canimprove: boolean;

	constructor(imgdata: ImageData, debuff: boolean, id: string, canimprove: boolean) {
		this.imgdata = imgdata;
		this.isdebuff = debuff;

		this.buffid = id;
		this.final = !!id && !canimprove;
		this.canimprove = canimprove;
	}
}


export class Buff {
	isdebuff: boolean;
	buffer: ImageData;
	lines: string[];
	constructor(buffer: ImageData, lines: string[], isdebuff: boolean) {
		this.buffer = buffer;
		this.lines = lines;
		this.isdebuff = isdebuff;
	}

	static fromImg(size: keyof typeof buffsizes, buffer: ImageData, bufferx: number, buffery: number, isdebuff: boolean) {
		// these should be args/context
		let buffsize = buffsizes[size].buffsize;

		// one pixel larger since the text might go outside the border
		let readimg = buffer.clone({ x: bufferx - 1, y: buffery - 1, width: buffsize + 2, height: buffsize + 2 });
		for (var y = 0; y < buffsize; y++) {
			//mask out the left and right edge of the border
			readimg.setPixel(1, y, 0, 0, 0, 0);
			readimg.setPixel(buffsize, y, 0, 0, 0, 0);
		}

		let buffimg = buffer.clone({ x: bufferx + 1, y: buffery + 1, width: buffsize - 2, height: buffsize - 2 });
		let lines: string[] = [];

		if (size == "small") {
			let textx = 2;
			let texty = 23;
			let res = OCR.readLine(readimg, font, [255, 255, 255], textx + 1, texty + 1, true, false);
			if (res.text) {
				removeTextPixels(buffimg, font, fonttemplate, res.text, res.debugArea.x - 2, res.debugArea.y - 2);
				lines.push(res.text);
			} else {
				// read wrapped text with other font
			}
		} else {
			throw new Error("unsupported buff size");
		}

		let buff = new Buff(buffimg, lines, isdebuff);
		return buff;
	}

	countMatch(template: ImageData) {
		return countMatch(this.buffer, template);
	}

	readArg(type: BuffTextTypes) {
		let lines = this.lines.slice();
		var r = { time: 0, arg: "" };
		if (type == "timearg" && lines.length > 1) { r.arg = lines.pop()!; }
		var str = lines.join("");
		if (type == "arg") {
			r.arg = str;
		} else {
			var m: RegExpMatchArray | null;
			if (m = str.match(/^(\d+)hr($|\s?\()/i)) { r.time = +m[1] * 60 * 60; }
			else if (m = str.match(/^(\d+)m($|\s?\()/i)) { r.time = +m[1] * 60; }
			else if (m = str.match(/^(\d+)($|\s?\()/)) { r.time = +m[1]; }
		}
		return r;
	}

	readTime() {
		return this.readArg("time").time;
	}

	compareBuffer(buffimg: ImageData) {
		return BuffReader.compareBuffer(this.buffer, buffimg);
	}
}


export default class BuffReader {
	pos: { x: number, y: number, maxhor: number, maxver: number } | null = null;
	debuffs = false;

	static buffsize = 27;
	static gridsize = 30;

	find(img?: ImgRef) {
		if (!img) { img = a1lib.captureHoldFullRs(); }
		if (!img) { return null; }
		var poslist = img.findSubimage(this.debuffs ? imgs.debuff : imgs.buff);
		if (poslist.length == 0) { return null; }
		type BuffPos = { n: number, x: number, y: number }
		var grids: BuffPos[] = [];
		for (var a in poslist) {
			var ongrid = false;
			for (var b in grids) {
				if (negmod(grids[b].x - poslist[a].x, BuffReader.gridsize) == 0 && negmod(grids[b].x - poslist[a].x, BuffReader.gridsize) == 0) {
					grids[b].x = Math.min(grids[b].x, poslist[a].x);
					grids[b].y = Math.min(grids[b].y, poslist[a].y);
					grids[b].n++;
					ongrid = true;
					break;
				}
			}
			if (!ongrid) { grids.push({ x: poslist[a].x, y: poslist[a].y, n: 1 }); }
		}
		var max = 0;
		var above2 = 0;
		var best: BuffPos | null = null;
		for (var a in grids) {
			console.log("buff grid [" + grids[a].x + "," + grids[a].y + "], n:" + grids[a].n);
			if (grids[a].n > max) { max = grids[a].n; best = grids[a]; }
			if (grids[a].n >= 2) { above2++; }
		}
		if (above2 > 1) { console.log("Warning, more than one possible buff bar location"); }
		if (!best) { return null; }
		this.pos = { x: best.x, y: best.y, maxhor: 5, maxver: 1 };
		return true;
	}
	getCaptRect() {
		if (!this.pos) { return null; }
		return new a1lib.Rect(this.pos.x, this.pos.y, (this.pos.maxhor + 1) * BuffReader.gridsize, (this.pos.maxver + 1) * BuffReader.gridsize);
	}
	read(buffer?: ImageData) {
		if (!this.pos) { throw new Error("no pos"); }
		var r: Buff[] = [];
		var rect = this.getCaptRect();
		if (!rect) { return null; }
		let dx = rect.x;
		let dy = rect.y;
		if (!buffer) {
			buffer = a1lib.capture(rect.x, rect.y, rect.width, rect.height);
			dx = 0;
			dy = 0;
		}
		var maxhor = 0;
		var maxver = 0;
		for (var ix = 0; ix <= this.pos.maxhor; ix++) {
			for (var iy = 0; iy <= this.pos.maxver; iy++) {
				var x = dx + ix * BuffReader.gridsize;
				var y = dy + iy * BuffReader.gridsize;

				//Have to require exact match here as we get transparency bs otherwise
				let borderimg = this.debuffs ? imgs.debuff : imgs.buff;
				if (x + borderimg.width > buffer.width || y + borderimg.height > buffer.height) { continue; }
				var match = buffer.pixelCompare(borderimg, x, y) == 0;
				if (!match) { break; }
				r.push(Buff.fromImg("small", buffer, x, y, this.debuffs));
				maxhor = Math.max(maxhor, ix);
				maxver = Math.max(maxver, iy);
			}
		}
		this.pos.maxhor = Math.max(5, maxhor + 2);
		this.pos.maxver = Math.max(1, maxver + 1);
		return r;
	}

	static compareBuffer(buffa: ImageData, buffb: ImageData) {
		var r = countMatch(buffa, buffb);
		if (r.failed > 0) { return false; }
		if (r.tested < 50) { return false; }
		return true;
	}

	static matchBuff(state: Buff[], buffimg: ImageData) {
		for (var a in state) {
			if (state[a].compareBuffer(buffimg)) { return state[a]; }
		}
		return null;
	}

	static matchBuffMulti(state: Buff[], buffinfo: BuffInfo) {
		if (buffinfo.final) {//cheap way if we known exactly what we're searching for
			return BuffReader.matchBuff(state, buffinfo.imgdata);
		}
		else {//expensive way if we are not sure the template is final
			var bestindex = -1;
			var bestscore = 0;
			if (buffinfo.imgdata) {
				for (var a = 0; a < state.length; a++) {
					var count = countMatch(state[a].buffer, buffinfo.imgdata);
					if (count.passed > bestscore) {
						bestscore = count.passed;
						bestindex = a;
					}
				}
			}
			if (bestscore < 50) { return null; }

			//update the isolated buff
			// if (buffinfo.canimprove) {
			// 	BuffReader.isolateBuffer(state[bestindex].buffer, buffinfo.imgdata);
			// }
			return state[bestindex];
		}
	}

	// static isolateBuffer(buffer: ImageData, ox: number, oy: number, buffimg: ImageData) {
	// 	var count = BuffReader.countMatch(buffer, ox, oy, buffimg);
	// 	if (count.passed < 50) { return; }

	// 	var removed = 0;
	// 	var data1 = buffer.data;
	// 	var data2 = buffimg.data;
	// 	//var debug = new ImageData(buffimg.width, buffimg.height);
	// 	for (var y = 0; y < buffimg.height; y++) {
	// 		for (var x = 0; x < buffimg.width; x++) {
	// 			var i1 = buffer.pixelOffset(ox + x, oy + y);
	// 			var i2 = buffimg.pixelOffset(x, y);

	// 			//debug.data[i2] = 255; debug.data[i2 + 1] = debug.data[i2 + 2] = 0; debug.data[i2 + 3] = 255;
	// 			if (data2[i2 + 3] != 255) { continue; }//transparent buff pixel
	// 			//==== new buffer has text on it ====
	// 			if (data1[i1] == 255 && data1[i1 + 1] == 255 && data1[i1 + 2] == 255 || data1[i1] == 0 && data1[i1 + 1] == 0 && data1[i1 + 2] == 0) {
	// 				continue;
	// 			}

	// 			//==== old buf has text on it, use the new one ====
	// 			if (data2[i2] == 255 && data2[i2 + 1] == 255 && data2[i2 + 2] == 255 || data2[i2] == 0 && data2[i2 + 1] == 0 && data2[i2 + 2] == 0) {
	// 				data2[i2 + 0] = data1[i1 + 0];
	// 				data2[i2 + 1] = data1[i1 + 1];
	// 				data2[i2 + 2] = data1[i1 + 2];
	// 				data2[i2 + 3] = data1[i1 + 3];
	// 				removed++;
	// 			}

	// 			var d = a1lib.ImageDetect.coldif(data1[i1], data1[i1 + 1], data1[i1 + 2], data2[i2], data2[i2 + 1], data2[i2 + 2], 255);
	// 			//debug.data[i2] = debug.data[i2 + 1] = debug.data[i2 + 2] = d * 10;
	// 			if (d > 5) {
	// 				//qw(pixelschecked); debug.show();
	// 				data2[i2 + 0] = data2[i2 + 1] = data2[i2 + 2] = data2[i2 + 3] = 0;
	// 				removed++;
	// 			}
	// 		}
	// 	}
	// 	//debug.show(); qw(pixelschecked);
	// 	if (removed > 0) { console.log(removed + " pixels remove from buff template image"); }
	// }



	// static matchBuffMulti(state: Buff[], buffinfo: BuffInfo) {
	// 	if (buffinfo.final) {//cheap way if we known exactly what we're searching for
	// 		return BuffReader.matchBuff(state, buffinfo.imgdata);
	// 	}
	// 	else {//expensive way if we are not sure the template is final
	// 		var bestindex = -1;
	// 		var bestscore = 0;
	// 		if (buffinfo.imgdata) {
	// 			for (var a = 0; a < state.length; a++) {
	// 				var count = BuffReader.countMatch(state[a].buffer, state[a].bufferx + 1, state[a].buffery + 1, buffinfo.imgdata, false);
	// 				if (count.passed > bestscore) {
	// 					bestscore = count.passed;
	// 					bestindex = a;
	// 				}
	// 			}
	// 		}
	// 		if (bestscore < 50) { return null; }

	// 		//update the isolated buff
	// 		if (buffinfo.canimprove) {
	// 			BuffReader.isolateBuffer(state[bestindex].buffer, state[bestindex].bufferx + 1, state[bestindex].buffery + 1, buffinfo.imgdata);
	// 		}
	// 		return state[bestindex];
	// 	}
	// }
}