// Holds the nexus contents and applies costs. Pure logic, no Alt1 dependencies.
import { ACTION_BY_ID, Cost, ITEMS, ItemId, SHIELD_COST, ShieldTier, formatCost, scaleCost } from "./data";
import { Counts } from "./chatparse";

export interface LogEntry {
	time: number;
	text: string;
	/** amounts removed (positive numbers), used for undo */
	spent?: Cost;
	kind: "sync" | "spend" | "info";
}

export interface TrackerState {
	counts: Counts | null;
	/** timestamp of the last "Check contents" read */
	synced: number | null;
	log: LogEntry[];
}

export interface TrackerHooks {
	onChange?: () => void;
	/** fired once when an item drops below its warning threshold */
	onLow?: (item: ItemId, count: number) => void;
}

export function emptyState(): TrackerState {
	return { counts: null, synced: null, log: [] };
}

export class Tracker {
	shield: ShieldTier | null = null;
	shieldLevel: number | null = null;
	private lowFlags: Partial<Record<ItemId, boolean>> = {};

	constructor(public state: TrackerState, public thresholds: Record<ItemId, number>, public hooks: TrackerHooks = {}) {
		this.refreshLowFlags(false);
	}

	private addLog(e: LogEntry) {
		this.state.log.unshift(e);
		if (this.state.log.length > 60) { this.state.log.length = 60; }
	}

	/** Contents read from the chat box: this is the ground truth */
	sync(counts: Counts, now = Date.now()) {
		let drift = "";
		if (this.state.counts) {
			const diffs = ITEMS.map(i => ({ i, d: counts[i.id] - this.state.counts![i.id] })).filter(x => x.d != 0);
			if (diffs.length) {
				drift = " (corrected " + diffs.map(x => `${x.i.name.replace(" rune", "")} ${x.d > 0 ? "+" : ""}${x.d.toLocaleString()}`).join(", ") + ")";
			}
		}
		this.state.counts = { ...counts };
		this.state.synced = now;
		this.addLog({ time: now, kind: "sync", text: "Synced from Check contents" + drift });
		this.refreshLowFlags(true);
		this.hooks.onChange?.();
	}

	/** Manually set one item (settings panel) */
	setCount(item: ItemId, count: number) {
		if (!this.state.counts) { this.state.counts = { ecto: 0, spirit: 0, bone: 0, flesh: 0, miasma: 0 }; }
		this.state.counts[item] = Math.max(0, Math.round(count));
		this.refreshLowFlags(true);
		this.hooks.onChange?.();
	}

	/** Cost of an action in the current shield state, or null if it's free right now */
	costOf(actionId: string, mult = 1): Cost | null {
		const def = ACTION_BY_ID[actionId];
		if (!def) { return null; }
		if (def.group == "defensive") {
			if (!this.shield) { return null; }//real shield or no shield: free
			return scaleCost(SHIELD_COST[this.shield], mult);
		}
		return def.cost ? scaleCost(def.cost, mult) : null;
	}

	/** Record that an ability was used */
	spend(actionId: string, opts: { mult?: number, source?: string, now?: number, note?: string } = {}) {
		const def = ACTION_BY_ID[actionId];
		const now = opts.now ?? Date.now();
		const cost = this.costOf(actionId, opts.mult ?? 1);
		const label = def ? def.name : actionId;
		const extra = def?.group == "defensive" && this.shield ? ` (${this.shield == "greater" ? "Greater" : "Lesser"} Bone Shield)` : "";
		if (!cost) {
			this.addLog({ time: now, kind: "info", text: `${label}: no runes used` });
			this.hooks.onChange?.();
			return null;
		}
		if (this.state.counts) {
			for (const k in cost) {
				const id = k as ItemId;
				this.state.counts[id] = Math.max(0, this.state.counts[id] - cost[id]!);
			}
		}
		const detail = opts.note ? ` (${opts.note})` : opts.mult && opts.mult > 1 ? " x" + opts.mult : "";
		this.addLog({ time: now, kind: "spend", spent: cost, text: `${label}${extra}${detail}: -${formatCost(cost)}${opts.source == "manual" ? " (manual)" : ""}` });
		this.refreshLowFlags(true);
		this.hooks.onChange?.();
		return cost;
	}

	/** Reverse the most recent spend */
	undo() {
		const idx = this.state.log.findIndex(e => e.kind == "spend");
		if (idx == -1) { return false; }
		const e = this.state.log[idx];
		if (this.state.counts && e.spent) {
			for (const k in e.spent) { this.state.counts[k as ItemId] += e.spent[k as ItemId]!; }
		}
		this.state.log.splice(idx, 1);
		this.refreshLowFlags(false);
		this.hooks.onChange?.();
		return true;
	}

	/** Bone Shield buff changed (level from the buff bar, tier worked out by the caller) */
	setShield(tier: ShieldTier | null, level: number | null, activated: boolean, now = Date.now()) {
		const prev = this.shield;
		this.shield = tier;
		this.shieldLevel = level;
		if (activated && tier) {
			this.spend(tier == "greater" ? "greaterboneshield" : "lesserboneshield", { now });
		} else if (prev != tier) {
			this.hooks.onChange?.();
		}
	}

	isLow(item: ItemId) {
		const c = this.state.counts;
		return !!c && c[item] < this.thresholds[item];
	}

	refreshLowFlags(fire: boolean) {
		for (const i of ITEMS) {
			const low = this.isLow(i.id);
			if (low && !this.lowFlags[i.id] && fire) { this.hooks.onLow?.(i.id, this.state.counts![i.id]); }
			this.lowFlags[i.id] = low;
		}
	}
}
