// Nexus Tracker - Alt1 app entry point
import * as a1lib from "alt1/base";
import { ACTIONS, ACTION_BY_ID, ITEMS, ItemId, SHIELD_COST, ShieldTier, classifyShield } from "./core/data";
import { Counts, NexusMessageCollector, parseChatEvent } from "./core/chatparse";
import { Tracker } from "./core/tracker";
import { BuffWatcher, darknessCasts } from "./core/buffwatch";
import { BuffTemplate, Settings, loadProfile, loadSettings, loadTemplates, saveProfile, saveSettings, saveTemplates } from "./core/storage";
import { BuffWatcherScreen, ChatWatcher, LoadedTemplate, buffMatches, cleanTemplate, drawBuff, imageToTemplate, templateToImage } from "./readers";
import type { Buff } from "alt1/buffs";
import { LiteOverlay, preloadLiteImages } from "./lite";
import { CooldownGuard, NEXUS_ITEMS, REPO_URL, VERSION } from "./core/data";

// Buff icons shipped with the app (exported from teach mode). Merged with the user's own.
const BUILTIN_TEMPLATES: BuffTemplate[] = require("./buffs/templates.json");

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const TICK_MS = 600;
const IGNORE = "__ignore";

// ---------------------------------------------------------------- state

const hasAlt1 = typeof window.alt1 != "undefined";
let settings: Settings = loadSettings();
let tracker: Tracker = makeTracker();
let userTemplates: BuffTemplate[] = loadTemplates();
let templates: LoadedTemplate[] = [];
rebuildTemplates();

const lite = new LiteOverlay({ ...settings.litePos });
lite.onMoved = pos => { settings.litePos = pos; saveSettings(settings); renderLiteControls(); };
preloadLiteImages();

const chat = new ChatWatcher();
const buffScreen = new BuffWatcherScreen();
const collector = new NexusMessageCollector(counts => onContents(counts));
const cooldownGuard = new CooldownGuard();
const buffWatcher = new BuffWatcher({
	shieldOn(level, isNew, why) {
		const tier = classifyShield(level, settings.nexus, settings.necroLevel);
		// a new activation costs runes, unless the same shield was already known to be up
		const activated = isNew && tracker.shield != tier;
		if (!activated) { tracker.debug(why + (isNew ? ", same shield already active: not charged" : "")); }
		tracker.setShield(tier, level, activated, Date.now(), why);
	},
	shieldOff(why) {
		tracker.debug(why);
		tracker.setShield(null, null, false);
	},
	cast(key, why, timer) {
		const def = ACTION_BY_ID[key];
		if (!def) { return; }
		if (key == "splitsoul" && !settings.countSplitSoul) {
			tracker.debug(`Split Soul buff seen, not counted ("Count Split Soul automatically" is off) (${why})`);
			return;
		}
		const ignored = cooldownGuard.check(key, Date.now());
		if (ignored) {
			tracker.debug(`${def.name} detected again, ${ignored} (${why})`);
			return;
		}
		if (key == "darkness") {
			// recasting Darkness adds 12 minutes; multicast fills it to 1 hour for 5x the runes
			const d = darknessCasts(timer.from, timer.to);
			if (d.casts > 1) {
				tracker.spend(key, { source: "auto", why, mult: d.casts, note: d.multicast ? "multicast" : `${d.casts} casts` });
				return;
			}
		}
		tracker.spend(key, { source: "auto", why });
	},
	conjuresSummoned(keys, why) {
		if (keys.length > 1) {
			// several conjures at once = Conjure Undead Army: 2 ectoplasm per conjure
			const names = keys.map(k => ACTION_BY_ID[k]?.name ?? k).join(", ");
			tracker.spend("conjurearmy", { mult: keys.length, source: "auto", note: names, why });
		} else {
			tracker.spend(keys[0], { source: "auto", why });
		}
	},
	conjuresExtended(keys, why) { lifeTransfer(Date.now(), "conjure timers went up: " + why); },
	note(text) { tracker.debug(text); },
}, new Set(ACTIONS.filter(a => a.group == "conjure" && a.hasBuff).map(a => a.id)));

/**
 * Life Transfer shows up twice: its chat message and the conjure timers going up.
 * Whichever is seen first counts; the other one within a few seconds is the same cast.
 */
