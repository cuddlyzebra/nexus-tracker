// Lite mode: a compact panel with the nexus contents drawn on the game screen as an Alt1
// overlay. Clicks go straight through it. Move it with the Move button + Alt+1.
//
// Alt1 overlays draw every pixel either fully or not at all (no partial transparency), so the
// panel is either a solid background or no background with outlined text over the game.
import * as a1lib from "alt1/base";
import { ITEMS, ItemId, NEXUS_ITEMS, NexusItem } from "./core/data";

const GROUP = "nexuslite";

export interface LiteData {
	nexus: NexusItem;
	counts: Record<ItemId, number> | null;
	isLow: (item: ItemId) => boolean;
	shield: string | null;
	layout: "vertical" | "horizontal";
	scale: number;
	background: LiteBackground;
}

export type LiteBackground = "solid" | "none";

// icons are loaded once and drawn onto a canvas
const images: Record<string, HTMLImageElement> = {};
function img(src: string) {
	if (!images[src]) {
		const i = new Image();
		i.src = src;
		images[src] = i;
	}
	return images[src];
}
export function preloadLiteImages() {
	for (const i of ITEMS) { img(i.icon); }
	for (const n of NEXUS_ITEMS) { img(n.icon); }
}

export function shortNumber(n: number) {
	// keep the panel narrow: up to 99,999 stays exact, bigger stacks are shortened
	const trim = (v: number, d: number) => v.toFixed(d).replace(/\.?0+$/, "");
	if (n < 100000) { return n.toLocaleString("en-US"); }
	if (n < 1e6) { return trim(n / 1e3, 1) + "k"; }
	if (n < 1e9) { return trim(n / 1e6, 2) + "m"; }
	return trim(n / 1e9, 2) + "b";
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

const BG = "rgb(18, 21, 28)";
const BORDER = "rgb(70, 78, 92)";

/** Draws the panel and returns it as pixels (every pixel fully opaque or fully transparent) */
export function renderLite(d: LiteData): ImageData {
	const s = d.scale;
	const icon = Math.round(24 * s);
	const font = Math.round(14 * s);
	const small = Math.round(12 * s);
	const pad = Math.round(6 * s);
	const gap = Math.round(5 * s);
	const nexusSize = Math.round(30 * s);
	const solid = d.background == "solid";
	const fontCss = (px: number) => `700 ${px}px "Segoe UI", Arial, sans-serif`;

	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d")!;
	ctx.font = fontCss(font);

	const labels = ITEMS.map(i => d.counts ? shortNumber(d.counts[i.id]) : "?");
	const labelW = labels.map(l => Math.ceil(ctx.measureText(l).width));
	const textW = Math.max(...labelW, ctx.measureText("00,000").width);
	const cellW = icon + gap + Math.ceil(textW);
	const rowH = Math.max(icon, font) + Math.round(3 * s);
	ctx.font = fontCss(small);
	const shieldW = d.shield ? Math.ceil(ctx.measureText(d.shield).width) : 0;
	const shieldH = d.shield ? Math.round(small * 1.2) : 0;

	let w: number, h: number;
	if (d.layout == "horizontal") {
		// each cell only as wide as its own number
		w = pad + nexusSize + gap * 2 + labelW.reduce((t, lw) => t + icon + gap + lw, 0) + (ITEMS.length - 1) * gap * 3 + pad;
		w = Math.max(w, pad + nexusSize + gap * 2 + shieldW + pad);
		h = pad + Math.max(nexusSize, rowH) + (shieldH ? shieldH + 2 : 0) + pad;
	} else {
		w = pad + Math.max(cellW, nexusSize + gap + shieldW) + pad;
		h = pad + nexusSize + gap + ITEMS.length * rowH + pad;
	}
	canvas.width = Math.ceil(w);
	canvas.height = Math.ceil(h);

	if (solid) {
		ctx.fillStyle = BG;
		roundRect(ctx, 0.5, 0.5, canvas.width - 1, canvas.height - 1, Math.round(5 * s));
		ctx.fill();
		ctx.strokeStyle = BORDER;
		ctx.lineWidth = 1;
		ctx.stroke();
	}

	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";
	ctx.textBaseline = "middle";

	// On a solid panel text is drawn straight on (its smooth edges blend into the panel).
	// With no background it goes on its own layer and gets a halo afterwards (stampHaloText).
	const tcv = document.createElement("canvas");
	tcv.width = canvas.width;
	tcv.height = canvas.height;
	const tctx = tcv.getContext("2d")!;
	tctx.textBaseline = "middle";
	const text = (t: string, x: number, y: number) => {
		const c = solid ? ctx : tctx;
		c.font = ctx.font;
		c.fillStyle = ctx.fillStyle;
		c.fillText(t, Math.round(x), Math.round(y));
	};

	const nexusIcon = img(NEXUS_ITEMS.find(n => n.id == d.nexus)!.icon);
	// icons go on the halo layer too when there's no panel, so their edges stay smooth
	tctx.imageSmoothingEnabled = true;
	tctx.imageSmoothingQuality = "high";
	const drawImg = (i: HTMLImageElement, x: number, y: number, size: number) => {
		if (i.complete && i.naturalWidth) { (solid ? ctx : tctx).drawImage(i, Math.round(x), Math.round(y), size, size); }
	};

	const colour = (item: ItemId) => {
		if (!d.counts) { return "#9aa3ad"; }
		if (d.counts[item] == 0) { return "#ff5a4e"; }
		if (d.isLow(item)) { return "#ffb347"; }
		return "#f4efe6";
	};

	if (d.layout == "horizontal") {
		const cy = Math.round(pad + Math.max(nexusSize, rowH) / 2);
		drawImg(nexusIcon, pad, cy - nexusSize / 2, nexusSize);
		let x = pad + nexusSize + gap * 2;
		ctx.font = fontCss(font);
		ITEMS.forEach((item, k) => {
			drawImg(img(item.icon), x, cy - icon / 2, icon);
			ctx.fillStyle = colour(item.id);
			text(labels[k], x + icon + gap, cy + 1);
			x += icon + gap + labelW[k] + gap * 3;
		});
		if (d.shield) {
			ctx.font = fontCss(small);
			ctx.fillStyle = "#c9b3ff";
			text(d.shield, pad + nexusSize + gap * 2, canvas.height - pad - shieldH / 2);
		}
	} else {
		drawImg(nexusIcon, pad, pad, nexusSize);
		if (d.shield) {
			ctx.font = fontCss(small);
			ctx.fillStyle = "#c9b3ff";
			text(d.shield, pad + nexusSize + gap, pad + nexusSize / 2 + 1);
		}
		ctx.font = fontCss(font);
		let y = pad + nexusSize + gap;
		ITEMS.forEach((item, k) => {
			drawImg(img(item.icon), pad, y + (rowH - icon) / 2, icon);
			ctx.fillStyle = colour(item.id);
			text(labels[k], pad + icon + gap, Math.round(y + rowH / 2) + 1);
			y += rowH;
		});
	}
	const out = ctx.getImageData(0, 0, canvas.width, canvas.height);
	if (!solid) { stampHaloText(out, tctx.getImageData(0, 0, tcv.width, tcv.height)); }
	return toAlt1Pixels(out);
}

/**
 * Alt1 draws any pixel that isn't fully transparent as solid, so soft edges (rounded corners,
 * text and icon anti-aliasing over nothing) are cut to either fully opaque or fully transparent.
 */
export function toAlt1Pixels(img: ImageData): ImageData {
	for (let i = 0; i < img.data.length; i += 4) {
		img.data[i + 3] = img.data[i + 3] >= 128 ? 255 : 0;
	}
	return img;
}

const HALO = [8, 9, 12];

/**
 * Text over the game with no panel. Alt1 can't blend soft text edges with the game, so each
 * letter gets a thin dark halo (the letter shape grown by 1px) that is fully drawn, and the
 * smooth letter is blended onto that halo. The result is only solid pixels, but the letters
 * keep their smooth edges and a neat dark outline.
 */
export function stampHaloText(out: ImageData, layer: ImageData) {
	const w = layer.width, h = layer.height;
	const ink = new Uint8Array(w * h);
	for (let i = 0; i < w * h; i++) { ink[i] = layer.data[i * 4 + 3] >= 24 ? 1 : 0; }
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const p = y * w + x, i = p * 4;
			let halo = !!ink[p];
			for (let dy = -1; dy <= 1 && !halo; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					const nx = x + dx, ny = y + dy;
					if (nx >= 0 && ny >= 0 && nx < w && ny < h && ink[ny * w + nx]) { halo = true; break; }
				}
			}
			if (!halo) { continue; }
			const a = layer.data[i + 3] / 255;
			for (let c = 0; c < 3; c++) { out.data[i + c] = Math.round(layer.data[i + c] * a + HALO[c] * (1 - a)); }
			out.data[i + 3] = 255;
		}
	}
}

