// Alt1 screen readers: chat box (nexus contents) and buff bar (Bone Shield + taught buffs).
import * as a1lib from "alt1/base";
import * as OCR from "alt1/ocr";
import ChatBoxReader from "alt1/chatbox";
import BuffReader, { Buff } from "alt1/buffs";
import { BuffObservation } from "./core/buffwatch";
import { BuffTemplate } from "./core/storage";

const boneShieldImg: Promise<ImageData> = require("./imgs/boneshield.data.png.js");
let boneShieldTemplate: ImageData | null = null;
boneShieldImg.then(i => boneShieldTemplate = i);

// ---------------------------------------------------------------- chat

/**
 * The nexus lines start with "- " and the chat font treats "-" as a character that
 * can't start a line, so the stock reader stops after the timestamp. This nudge reads
 * the dash and the rest of the line.
 */
const leadingDashNudge = {
	match: /\] ?$/,
	name: "leadingdash",
	fn: (ctx: any) => {
		for (const col of ctx.colors) {
			const c = OCR.readChar(ctx.imgdata, ctx.font, col, ctx.rightx, ctx.baseliney, false, true);
			if (c?.chr != "-") { continue; }
			const dashend = ctx.rightx + c.basechar.width;
			for (let dx = 0; dx <= 8; dx++) {
				for (const col2 of ctx.colors) {
					const d = OCR.readLine(ctx.imgdata, ctx.font, col2, dashend + dx, ctx.baseliney, true, false);
					if (d.text) {
						ctx.addfrag({ color: col, index: -1, text: "- ", xstart: ctx.rightx, xend: dashend + dx });
						d.fragments.forEach((f: any) => ctx.addfrag(f));
						return true;
					}
				}
			}
		}
		return false;
	}
};

export function createChatReader() {
	const reader = new ChatBoxReader();
	// insert after the "timestampopen" and "badge" nudges, before the generic body read
	reader.forwardnudges.splice(2, 0, leadingDashNudge as any);
	return reader;
}

/** true if the line starts with a [hh:mm:ss] timestamp within 2 minutes of `now` (local time) */
export function isRecentTimestamp(text: string, now: Date) {
	const m = text.match(/^\s*\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]/);
	if (!m) { return false; }
	const t = (+m[1]) * 3600 + (+m[2]) * 60 + (+(m[3] || 0));
	const n = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
	const diff = Math.abs(n - t);
	return Math.min(diff, 86400 - diff) <= 120;
}

export class ChatWatcher {
	reader = createChatReader();
	found = false;
	private skipNext = false;
	private nextFind = 0;

	/**
	 * Returns the new chat lines since last call. `history` is true for the first read after
	 * the chat box is found: those lines were already there, so they may be used to sync
	 * counts but must not be counted as abilities being used now.
	 */
	tick(now = Date.now()): { lines: string[], history: boolean } {
		const none = { lines: [], history: false };
		if (!this.found) {
			if (now < this.nextFind) { return none; }
			this.nextFind = now + 3000;
			const pos = this.reader.find();
			if (!pos) { return none; }
			this.found = true;
			this.skipNext = true;
		}
		const lines = this.reader.read();
		if (!lines) {
			// chat box moved or hidden: search again
			this.found = false;
			return none;
		}
		const texts = lines.map(l => l.text);
		if (this.skipNext) {
			// Only keep history lines from the last couple of minutes, so an old
			// "Your nexus contains" message can't overwrite newer counts.
			this.skipNext = false;
			return { lines: texts.filter(t => isRecentTimestamp(t, new Date(now))), history: true };
		}
		return { lines: texts, history: false };
	}
}

// ---------------------------------------------------------------- buffs

export interface LoadedTemplate {
	action: string;
	img: ImageData;
}

export function templateToImage(t: BuffTemplate): LoadedTemplate {
	const bin = atob(t.b64);
	const arr = new Uint8ClampedArray(bin.length);
	for (let i = 0; i < bin.length; i++) { arr[i] = bin.charCodeAt(i); }
	return { action: t.action, img: new a1lib.ImageData(arr, t.w, t.h) };
}

export function imageToTemplate(action: string, img: ImageData): BuffTemplate {
	let bin = "";
	for (let i = 0; i < img.data.length; i++) { bin += String.fromCharCode(img.data[i]); }
	return { action, w: img.width, h: img.height, b64: btoa(bin) };
}

export interface BuffRead extends BuffObservation {
	/** buffs that aren't Bone Shield or a taught buff */
	unknown: Buff[];
}

