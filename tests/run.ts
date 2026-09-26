// Test suite: `npm test` (runs in node, reads the real in-game screenshots in tests/fixtures)
import * as a1lib from "alt1/base";
import BuffReader from "alt1/buffs";
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import { createChatReader, classifyBuffs, isRecentTimestamp, buffMatches, templateToImage, cleanTemplate, readBuffs } from "../src/readers";
import { NexusMessageCollector, parseLine, parseChatEvent, Counts } from "../src/core/chatparse";
import { classifyShield, CooldownGuard } from "../src/core/data";
import { Tracker, emptyState } from "../src/core/tracker";
import { BuffWatcher, BuffObservation, isTimerRefresh, isSameInstance } from "../src/core/buffwatch";
import { shortNumber, toAlt1Pixels, stampHaloText } from "../src/lite";

let failures = 0, passes = 0;
function check(name: string, cond: boolean, detail?: any) {
	if (cond) { passes++; console.log("  ok   " + name); }
	else { failures++; console.log("  FAIL " + name + (detail !== undefined ? " -> " + JSON.stringify(detail) : "")); }
}

// minimal PNG decoder (8-bit RGB/RGBA, non-interlaced) so tests need no npm packages
function loadPng(file: string): ImageData {
	const buf = fs.readFileSync(file);
	let i = 8, w = 0, h = 0, ctype = 0;
	const idat: Buffer[] = [];
	while (i < buf.length) {
		const len = buf.readUInt32BE(i);
		const type = buf.toString("ascii", i + 4, i + 8);
		const data = buf.subarray(i + 8, i + 8 + len);
		if (type == "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ctype = data[9]; if (data[8] != 8 || data[12] != 0) { throw new Error("unsupported png"); } }
		if (type == "IDAT") { idat.push(data); }
		i += 12 + len;
	}
	const bpp = ctype == 6 ? 4 : ctype == 2 ? 3 : 0;
	if (!bpp) { throw new Error("unsupported png colour type " + ctype); }
	const raw = zlib.inflateSync(Buffer.concat(idat));
	const out = new Uint8ClampedArray(w * h * 4);
	const stride = w * bpp;
	const prev = new Uint8Array(stride), cur = new Uint8Array(stride);
	for (let y = 0; y < h; y++) {
		const f = raw[y * (stride + 1)];
		for (let x = 0; x < stride; x++) {
			const v = raw[y * (stride + 1) + 1 + x];
			const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
			let p = 0;
			if (f == 1) { p = a; } else if (f == 2) { p = b; } else if (f == 3) { p = (a + b) >> 1; }
			else if (f == 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
			cur[x] = (v + p) & 255;
		}
		for (let x = 0; x < w; x++) {
			for (let k = 0; k < 3; k++) { out[(y * w + x) * 4 + k] = cur[x * bpp + k]; }
			out[(y * w + x) * 4 + 3] = bpp == 4 ? cur[x * bpp + 3] : 255;
		}
		prev.set(cur);
	}
	return new a1lib.ImageData(out, w, h);
}

const fixture = (f: string) => path.join(__dirname, "fixtures", f);

async function main() {
	await new Promise(r => setTimeout(r, 50));//let the lib's image promises resolve

	console.log("chat screenshot");
	{
		const img = loadPng(fixture("chat_nexus_contents.png"));
		const reader = createChatReader();
		const ref = new a1lib.ImgRefData(img);
		check("finds chat box", !!reader.find(ref));
		const lines = (reader.read(ref) || []).map(l => l.text);
		let result: Counts | null = null;
		const col = new NexusMessageCollector(c => result = c);
		lines.forEach(l => col.feed(l, 1000));
		col.flush(99999);
		check("reads all 5 items from chat", JSON.stringify(result) == JSON.stringify({ ecto: 41554, spirit: 26097, bone: 24789, flesh: 20568, miasma: 66632 }), { result, lines });
	}

	console.log("buff screenshots");
	for (const [file, level, tier] of [["buffs_greater_60.png", 60, "greater"], ["buffs_lesser_30.png", 30, "lesser"]] as const) {
		const img = loadPng(fixture(file));
		const br = new BuffReader();
		check(`${file}: finds buff bar`, !!br.find(new a1lib.ImgRefData(img)));
		const read = classifyBuffs(br.read(img) || [], []);
		check(`${file}: Bone Shield level ${level}`, read.shieldLevel == level, read.shieldLevel);
		check(`${file}: other buffs not mistaken for Bone Shield`, read.unknown.length == read.total - 1, { total: read.total, unknown: read.unknown.length });
		check(`${file}: classified ${tier}`, classifyShield(read.shieldLevel!, "standard", 120) == tier);
	}

	console.log("taught Invoke Death icon");
	{
		const tpl = templateToImage(require("../src/buffs/templates.json").find((t: any) => t.action == "invokedeath"));
		check("matches itself", buffMatches(tpl.img, cleanTemplate(tpl.img)));
		// same icon with different timer digits drawn in the corner
		const other = new a1lib.ImageData(new Uint8ClampedArray(tpl.img.data), 25, 25);
		for (let y = 13; y < 24; y++) { for (let x = 0; x < 14; x++) { const i = (y * 25 + x) * 4; other.data[i] = other.data[i + 1] = other.data[i + 2] = (x + y) % 3 ? 255 : 40; other.data[i + 3] = 255; } }
		check("still matches when the timer number changes", buffMatches(other, tpl.img));
		let wrong = 0;
		for (const f of ["buffs_greater_60.png", "buffs_lesser_30.png"]) {
			const img = loadPng(fixture(f)); const br = new BuffReader(); br.find(new a1lib.ImgRefData(img));
			const read = classifyBuffs(br.read(img) || [], [tpl]);
			wrong += read.buffs.length;
			check(`${f}: Bone Shield still found with tolerant matching`, read.shieldLevel != null);
		}
		check("Invoke Death icon not confused with other buffs in screenshots", wrong == 0, wrong);
	}

	console.log("flashing buffs and 3-row bars");
	{
		const img = loadPng(fixture("buffs_three_rows.png"));
		const br = new BuffReader();
		br.find(new a1lib.ImgRefData(img));
		br.pos!.maxhor = 9; br.pos!.maxver = 2;
		const buffs = readBuffs(br, img) || [];
		check("3-row bar: all 17 buffs read, including the flashing one in row 3", buffs.length == 17, buffs.length);
		const tpls = require("../src/buffs/templates.json").map(templateToImage);
		const r = classifyBuffs(buffs, tpls);
		check("3-row bar: Bone Shield 60 and Darkness recognised", r.shieldLevel == 60 && r.buffs.some(b => b.key == "darkness"), r.buffs);
		// a dimmed (flashing) copy of a built-in icon still matches
		const t = tpls.find((t: any) => t.action == "invokelordofbones").img;
		const dim = new a1lib.ImageData(new Uint8ClampedArray(t.data), t.width, t.height);
		for (let i = 0; i < dim.data.length; i += 4) { for (let c = 0; c < 3; c++) { dim.data[i + c] = Math.round(dim.data[i + c] * 0.55); } }
		check("flashing (dimmed) Lord of Bones icon still recognised", buffMatches(dim, t));
		const others = tpls.filter((x: any) => x.action != "invokelordofbones").some((x: any) => buffMatches(dim, x.img));
		check("dimmed icon doesn't match a different ability", !others);
	}
	check("buff back with timer where it left off = same cast", isSameInstance([4, 3], 1, 4));
	check("buff back with a reset timer = new cast", !isSameInstance([4, 3], 20, 4));
	check("stall press: timer 55 -> 60 is a recast", isTimerRefresh([56, 55, 60, 59]));

	console.log("built-in icons");
	{
		const all: any[] = require("../src/buffs/templates.json");
		const imgs = all.map(templateToImage);
		let clashes: string[] = [];
		for (const a of imgs) { for (const b of imgs) { if (a !== b && buffMatches(a.img, b.img)) { clashes.push(a.action + "~" + b.action); } } }
		check(`${imgs.length} built-in icons never match each other`, clashes.length == 0, clashes);
		check("each built-in icon matches itself", imgs.every(i => buffMatches(i.img, i.img)));
		for (const f of ["buffs_greater_60.png", "buffs_lesser_30.png"]) {
			const img = loadPng(fixture(f)); const br = new BuffReader(); br.find(new a1lib.ImgRefData(img));
			const read = classifyBuffs(br.read(img) || [], imgs);
			check(`${f}: no false matches, Bone Shield still found`, read.buffs.length == 0 && read.shieldLevel != null, read.buffs);
		}
	}

	console.log("lite mode numbers");
	for (const [n, want] of [[41554, "41,554"], [99999, "99,999"], [150000, "150k"], [123456, "123.5k"], [1234567, "1.23m"], [20000000, "20m"], [2147483647, "2.15b"], [0, "0"]] as [number, string][]) {
		check(`${n} -> ${want}`, shortNumber(n) == want, shortNumber(n));
	}

	console.log("lite overlay pixels");
	{
		// Alt1 draws any non-transparent pixel solid, so the panel must only use alpha 0 or 255
		const img = new a1lib.ImageData(new Uint8ClampedArray([1, 2, 3, 0, 1, 2, 3, 40, 1, 2, 3, 127, 1, 2, 3, 128, 1, 2, 3, 255]), 5, 1);
		const out = toAlt1Pixels(img);
		check("soft edges cut to fully transparent/opaque", [3, 7, 11, 15, 19].map(i => out.data[i]).join() == "0,0,0,255,255", out.data);
	}

	{
		// crisp text: a single text pixel becomes solid with a 1px outline all round
		const w = 5, h = 5;
		const out = new a1lib.ImageData(new Uint8ClampedArray(w * h * 4), w, h);
		const layer = new a1lib.ImageData(new Uint8ClampedArray(w * h * 4), w, h);
		layer.data.set([255, 255, 255, 200], (2 * w + 2) * 4);
		stampHaloText(out, layer);
		const opaque = [...Array(w * h).keys()].filter(p => out.data[p * 4 + 3] == 255).length;
		const centre = out.data[(2 * w + 2) * 4];
		check("halo text: letter pixel blended onto halo + 8 dark halo pixels, all solid", opaque == 9 && centre > 190 && centre < 210 && out.data[(1 * w + 1) * 4] == 8, { opaque, centre });
	}

	console.log("chat parsing");
	check("header", parseLine("[15:23:46] Your nexus contains:")?.kind == "header");
	check("max stack", JSON.stringify(parseLine("[01:02:03] - 2,147,483,647 x Miasma rune")) == JSON.stringify({ kind: "item", item: "miasma", count: 2147483647 }));
	check("no timestamp", (parseLine("- 12 x Ectoplasm") as any)?.count == 12);
	check("ignores other chat", parseLine("[15:23:24] You have correctly entered your PIN.") == null);
	check("ignores player chat with numbers", parseLine("[15:23:24] Bob: 5 x bone rune pls") == null);
	{
		let r: Counts | null = null;
		const c = new NexusMessageCollector(x => r = x);
		c.feed("Your nexus contains:", 0);
		c.feed("- 50 x Spirit rune", 10);
		c.flush(5000);
		check("unlisted items are 0", JSON.stringify(r) == JSON.stringify({ ecto: 0, spirit: 50, bone: 0, flesh: 0, miasma: 0 }), r);
		r = null;
		c.feed("- 50 x Spirit rune", 6000);
		c.flush(99999);
		check("item lines without header are ignored", r == null);
	}

	{
		const now = new Date(2026, 8, 26, 15, 24, 30);
		check("recent timestamp accepted", isRecentTimestamp("[15:23:46] - 5 x Bone rune", now));
		check("old timestamp rejected", !isRecentTimestamp("[14:23:46] - 5 x Bone rune", now));
		check("no timestamp rejected", !isRecentTimestamp("- 5 x Bone rune", now));
		check("midnight wrap", isRecentTimestamp("[23:59:30] x", new Date(2026, 8, 26, 0, 0, 30)));
	}

	check("Life Transfer chat message", parseChatEvent("[17:43:02] You sacrifice some life points to extend your link with spirits from the Underworld.") == "lifetransfer");
	check("other chat isn't an event", parseChatEvent("[17:40:24] You invoke power from spirits of the Underworld.") == null);
	{
		const img = loadPng(fixture("chat_life_transfer.png"));
		const reader = createChatReader();
		const ref = new a1lib.ImgRefData(img);
		reader.find(ref);
		const lines = (reader.read(ref) || []).map(l => l.text);
		check("Life Transfer read from chat screenshot", lines.some(l => parseChatEvent(l) == "lifetransfer"), lines);
	}

	console.log("shield classification");
	check("112 necro, 56 = greater", classifyShield(56, "standard", 112) == "greater");
	check("112 necro, 28 = lesser", classifyShield(28, "standard", 112) == "lesser");
	check("112 necro, 56 = greater even with level left at 120", classifyShield(56, "standard", 120) == "greater");
	check("Zemouregal 120: 45 = lesser", classifyShield(45, "zemouregal", 120) == "lesser");
	check("Zemouregal 120: 75 = greater", classifyShield(75, "zemouregal", 120) == "greater");

	console.log("tracker");
	{
		const lows: string[] = [];
		const t = new Tracker(emptyState(), { ecto: 10, spirit: 100, bone: 100, flesh: 10, miasma: 10 }, { onLow: i => lows.push(i) });
		t.sync({ ecto: 20, spirit: 115, bone: 200, flesh: 50, miasma: 50 });
		t.setShield("greater", 60, true);
		check("greater shield costs 10/10/5", t.state.counts!.spirit == 105 && t.state.counts!.bone == 190 && t.state.counts!.flesh == 45);
		t.spend("resonance");
		check("defensive with greater shield costs 10/10/5", t.state.counts!.spirit == 95 && t.state.counts!.flesh == 40);
		check("low warning fired once for spirit", lows.join() == "spirit", lows);
		t.spend("reflect");
		check("low warning not repeated", lows.join() == "spirit", lows);
		t.setShield("lesser", 30, true);
		t.spend("divert");
		check("lesser shield + defensive cost 5/5 each", t.state.counts!.spirit == 75 && t.state.counts!.flesh == 35);
		t.setShield(null, null, false);
		const before = t.state.counts!.spirit;
		t.spend("barricade");
		check("defensive without Bone Shield is free", t.state.counts!.spirit == before);
		t.spend("darkness");
		check("Darkness 40/20/10/5", t.state.counts!.spirit == 35 && t.state.counts!.miasma == 45);
		t.undo();
		check("undo restores last spend", t.state.counts!.spirit == 75 && t.state.counts!.miasma == 50);
		const lt = t.costOf("lifetransfer");
		check("Life Transfer costs 10 Spirit, 5 Bone, 2 Flesh, 1 Miasma", JSON.stringify(lt) == JSON.stringify({ spirit: 10, bone: 5, flesh: 2, miasma: 1 }), lt);
		t.spend("conjureskeleton", { mult: 2 });
		check("army conjure costs 2 ecto", t.state.counts!.ecto == 18);
		for (let k = 0; k < 20; k++) { t.spend("darkness"); }
		check("never goes below 0", t.state.counts!.spirit == 0);
		t.sync({ ecto: 1000, spirit: 1000, bone: 1000, flesh: 1000, miasma: 1000 });
		check("sync logs the correction", /corrected/.test(t.state.log[0].text), t.state.log[0].text);
	}

	console.log("cooldown guard");
	{
		const g = new CooldownGuard();
		check("first Split Soul counts", g.check("splitsoul", 0) == null);
		check("Split Soul again 5s later is ignored", g.check("splitsoul", 5000) != null);
		check("Split Soul 31s later counts", g.check("splitsoul", 31000) == null);
		check("Reflect 10s after Reflect ignored, 16s counts", g.check("reflect", 0) == null && g.check("reflect", 10000) != null && g.check("reflect", 16000) == null);
		check("Lord of Bones has no cooldown: never ignored", g.check("invokelordofbones", 0) == null && g.check("invokelordofbones", 1000) == null);
		check("different abilities don't block each other", g.check("resonance", 0) == null && g.check("divert", 100) == null);
	}

	console.log("buff watcher");
	{
		const ev: string[] = [];
		const w = new BuffWatcher({
			shieldOn: (l, n) => ev.push(`on${l}${n ? "!" : ""}`),
			shieldOff: () => ev.push("off"),
			cast: k => ev.push(`${k}x1`),
			conjuresSummoned: keys => ev.push(keys.length > 1 ? `army:${[...keys].sort().join("+")}` : `${keys[0]}x1`),
			conjuresExtended: keys => ev.push(`extended:${[...keys].sort().join("+")}`),
		}, new Set(["conjureskeleton", "conjurezombie", "conjureghost", "conjurephantom"]));
		const idle = (n: number, buffs: [string, number][] = []) => { for (let i = 0; i < n; i++) { w.update(o(30, buffs)); } };
		const o = (shield: number | null, buffs: [string, number][] = [], extra = 2): BuffObservation =>
			({ visible: true, shieldLevel: shield, buffs: buffs.map(([key, time]) => ({ key, time })), total: buffs.length + (shield ? 1 : 0) + extra });

		w.update(o(60)); w.update(o(60));
		check("shield already up at start is not charged", ev.join() == "on60", ev);
		w.update(o(60)); w.update(o(null)); w.update(o(null));
		check("shield off after 2 reads", ev.slice(-1)[0] == "off", ev);
		w.update(o(60));
		check("shield back within 3s is not charged (it was only hidden)", ev.slice(-1)[0] == "on60", ev);
		w.update(o(60)); w.update(o(null)); w.update(o(null));
		for (let i = 0; i < 6; i++) { w.update(o(null)); }
		w.update(o(60));
		check("shield toggled off and on again is charged", ev.slice(-1)[0] == "on60!", ev);
		w.update(o(30));
		check("single odd read ignored", ev.slice(-1)[0] == "on60!", ev);
		w.update(o(30));
		check("switch to lesser detected", ev.slice(-1)[0] == "on30!", ev);
		const n = ev.length;
		w.update({ visible: true, shieldLevel: null, buffs: [], total: 0 });//interface covered
		w.update({ visible: true, shieldLevel: null, buffs: [], total: 0 });
		w.update(o(30)); w.update(o(30)); w.update(o(30));
		check("covered buff bar doesn't re-charge the shield", ev.length == n, ev.slice(n));
		w.update(o(30, [["resonance", 6]]));
		check("taught buff appearing = cast", ev.slice(-1)[0] == "resonancex1", ev);
		w.update(o(30, [["resonance", 5]])); w.update(o(30, [["resonance", 4]]));
		check("same buff counting down is not recast", ev.slice(-1)[0] == "resonancex1" && ev.filter(e => e.startsWith("resonance")).length == 1, ev);
		// --- conjures ---
		w.update(o(30, [["conjureskeleton", 60], ["conjurezombie", 60], ["conjureghost", 60]]));
		idle(2, [["conjureskeleton", 59], ["conjurezombie", 59], ["conjureghost", 59]]);
		check("3 conjures at once = Undead Army of 3", ev.slice(-1)[0] == "army:conjureghost+conjureskeleton+conjurezombie", ev.slice(-2));
		let mark = ev.length;
		// Life Transfer: all timers extended, nothing new appears
		idle(1, [["conjureskeleton", 58], ["conjurezombie", 58], ["conjureghost", 58]]);
		idle(2, [["conjureskeleton", 70], ["conjurezombie", 70], ["conjureghost", 70]]);
		idle(3, [["conjureskeleton", 69], ["conjurezombie", 69], ["conjureghost", 69]]);
		check("timers extended = Life Transfer (once, not a re-summon)", ev.slice(mark).join() == "extended:conjureghost+conjureskeleton+conjurezombie", ev.slice(mark));
		// conjures run out (timers count down to the end, then the buffs go)
		idle(2, [["conjureskeleton", 1], ["conjurezombie", 1], ["conjureghost", 1]]);
		idle(6);
		mark = ev.length;
		// single conjure
		w.update(o(30, [["conjurephantom", 60]])); idle(3, [["conjurephantom", 59]]);
		check("single conjure = 1 conjure, not army", ev.slice(mark).join() == "conjurephantomx1", ev.slice(mark));
		// army while the phantom is still out: 3 new appear, phantom's timer resets in the same moment
		mark = ev.length;
		idle(2, [["conjurephantom", 41]]); idle(2, [["conjurephantom", 40]]);
		w.update(o(30, [["conjurephantom", 60], ["conjureskeleton", 60], ["conjurezombie", 60], ["conjureghost", 60]]));
		idle(4, [["conjurephantom", 59], ["conjureskeleton", 59], ["conjurezombie", 59], ["conjureghost", 59]]);
		check("army with one conjure already out = army of 4", ev.slice(mark).join() == "army:conjureghost+conjurephantom+conjureskeleton+conjurezombie", ev.slice(mark));
		// army where the conjures show up a read apart
		idle(6); mark = ev.length;
		w.update(o(30, [["conjureskeleton", 60], ["conjurezombie", 60]]));
		w.update(o(30, [["conjureskeleton", 60], ["conjurezombie", 60], ["conjureghost", 59]]));
		idle(3, [["conjureskeleton", 59], ["conjurezombie", 59], ["conjureghost", 58]]);
		check("army counted together even if one icon is a read late", ev.slice(mark).join() == "army:conjureghost+conjureskeleton+conjurezombie", ev.slice(mark));
		idle(6);

		// Lord of Bones used to stall combat: pressed every ~5s while its buff is still up
		{
			const before = ev.length;
			let t = 60;
			for (let press = 0; press < 5; press++) {
				for (let k = 0; k < 8; k++) { w.update(o(30, [["invokelordofbones", t]])); t = Math.max(0, t - (k % 2 ? 1 : 0)); }
				t = 60;//pressed again
			}
			const n = ev.slice(before).filter(e => e.startsWith("invokelordofbones")).length;
			check("Lord of Bones stalled 5 times = 5 casts", n == 5, ev.slice(before));
		}
		// a buff flashing out near the end and coming back isn't a new cast
		{
			const before = ev.length;
			w.update(o(30, [["reflect", 6]])); w.update(o(30, [["reflect", 5]])); w.update(o(30, [["reflect", 4]]));
			for (let k = 0; k < 5; k++) { w.update(o(30)); }//flashing: not recognised for 3s
			w.update(o(30, [["reflect", 1]]));
			check("Reflect flashing near the end isn't counted twice", ev.slice(before).filter(e => e.startsWith("reflect")).length == 1, ev.slice(before));
			for (let k = 0; k < 6; k++) { w.update(o(30)); }
		}

		// Invoke Death as reported: ~10s buff, number changing, occasionally not matched for a read or two
		const before = ev.length;
		const seq: (number | null)[] = [10, 10, 9, null, 8, 7, 1 /*misread 7*/, 6, null, null, 5, 4, 3, 2, 1];
		for (const t of seq) { w.update(o(30, t == null ? [] : [["invokedeath", t]])); }
		const ids = ev.slice(before).filter(e => e.startsWith("invokedeath"));
		check("Invoke Death counted once despite flicker + misread", ids.length == 1, ev.slice(before));
		check("misread '10' as '1' then '9' is not a recast", !isTimerRefresh([10, 1, 9, 8]));
		check("single stray high read is not a recast", !isTimerRefresh([5, 4, 13, 3]));
		check("real refresh from 7s to 60s", isTimerRefresh([7, 6, 60, 59]));
	}

	console.log(`\n${passes} passed, ${failures} failed`);
	process.exit(failures ? 1 : 0);
}
main();