let lastLifeTransfer = 0;
function lifeTransfer(now = Date.now(), why = "") {
	if (now - lastLifeTransfer < 5000) {
		tracker.debug(`Life Transfer seen again within 5s, same cast: ${why}`);
		return;
	}
	lastLifeTransfer = now;
	tracker.spend("lifetransfer", { source: "auto", why });
}

let prevUnknown: Buff[] = [];
let teachCandidate: Buff | null = null;
let emptyWarned: Partial<Record<ItemId, boolean>> = {};

function makeTracker() {
	return new Tracker(loadProfile(settings.profile), settings.thresholds, {
		onChange: () => { scheduleSave(); render(); },
		onLow: (item, count) => warnLow(item, count),
	});
}

function rebuildTemplates() {
	const all = [...BUILTIN_TEMPLATES, ...userTemplates];
	templates = all.map(templateToImage);
}

let saveTimer = 0;
const demoMode = !hasAlt1 && /demo/.test(location.search);
function scheduleSave() {
	if (saveTimer || demoMode) { return; }
	saveTimer = window.setTimeout(() => {
		saveTimer = 0;
		saveProfile(settings.profile, tracker.state);
	}, 500);
}

// ---------------------------------------------------------------- game reading

function onContents(counts: Counts) {
	tracker.sync(counts);
	emptyWarned = {};
}

function tick() {
	if (!hasAlt1 || !alt1.permissionPixel || !alt1.rsLinked) {
		render();
		return;
	}
	const now = Date.now();
	try {
		const read = chat.tick(now);
		for (const line of read.lines) {
			collector.feed(line, now);
			// abilities with no buff, recognised from their chat message (never from old history)
			if (!read.history && parseChatEvent(line) == "lifetransfer") { lifeTransfer(now, "chat message: " + line); }
		}
		collector.flush(now);
	} catch (e) { console.error("chat read failed", e); }

	try {
		const read = buffScreen.tick(templates, now);
		buffWatcher.update(read);
		handleUnknownBuffs(read.visible ? read.unknown : []);
	} catch (e) { console.error("buff read failed", e); }

	renderStatus();
	paintLite();
}

function paintLite() {
	if (!settings.lite || lite.isMoving) { return; }
	const shieldText = tracker.shield ? `${tracker.shield == "greater" ? "Greater" : "Lesser"} (${tracker.shieldLevel})` : null;
	lite.paint({
		nexus: settings.nexusItem,
		counts: tracker.state.counts,
		isLow: i => tracker.isLow(i),
		shield: shieldText,
		layout: settings.liteLayout,
		scale: settings.liteScale,
		background: settings.liteBackground,
	});
}

function renderLiteControls() {
	document.body.classList.toggle("lite", settings.lite);
	$("litebar").hidden = !settings.lite;
	$("btn-lite").textContent = settings.lite ? "Exit lite mode" : "Lite mode";
	$("btn-move").hidden = !settings.lite;
	$("btn-move").textContent = lite.isMoving ? "Place (Alt+1)" : "Move panel";
	if (settings.lite && hasAlt1 && !alt1.permissionOverlay) {
		$("litebar").textContent = "Lite mode needs the 'overlay' permission for this app in Alt1's settings.";
	}
}

/** Teach mode: offer new, unrecognised buffs to be named */
function handleUnknownBuffs(unknown: Buff[]) {
	if (settings.teach) {
		for (const b of unknown) {
			const wasThere = prevUnknown.some(p => buffMatches(b.buffer, p.buffer));
			if (!wasThere) {
				teachCandidate = b;
				renderTeach();
			}
		}
	}
	prevUnknown = unknown;
}

// ---------------------------------------------------------------- warnings

let audioCtx: AudioContext | null = null;
function beep(times = 2) {
	if (!settings.sound) { return; }
	try {
		audioCtx = audioCtx || new AudioContext();
		for (let i = 0; i < times; i++) {
			const osc = audioCtx.createOscillator();
			const gain = audioCtx.createGain();
			const t = audioCtx.currentTime + i * 0.22;
			osc.frequency.value = 880;
			gain.gain.setValueAtTime(0.0001, t);
			gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
			gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
			osc.connect(gain).connect(audioCtx.destination);
			osc.start(t);
			osc.stop(t + 0.2);
		}
	} catch (e) { }
}