/**
 * The timer/number on a buff is drawn in its bottom-left corner and changes every second.
 * Pixels there (plus the text's shadow) are ignored when matching icons.
 */
export function inTextArea(x: number, y: number) {
	return y >= 12 && x < 21;
}

/**
 * Tolerant buff icon comparison. Ignores the text corner, transparent template pixels and
 * pure white/black pixels (text and its outline), and allows a few odd pixels so a buff
 * isn't "lost" for a moment when its number changes.
 */
export function buffMatches(img: ImageData, template: ImageData) {
	let tested = 0, failed = 0;
	const w = Math.min(img.width, template.width), h = Math.min(img.height, template.height);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (inTextArea(x, y)) { continue; }
			const i1 = (y * img.width + x) * 4, i2 = (y * template.width + x) * 4;
			if (template.data[i2 + 3] != 255 || img.data[i1 + 3] != 255) { continue; }
			const r = img.data[i1], g = img.data[i1 + 1], b = img.data[i1 + 2];
			if ((r == 255 && g == 255 && b == 255) || (r == 0 && g == 0 && b == 0)) { continue; }
			const d = Math.abs(r - template.data[i2]) + Math.abs(g - template.data[i2 + 1]) + Math.abs(b - template.data[i2 + 2]);
			tested++;
			if (d > 24) { failed++; }
		}
	}
	if (tested >= 60 && failed <= tested * 0.03) { return true; }
	return dimmedMatch(img, template);
}

/**
 * Second chance for a buff that's flashing (about to run out): RuneScape dims the whole icon,
 * so compare it against the template darkened by the same amount.
 */
function dimmedMatch(img: ImageData, template: ImageData) {
	const w = Math.min(img.width, template.width), h = Math.min(img.height, template.height);
	let sumI = 0, sumT = 0;
	const px: number[] = [];
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (inTextArea(x, y)) { continue; }
			const i1 = (y * img.width + x) * 4, i2 = (y * template.width + x) * 4;
			if (template.data[i2 + 3] != 255 || img.data[i1 + 3] != 255) { continue; }
			const r = img.data[i1], g = img.data[i1 + 1], b = img.data[i1 + 2];
			if ((r == 255 && g == 255 && b == 255) || (r == 0 && g == 0 && b == 0)) { continue; }
			sumI += r + g + b;
			sumT += template.data[i2] + template.data[i2 + 1] + template.data[i2 + 2];
			px.push(i1, i2);
		}
	}
	if (px.length / 2 < 60 || sumT == 0) { return false; }
	const k = sumI / sumT;
	if (k < 0.35 || k > 0.97) { return false; }//not dimmed: the normal comparison already decided
	let failed = 0;
	for (let n = 0; n < px.length; n += 2) {
		const i1 = px[n], i2 = px[n + 1];
		const d = Math.abs(img.data[i1] - template.data[i2] * k) + Math.abs(img.data[i1 + 1] - template.data[i2 + 1] * k) + Math.abs(img.data[i1 + 2] - template.data[i2 + 2] * k);
		if (d > 30) { failed++; }
	}
	return failed <= (px.length / 2) * 0.05;
}

/** Copy of a buff image with the text corner blanked out, for saving as a template */
export function cleanTemplate(img: ImageData) {
	const out = new a1lib.ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
	for (let y = 0; y < img.height; y++) {
		for (let x = 0; x < img.width; x++) {
			if (inTextArea(x, y)) { out.data.fill(0, (y * img.width + x) * 4, (y * img.width + x) * 4 + 4); }
		}
	}
	return out;
}

export function isBoneShield(b: Buff) {
	return !!boneShieldTemplate && buffMatches(b.buffer, boneShieldTemplate);
}

/** Classify a set of buffs read from the screen (separate so it can be tested on screenshots) */
export function classifyBuffs(buffs: Buff[], templates: LoadedTemplate[]): BuffRead {
	const r: BuffRead = { visible: true, shieldLevel: null, buffs: [], unknown: [], total: buffs.length };
	for (const b of buffs) {
		if (isBoneShield(b)) {
			const n = parseInt(b.readArg("arg").arg, 10);
			if (n > 0 && n < 100) { r.shieldLevel = n; }
			continue;
		}
		const t = templates.find(t => buffMatches(b.buffer, t.img));
		if (t) { r.buffs.push({ key: t.action, time: b.readTime() }); }
		else { r.unknown.push(b); }
	}
	return r;
}

