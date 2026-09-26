// Turns buff bar snapshots into events (shield toggled, ability cast).
// Pure logic: the Alt1 layer does the image matching and passes plain observations in.

export interface BuffObservation {
	/** false when the buff bar couldn't be read this tick (hidden, menu open, etc.) */
	visible: boolean;
	/** number shown on the Bone Shield buff, null if the buff isn't there */
	shieldLevel: number | null;
	/** recognised (taught) buffs: action id + remaining seconds (0 if no timer) */
	buffs: { key: string, time: number }[];
	/** total number of buffs on the bar, including ones we don't recognise */
	total: number;
}

export interface BuffEvents {
	/** shield appeared, or its level changed (switched lesser <-> greater) */
	shieldOn(level: number, isNewActivation: boolean): void;
	shieldOff(): void;
	/** a taught (non-conjure) buff appeared or had its timer refreshed */
	cast(key: string): void;
	/**
	 * Conjures summoned. More than one appearing together = Conjure Undead Army
	 * (conjures that were already out and got their timer reset in the same moment are included).
	 */
	conjuresSummoned(keys: string[]): void;
	/** conjure timers went up with no new conjure appearing = Life Transfer */
	conjuresExtended(keys: string[]): void;
}

/** Conjure events within this many reads of each other are grouped (Undead Army summons them together) */
const CONJURE_WINDOW = 2;

/** A taught buff has to be missing this many reads in a row (~2.4s) before it counts as gone */
const GONE_AFTER = 4;
/** Bone Shield has no timer text, so it's read reliably and can count as gone sooner */
const SHIELD_GONE_AFTER = 2;
/** If every buff vanishes at once it's probably the bar being covered; after this many reads accept it as real */
const BLIND_MAX = 10;
/** After a blind spell (buff bar hidden), this many reads just re-learn state without firing events */
const SETTLE_READS = 2;

export class BuffWatcher {
	private tick = 0;
	private settleUntil = SETTLE_READS;//also suppresses events on startup
	private shield: { level: number, lastSeen: number } | null = null;
	private shieldMissing = 0;
	private pendingLevel: number | null = null;
	private lastTotal = 0;
	private blindReads = 0;
	/** per taught buff: last read it was seen, and its recent timer values (newest last) */
	private seen = new Map<string, { lastSeen: number, times: number[] }>();
	/** conjure changes being grouped: which appeared, which had their timer go up, and when the last one happened */
	private conjureGroup: { appeared: Set<string>, extended: Set<string>, last: number } | null = null;

	constructor(private events: BuffEvents, private conjureKeys: Set<string>) { }

	update(obs: BuffObservation) {
		this.tick++;
		// all buffs (2+) disappearing in one read = interface covered, not buffs ending
		const suddenlyEmpty = obs.total == 0 && this.lastTotal >= 2 && this.blindReads < BLIND_MAX;
		if (!obs.visible || suddenlyEmpty) {
			this.blindReads++;
			this.settleUntil = this.tick + SETTLE_READS;
			return;
		}
		this.blindReads = 0;
		this.lastTotal = obs.total;
		const settling = this.tick <= this.settleUntil;

		// ---- Bone Shield ----
		if (obs.shieldLevel != null) {
			this.shieldMissing = 0;
			if (!this.shield) {
				this.shield = { level: obs.shieldLevel, lastSeen: this.tick };
				this.events.shieldOn(obs.shieldLevel, !settling);
			} else if (obs.shieldLevel != this.shield.level) {
				// switching shield type while one is active casts the other one.
				// require the new number twice in a row so a single misread can't trigger it
				if (this.pendingLevel == obs.shieldLevel) {
					this.shield.level = obs.shieldLevel;
					this.pendingLevel = null;
					this.events.shieldOn(obs.shieldLevel, !settling);
				} else {
					this.pendingLevel = obs.shieldLevel;
				}
			} else {
				this.pendingLevel = null;
			}
			this.shield.lastSeen = this.tick;
		} else if (this.shield) {
			this.shieldMissing++;
			if (this.shieldMissing >= SHIELD_GONE_AFTER) {
				this.shield = null;
				this.events.shieldOff();
			}
		}

		// ---- taught buffs ----
		for (const b of obs.buffs) {
			const prev = this.seen.get(b.key);
			const isNew = !prev || this.tick - prev.lastSeen > GONE_AFTER;
			const times = isNew ? [] : prev!.times;
			times.push(b.time);
			if (times.length > 4) { times.shift(); }
			this.seen.set(b.key, { lastSeen: this.tick, times });
			const refreshed = !isNew && isTimerRefresh(times);
			if (settling || !(isNew || refreshed)) { continue; }

			if (this.conjureKeys.has(b.key)) {
				const g = this.conjureGroup = this.conjureGroup || { appeared: new Set(), extended: new Set(), last: this.tick };
				(isNew ? g.appeared : g.extended).add(b.key);
				g.last = this.tick;
			} else {
				this.events.cast(b.key);
			}
		}

		// ---- conjures: wait a moment so ones summoned together are counted together ----
		const g = this.conjureGroup;
		if (g && this.tick - g.last >= CONJURE_WINDOW) {
			this.conjureGroup = null;
			if (g.appeared.size > 0) {
				// timers reset alongside new summons = those were re-summoned by the same Undead Army
				const all = new Set([...g.appeared, ...(g.appeared.size + g.extended.size > 1 ? g.extended : [])]);
				this.events.conjuresSummoned([...all]);
			} else if (g.extended.size > 0) {
				this.events.conjuresExtended([...g.extended]);
			}
		}
	}
}

/**
 * Timers only count down, so a timer that jumps up means the ability was cast again.
 * The last two reads must both be clearly above the two reads before them, so one
 * misread digit ("10" read as "1", or a stray high number) can't count as a recast.
 */
export function isTimerRefresh(times: number[]) {
	if (times.length < 4) { return false; }
	const [a, b, c, d] = times.slice(-4);
	if (!a || !b || !c || !d) { return false; }//0 = no timer text
	const before = Math.max(a, b);
	const slack = before >= 60 ? 0 : 5;//minute-precision timers ("2m") can only step up by a whole minute
	return c > before + slack && d > before + slack;
}