function overlayMessage(text: string, color: number) {
	if (!hasAlt1 || !settings.overlay || !alt1.permissionOverlay) { return; }
	const x = Math.round(alt1.rsWidth / 2);
	const y = Math.round(alt1.rsHeight * 0.28);
	alt1.overLaySetGroup("nexustracker");
	alt1.overLayClearGroup("nexustracker");
	if (typeof alt1.overLayTextEx == "function") {
		alt1.overLayTextEx(text, color, 20, x, y, 6000, "", true, true);
	} else {
		alt1.overLayText(text, color, 20, x - text.length * 5, y, 6000);
	}
}

function warnLow(item: ItemId, count: number) {
	const name = ITEMS.find(i => i.id == item)!.name;
	const plural = item == "ecto" ? name : name + "s";
	overlayMessage(`Your nexus is running low on ${plural} (${count.toLocaleString()} left)`, a1lib.mixColor(255, 190, 70));
	beep(2);
}

function checkEmpty() {
	const c = tracker.state.counts;
	if (!c) { return; }
	for (const i of ITEMS) {
		if (c[i.id] == 0 && !emptyWarned[i.id]) {
			emptyWarned[i.id] = true;
			const plural = i.id == "ecto" ? i.name : i.name + "s";
			overlayMessage(`Your nexus has run out of ${plural}!`, a1lib.mixColor(255, 80, 70));
			beep(4);
		} else if (c[i.id] > 0) {
			emptyWarned[i.id] = false;
		}
	}
}

// ---------------------------------------------------------------- rendering

function ago(t: number) {
	const s = Math.round((Date.now() - t) / 1000);
	if (s < 60) { return "just now"; }
	const m = Math.round(s / 60);
	if (m < 60) { return `${m}m ago`; }
	const h = Math.round(m / 60);
	if (h < 48) { return `${h}h ago`; }
	return `${Math.round(h / 24)}d ago`;
}

function timeOfDay(t: number) {
	const d = new Date(t);
	return d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
}

function renderStatus() {
	$("st-chat").classList.toggle("ok", chat.found);
	$("st-buffs").classList.toggle("ok", buffScreen.found);
}

function render() {
	checkEmpty();
	renderStatus();
	const st = tracker.state;

	// install / permission banner
	const inst = $("install");
	if (!hasAlt1) {
		const url = new URL("./appconfig.json", document.location.href).href;
		inst.innerHTML = `Open this in Alt1 to track your nexus. <a href="alt1://addapp/${url}">Add to Alt1</a>`;
		inst.hidden = false;
	} else if (!alt1.permissionPixel) {
		inst.textContent = "Give this app the 'view screen' permission in Alt1's settings.";
		inst.hidden = false;
	} else if (!alt1.rsLinked) {
		inst.textContent = "Waiting for the RuneScape window...";
		inst.hidden = false;
	} else {
		inst.hidden = true;
	}

	// sync banner
	const sync = $("syncline");
	if (!st.counts) {
		sync.className = "banner warn";
		sync.textContent = "Right-click your nexus and choose 'Check contents' once to start tracking.";
	} else {
		sync.className = "banner good";
		sync.textContent = `${settings.profile} - last checked ${st.synced ? ago(st.synced) : "never"}. Check contents any time to re-sync.`;
	}

	// shield line
	const sl = $("shieldline");
	if (tracker.shield) {
		const cost = SHIELD_COST[tracker.shield];
		let left = Infinity;
		if (st.counts) {
			for (const k in cost) { left = Math.min(left, Math.floor(st.counts[k as ItemId] / cost[k as ItemId]!)); }
		}
		const name = tracker.shield == "greater" ? "Greater" : "Lesser";
		sl.innerHTML = `Bone Shield: <b class="${tracker.shield}">${name} (${tracker.shieldLevel})</b>` +
			(isFinite(left) ? ` - enough for ~${left.toLocaleString()} defensives` : "");
	} else {
		sl.textContent = "Bone Shield: off";
	}

	// items
	const items = $("items");
	items.innerHTML = "";
	for (const i of ITEMS) {
		const c = st.counts ? st.counts[i.id] : null;
		const el = document.createElement("div");
		el.className = "item" + (c == null ? " unknown" : c == 0 ? " empty" : tracker.isLow(i.id) ? " low" : "");
		el.innerHTML = `<img src="${i.icon}" alt=""><span class="name">${i.name}</span><span class="count">${c == null ? "?" : c.toLocaleString()}</span>`;
		items.appendChild(el);
	}

	// log
	const log = $("log");
	log.innerHTML = "";
	for (const e of st.log.filter(e => e.kind != "debug")) {
		const row = document.createElement("div");
		row.className = e.kind;
		row.innerHTML = `<span class="t">${timeOfDay(e.time)}</span>`;
		row.appendChild(document.createTextNode(e.text));
		log.appendChild(row);
	}
}

