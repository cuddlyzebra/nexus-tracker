// Persistence in the app's localStorage. Everything is wrapped in try/catch so the app
// still runs (without remembering) if storage is unavailable.
import { ItemId, NexusItem, NexusType } from "./data";
import { TrackerState, emptyState } from "./tracker";

export interface Settings {
	nexus: NexusType;
	necroLevel: number;
	thresholds: Record<ItemId, number>;
	sound: boolean;
	overlay: boolean;
	teach: boolean;
	profile: string;
	profiles: string[];
	/** which nexus is worn (icon in lite mode); `nexus` is the Bone Shield scaling it implies */
	nexusItem: NexusItem;
	/** lite mode: compact see-through panel drawn on the game screen */
	lite: boolean;
	litePos: { x: number, y: number };
	liteLayout: "vertical" | "horizontal";
	liteScale: number;
	/** solid panel, or just outlined icons and numbers over the game */
	liteBackground: "solid" | "none";
	/** settings format version, used for one-time upgrades */
	version: number;
}

export const DEFAULT_SETTINGS: Settings = {
	nexus: "standard",
	necroLevel: 120,
	thresholds: { ecto: 1000, spirit: 1000, bone: 1000, flesh: 1000, miasma: 500 },
	sound: true,
	overlay: true,
	teach: false,
	profile: "Main",
	profiles: ["Main"],
	nexusItem: "deathwarden",
	lite: false,
	litePos: { x: 20, y: 120 },
	liteLayout: "vertical",
	liteScale: 1,
	liteBackground: "solid",
	version: 4,
};

/** A buff icon the user taught the app, stored as raw RGBA */
export interface BuffTemplate {
	action: string;
	w: number;
	h: number;
	b64: string;
}

const PREFIX = "nexustracker:v1:";

function get<T>(key: string, fallback: T): T {
	try {
		const s = localStorage.getItem(PREFIX + key);
		return s ? JSON.parse(s) : fallback;
	} catch (e) {
		return fallback;
	}
}

function set(key: string, value: any) {
	try {
		localStorage.setItem(PREFIX + key, JSON.stringify(value));
	} catch (e) { }
}

/** Warning levels used before 0.2. Saved settings still on these get the new defaults. */
const OLD_DEFAULT_THRESHOLDS = { ecto: 100, spirit: 500, bone: 500, flesh: 250, miasma: 100 };

export function loadSettings(): Settings {
	const s = get<Partial<Settings>>("settings", {});
	const saved = { ...(s.thresholds || {}) } as Record<ItemId, number>;
	if (!s.version || s.version < 2) {
		// one-time upgrade: move levels still on the old defaults to the new ones, keep any the user changed
		for (const k in OLD_DEFAULT_THRESHOLDS) {
			const id = k as ItemId;
			if (saved[id] === OLD_DEFAULT_THRESHOLDS[id]) { delete saved[id]; }
		}
	}
	const merged: Settings = { ...DEFAULT_SETTINGS, ...s, version: DEFAULT_SETTINGS.version, thresholds: { ...DEFAULT_SETTINGS.thresholds, ...saved } };
	if (!(s as any).liteBackground) {
		// 0.3 had an opacity slider; 0% meant no background
		merged.liteBackground = (s as any).liteOpacity === 0 ? "none" : "solid";
	}
	delete (merged as any).liteOpacity;
	// sizes changed in 0.4: an old "Small" (0.8) becomes Compact
	if (![0.85, 1, 1.25, 1.5].includes(merged.liteScale)) { merged.liteScale = 0.85; }
	if (!s.nexusItem) {
		// before 0.3 only the scaling was stored
		merged.nexusItem = s.nexus == "zemouregal" ? "zemouregal" : "deathwarden";
	}
	return merged;
}
export function saveSettings(s: Settings) { set("settings", s); }

export function loadProfile(name: string): TrackerState {
	return { ...emptyState(), ...get<Partial<TrackerState>>("profile:" + name, {}) };
}
export function saveProfile(name: string, state: TrackerState) { set("profile:" + name, state); }

export function loadTemplates(): BuffTemplate[] { return get<BuffTemplate[]>("bufftemplates", []); }
export function saveTemplates(t: BuffTemplate[]) { set("bufftemplates", t); }