export class LiteOverlay {
	private encoded = "";
	private width = 0;
	private height = 0;
	private lastKey = "";
	private moving = false;
	private moveEnd = 0;
	onMoved: ((pos: { x: number, y: number }) => void) | null = null;

	constructor(public pos: { x: number, y: number }) {
		a1lib.on("alt1pressed", () => { if (this.moving) { this.stopMove(true); } });
	}

	get isMoving() { return this.moving; }

	/** Redraw if anything changed, and keep the overlay on screen. Call every tick. */
	paint(d: LiteData) {
		if (!window.alt1 || !alt1.permissionOverlay) { return; }
		const key = JSON.stringify([d.nexus, d.counts, ITEMS.map(i => d.isLow(i.id)), d.shield, d.layout, d.scale, d.background,
			ITEMS.every(i => images[i.icon]?.complete)]);
		if (key != this.lastKey) {
			const data = renderLite(d);
			this.encoded = a1lib.encodeImageString(data);
			this.width = data.width;
			this.height = data.height;
			this.lastKey = key;
		}
		this.draw(1500);
	}

	private draw(time: number) {
		if (!this.encoded) { return; }
		// keep it inside the game window
		const x = Math.max(0, Math.min(this.pos.x, alt1.rsWidth - this.width));
		const y = Math.max(0, Math.min(this.pos.y, alt1.rsHeight - this.height));
		alt1.overLaySetGroup(GROUP);
		alt1.overLayFreezeGroup(GROUP);
		alt1.overLayClearGroup(GROUP);
		alt1.overLayImage(x, y, this.encoded, this.width, time);
		alt1.overLayRefreshGroup(GROUP);
	}