function renderTeach() {
	const panel = $("teach");
	if (!teachCandidate || !settings.teach) {
		panel.hidden = true;
		return;
	}
	panel.hidden = false;
	drawBuff($<HTMLCanvasElement>("teach-canvas"), teachCandidate.buffer);
	const sel = $<HTMLSelectElement>("teach-select");
	if (!sel.options.length) {
		for (const a of ACTIONS.filter(a => a.hasBuff)) {
			const o = document.createElement("option");
			o.value = a.id;
			o.textContent = a.name;
			sel.appendChild(o);
		}
	}
}

function renderManual() {
	const wrap = $("manual-buttons");
	wrap.innerHTML = "";
	const groups: [string, string][] = [["shield", "Bone Shield"], ["defensive", "Defensives (uses active shield)"], ["incantation", "Incantations"], ["conjure", "Conjures"]];
	for (const [g, label] of groups) {
		const h = document.createElement("div");
		h.className = "grp";
		h.textContent = label;
		wrap.appendChild(h);
		for (const a of ACTIONS.filter(a => a.group == g && a.manual !== false)) {
			const b = document.createElement("button");
			b.textContent = a.name;
			b.onclick = () => {
				if (a.group == "shield") {
					const tier: ShieldTier = a.id == "greaterboneshield" ? "greater" : "lesser";
					tracker.spend(a.id, { source: "manual" });
					if (!tracker.shield) { tracker.shield = tier; render(); }
				} else {
					tracker.spend(a.id, { source: "manual" });
				}
			};
			wrap.appendChild(b);
		}
	}
}

function renderSettings() {
	const prof = $<HTMLSelectElement>("set-profile");
	prof.innerHTML = "";
	for (const p of settings.profiles) {
		const o = document.createElement("option");
		o.value = o.textContent = p;
		prof.appendChild(o);
	}
	prof.value = settings.profile;
	$<HTMLSelectElement>("set-nexus").value = settings.nexusItem;
	$<HTMLSelectElement>("set-lite-layout").value = settings.liteLayout;
	$<HTMLSelectElement>("set-lite-scale").value = settings.liteScale + "";
	$<HTMLSelectElement>("set-lite-bg").value = settings.liteBackground;

	$<HTMLInputElement>("set-level").value = settings.necroLevel + "";
	$<HTMLInputElement>("set-overlay").checked = settings.overlay;
	$<HTMLInputElement>("set-sound").checked = settings.sound;
	$<HTMLInputElement>("set-teach").checked = settings.teach;
	$<HTMLInputElement>("set-splitsoul").checked = settings.countSplitSoul;

	const th = $("set-thresholds");
	th.innerHTML = "";
	for (const i of ITEMS) {
		const l = document.createElement("label");
		l.textContent = i.name;
		const inp = document.createElement("input");
		inp.type = "number";
		inp.min = "0";
		inp.value = settings.thresholds[i.id] + "";
		inp.onchange = () => {
			settings.thresholds[i.id] = Math.max(0, +inp.value || 0);
			tracker.thresholds = settings.thresholds;
			tracker.refreshLowFlags(false);
			saveSettings(settings);
			render();
		};
		l.appendChild(inp);
		th.appendChild(l);
	}

	const cnt = $("set-counts");
	cnt.innerHTML = "";
	for (const i of ITEMS) {
		const l = document.createElement("label");
		l.textContent = i.name;
		const inp = document.createElement("input");
		inp.type = "number";
		inp.min = "0";
		inp.value = tracker.state.counts ? tracker.state.counts[i.id] + "" : "";
		inp.onchange = () => tracker.setCount(i.id, +inp.value || 0);
		l.appendChild(inp);
		cnt.appendChild(l);
	}

	$("about").innerHTML = `Nexus Tracker v${VERSION} - <a href="${REPO_URL}" target="_blank">report a bug or read the guide</a>`;

	const tp = $("set-templates");
	tp.innerHTML = "";
	const learned = userTemplates.filter(t => t.action != IGNORE);
	if (!learned.length && !BUILTIN_TEMPLATES.length) {
		tp.innerHTML = `<span class="none">None yet - turn on teach mode and use your abilities.</span>`;
	}
	for (const t of BUILTIN_TEMPLATES) {
		const s = document.createElement("span");
		s.className = "tpl";
		s.textContent = (ACTION_BY_ID[t.action]?.name ?? t.action) + " (built in)";
		tp.appendChild(s);
	}
	learned.forEach(t => {
		const s = document.createElement("span");
		s.className = "tpl";
		s.textContent = ACTION_BY_ID[t.action]?.name ?? t.action;
		const del = document.createElement("button");
		del.textContent = "x";
		del.title = "Forget this buff";
		del.onclick = () => {
			userTemplates.splice(userTemplates.indexOf(t), 1);
			saveTemplates(userTemplates);
			rebuildTemplates();
			renderSettings();
		};
		s.appendChild(del);
		tp.appendChild(s);
	});
}