const buffBorder: Promise<ImageData> = require("alt1/buffs/imgs/buffborder.data.png.js");
let buffBorderImg: ImageData | null = null;
buffBorder.then(i => buffBorderImg = i);

/**
 * Is there a buff border at (x, y)? The stock reader needs an exact colour match, but RuneScape
 * fades buffs in and out when they're about to run out, which dims the green border. This
 * accepts an exact match, or a border whose pixels are all the same green, just dimmer.
 */
export function isBuffBorder(buffer: ImageData, border: ImageData, x: number, y: number) {
	if (x < 0 || y < 0 || x + border.width > buffer.width || y + border.height > buffer.height) { return false; }
	if (buffer.pixelCompare(border, x, y) == 0) { return true; }
	let total = 0, good = 0;
	for (let yy = 0; yy < border.height; yy++) {
		for (let xx = 0; xx < border.width; xx++) {
			const i2 = (yy * border.width + xx) * 4;
			if (border.data[i2 + 3] != 255) { continue; }
			total++;
			const i1 = ((y + yy) * buffer.width + x + xx) * 4;
			const r = buffer.data[i1], g = buffer.data[i1 + 1], b = buffer.data[i1 + 2];
			const br = border.data[i2], bg = border.data[i2 + 1], bb = border.data[i2 + 2];
			// same hue as the border (green well above red and blue), at 35-110% of its brightness
			const scale = g / bg;
			if (scale >= 0.35 && scale <= 1.1 && Math.abs(r - br * scale) <= 28 && Math.abs(b - bb * scale) <= 28) { good++; }
		}
	}
	return total > 0 && good >= total * 0.95;
}

/**
 * Same as BuffReader.read(), but uses the tolerant border check so buffs that are flashing
 * (about to run out) aren't skipped, which used to make them look gone and then "new" again.
 */
export function readBuffs(reader: BuffReader, buffer?: ImageData): Buff[] | null {
	const pos = reader.pos;
	if (!pos || !buffBorderImg) { return reader.read(buffer); }
	const rect = reader.getCaptRect();
	if (!rect) { return null; }
	let dx = rect.x, dy = rect.y;
	if (!buffer) {
		buffer = a1lib.capture(rect.x, rect.y, rect.width, rect.height)!;
		dx = 0; dy = 0;
	}
	if (!buffer) { return null; }
	const r: Buff[] = [];
	let maxhor = 0, maxver = 0;
	for (let ix = 0; ix <= pos.maxhor; ix++) {
		for (let iy = 0; iy <= pos.maxver; iy++) {
			const x = dx + ix * BuffReader.gridsize;
			const y = dy + iy * BuffReader.gridsize;
			if (!isBuffBorder(buffer, buffBorderImg, x, y)) { break; }
			r.push(Buff.fromImg("small", buffer, x, y, false));
			maxhor = Math.max(maxhor, ix);
			maxver = Math.max(maxver, iy);
		}
	}
	// always look a little past the last buff found, and start big enough for a full bar
	pos.maxhor = Math.max(9, maxhor + 2);
	pos.maxver = Math.max(2, maxver + 1);
	return r;
}

export class BuffWatcherScreen {
	reader = new BuffReader();
	found = false;
	private nextFind = 0;

	tick(templates: LoadedTemplate[], now = Date.now()): BuffRead {
		// An empty buff bar can't be located (find() looks for buff borders), so "not found"
		// is reported as an empty bar. BuffWatcher tells a covered bar apart from real expiry.
		const empty: BuffRead = { visible: true, shieldLevel: null, buffs: [], unknown: [], total: 0 };
		if (!this.found) {
			if (now < this.nextFind) { return empty; }
			this.nextFind = now + 1200;
			if (!this.reader.find()) { return empty; }
			this.found = true;
			// start with a grid big enough for a wide or 3-row bar instead of growing into it
			this.reader.pos!.maxhor = 9;
			this.reader.pos!.maxver = 2;
		}
		const buffs = readBuffs(this.reader);
		if (!buffs || buffs.length == 0) {
			// bar emptied, was covered or moved: locate it again
			this.found = false;
			this.nextFind = now + 600;
			return empty;
		}
		return classifyBuffs(buffs, templates);
	}
}

/** Draw a buff image onto a canvas (for the teach panel) */
export function drawBuff(canvas: HTMLCanvasElement, img: ImageData) {
	canvas.width = img.width;
	canvas.height = img.height;
	const ctx = canvas.getContext("2d")!;
	ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
}