	hide() {
		if (!window.alt1) { return; }
		alt1.overLaySetGroup(GROUP);
		alt1.overLayClearGroup(GROUP);
		alt1.overLayRefreshGroup(GROUP);
		this.lastKey = "";
	}

	/** The panel follows the mouse until Alt+1 is pressed (or 30 seconds pass) */
	startMove() {
		if (!window.alt1) { return; }
		this.moving = true;
		this.moveEnd = Date.now() + 30000;
		const follow = () => {
			if (!this.moving) { return; }
			if (Date.now() > this.moveEnd) { this.stopMove(true); return; }
			const m = a1lib.getMousePosition();
			if (m) {
				this.pos = { x: Math.round(m.x - this.width / 2), y: Math.round(m.y - 8) };
				this.draw(300);
			}
			alt1.setTooltip("Nexus Tracker: press Alt+1 to place the panel here");
			requestAnimationFrame(follow);
		};
		follow();
	}

	stopMove(save: boolean) {
		this.moving = false;
		alt1.clearTooltip();
		if (save && this.onMoved) {
			const x = Math.max(0, Math.min(this.pos.x, alt1.rsWidth - this.width));
			const y = Math.max(0, Math.min(this.pos.y, alt1.rsHeight - this.height));
			this.pos = { x, y };
			this.onMoved(this.pos);
		}
	}
}