/** The whole log as plain text, oldest first, with the details used for diagnosing */
function logText() {
	const pad = (n: number) => n.toString().padStart(2, "0");
	const stamp = (t: number) => {
		const d = new Date(t);
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
	};
	const lines = [
		`Nexus Tracker v${VERSION} log - account "${settings.profile}", nexus ${settings.nexusItem}, Necromancy ${settings.necroLevel}`,
		`Current counts: ${tracker.state.counts ? ITEMS.map(i => `${i.name} ${tracker.state.counts![i.id]}`).join(", ") : "not synced"}`,
		"",
	];
	for (const e of tracker.state.log.slice().reverse()) {
		let line = `${stamp(e.time)}  ${e.kind == "debug" ? "  . " : ""}${e.text}`;
		if (e.why) { line += `\n                     why: ${e.why}`; }
		if (e.after && e.kind != "info") { line += `\n                     now: ${e.after}`; }
		lines.push(line);
	}
	return lines.join("\n");
}

// ---------------------------------------------------------------- UI events

function togglePanel(id: string) {
	for (const p of ["manual", "settings"]) {
		$(p).hidden = p == id ? !$(p).hidden : true;
	}
	if (id == "manual" && !$("manual").hidden) { renderManual(); }
	if (id == "settings" && !$("settings").hidden) { renderSettings(); }
}

function switchProfile(name: string) {
	saveProfile(settings.profile, tracker.state);
	settings.profile = name;
	if (!settings.profiles.includes(name)) { settings.profiles.push(name); }
	saveSettings(settings);
	const shield = tracker.shield, level = tracker.shieldLevel;
	tracker = makeTracker();
	tracker.shield = shield;
	tracker.shieldLevel = level;
	emptyWarned = {};
	renderSettings();
	render();
}

function bindUi() {
	$("btn-manual").onclick = () => togglePanel("manual");
	$("btn-settings").onclick = () => togglePanel("settings");
	$("btn-undo").onclick = () => tracker.undo();
	$("set-close").onclick = () => togglePanel("settings");

	$<HTMLSelectElement>("set-profile").onchange = e => switchProfile((e.target as HTMLSelectElement).value);
	$("set-profile-add").onclick = () => {
		const inp = $<HTMLInputElement>("set-profile-name");
		const name = inp.value.trim();
		if (name) { inp.value = ""; switchProfile(name); }
	};
	$<HTMLSelectElement>("set-nexus").onchange = e => {
		const item = NEXUS_ITEMS.find(n => n.id == (e.target as HTMLSelectElement).value)!;
		settings.nexusItem = item.id;
		settings.nexus = item.scale;
		saveSettings(settings);
		paintLite();
	};
	$<HTMLSelectElement>("set-lite-layout").onchange = e => { settings.liteLayout = (e.target as HTMLSelectElement).value as any; saveSettings(settings); paintLite(); };
	$<HTMLSelectElement>("set-lite-scale").onchange = e => { settings.liteScale = +(e.target as HTMLSelectElement).value || 1; saveSettings(settings); paintLite(); };
	$<HTMLSelectElement>("set-lite-bg").onchange = e => { settings.liteBackground = (e.target as HTMLSelectElement).value as any; saveSettings(settings); paintLite(); };
	$("btn-lite").onclick = () => {
		settings.lite = !settings.lite;
		saveSettings(settings);
		if (!settings.lite) {
			if (lite.isMoving) { lite.stopMove(false); }
			lite.hide();
		}
		renderLiteControls();
		paintLite();
	};
	$("btn-move").onclick = () => {
		if (lite.isMoving) { lite.stopMove(true); } else { lite.startMove(); }
		renderLiteControls();
	};
	$<HTMLInputElement>("set-level").onchange = e => {
		settings.necroLevel = Math.min(120, Math.max(1, +(e.target as HTMLInputElement).value || 120));
		saveSettings(settings);
	};
	$<HTMLInputElement>("set-splitsoul").onchange = e => { settings.countSplitSoul = (e.target as HTMLInputElement).checked; saveSettings(settings); };
	$<HTMLInputElement>("set-overlay").onchange = e => { settings.overlay = (e.target as HTMLInputElement).checked; saveSettings(settings); };
	$<HTMLInputElement>("set-sound").onchange = e => { settings.sound = (e.target as HTMLInputElement).checked; saveSettings(settings); if (settings.sound) { beep(1); } };
	$<HTMLInputElement>("set-teach").onchange = e => {
		settings.teach = (e.target as HTMLInputElement).checked;
		saveSettings(settings);
		if (!settings.teach) { teachCandidate = null; }
		renderTeach();
	};

	$("teach-save").onclick = () => {
		if (!teachCandidate) { return; }
		const action = $<HTMLSelectElement>("teach-select").value;
		userTemplates.push(imageToTemplate(action, cleanTemplate(teachCandidate.buffer)));
		saveTemplates(userTemplates);
		rebuildTemplates();
		teachCandidate = null;
		renderTeach();
		tracker.spend(action, { source: "auto" });//the buff we just learned was a real cast
	};
	$("teach-skip").onclick = () => {
		if (!teachCandidate) { return; }
		userTemplates.push(imageToTemplate(IGNORE, cleanTemplate(teachCandidate.buffer)));
		saveTemplates(userTemplates);
		rebuildTemplates();
		teachCandidate = null;
		renderTeach();
	};

	$("set-copylog").onclick = () => {
		const ta = $<HTMLTextAreaElement>("set-log");
		ta.value = logText();
		$("set-log-wrap").hidden = false;
		ta.focus();
		ta.select();
		let copied = false;
		try { copied = document.execCommand("copy"); } catch (e) { }
		$("set-log-hint").textContent = copied ? "Copied - paste it into a message or a text file." : "Select all the text above and copy it (Ctrl+C).";
	};
	$("set-export").onclick = () => {
		$("set-json-wrap").hidden = false;
		$("set-json-apply").hidden = true;
		const ta = $<HTMLTextAreaElement>("set-json");
		ta.value = JSON.stringify(userTemplates.filter(t => t.action != IGNORE));
		ta.select();
		try { document.execCommand("copy"); } catch (e) { }
	};
	$("set-import").onclick = () => {
		$("set-json-wrap").hidden = false;
		$("set-json-apply").hidden = false;
		const ta = $<HTMLTextAreaElement>("set-json");
		ta.value = "";
		ta.placeholder = "Paste exported buffs here";
		ta.focus();
	};
	$("set-json-apply").onclick = () => {
		try {
			const list = JSON.parse($<HTMLTextAreaElement>("set-json").value) as BuffTemplate[];
			for (const t of list) {
				if (t && t.action && t.b64 && t.w && t.h) { userTemplates.push(t); }
			}
			saveTemplates(userTemplates);
			rebuildTemplates();
			$("set-json-wrap").hidden = true;
			renderSettings();
		} catch (e) {
			alert("That doesn't look like an export from this app.");
		}
	};
}

// ---------------------------------------------------------------- start

function demo() {
	// browser preview with sample data (?demo)
	tracker.sync({ ecto: 41554, spirit: 26097, bone: 24789, flesh: 20568, miasma: 66632 }, Date.now() - 4 * 60000);
	tracker.setShield("greater", 60, true);
	tracker.spend("resonance");
	tracker.spend("splitsoul");
	tracker.setCount("miasma", 84);
}

function start() {
	if (hasAlt1) { alt1.identifyAppUrl("./appconfig.json"); }
	bindUi();
	if (demoMode) { demo(); }
	renderLiteControls();
	// save straight away if the app window is closed
	window.addEventListener("pagehide", () => { if (!demoMode) { saveProfile(settings.profile, tracker.state); } });
	render();
	setInterval(tick, TICK_MS);
	setInterval(render, 30000);//keeps the "last checked" time fresh
}

start();
