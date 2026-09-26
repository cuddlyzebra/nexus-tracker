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
	/** when this read was taken (ms); used to date the changes it reveals */
	at?: number;
}

export interface BuffEvents {
	/** shield appeared, or its level changed (switched lesser <-> greater) */
	shieldOn(level: number, isNewActivation: boolean, why: string): void;
	shieldOff(why: string): void;
	/** a taught (non-conjure) buff appeared or had its timer refreshed */
	/** `from` is the timer before (null for a brand new buff), `to` the timer now, in seconds */
	cast(key: string, why: string, timer: { from: number | null, to: number }): void;
	/**
	 * Conjures summoned. More than one appearing together = Conjure Undead Army
	 * (conjures that were already out and got their timer reset in the same moment are included).
	 */
	conjuresSummoned(keys: string[], why: string): void;
	/** conjure timers went up with no new conjure appearing = Life Transfer */
	conjuresExtended(keys: string[], why: string): void;
	/** diagnostic notes for the log (buff bar hidden, etc.) */
	note?(text: string): void;
}

/** Bone Shield back within this many reads (3s) = it was only hidden, not switched off and on */
const SHIELD_FLICKER_READS = 5;

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
/** reads happen every 0.6s; used to put gaps in seconds in the log */
const secs = (reads: number) => (reads * 0.6).toFixed(1) + "s";

export class BuffWatcher {
	private tick = 0;
	/** read time (ms) of recent reads, by read number */
	private readAt = new Map<number, number>();
	/**
	 * Roughly when the change behind the event being fired happened (ms). Set just before each
	 * event, so a handler can tell whether a cast happened before or after a Check contents.
	 */
	changeAt = 0;
	private settleUntil = SETTLE_READS;//also suppresses events on startup
	private shield: { level: number, lastSeen: number } | null = null;
	private shieldMissing = 0;
	private pendingLevel: number | null = null;
	/** read number when the Bone Shield buff was last seen before it went missing */
	private shieldGoneAt = 0;
	private lastTotal = 0;
	private blindReads = 0;
	/** per taught buff: last read it was seen, and its recent timer values (newest last) */
	private seen = new Map<string, { lastSeen: number, times: number[] }>();
	/** conjure changes being grouped: which appeared, which had their timer go up, and when the last one happened */
	private conjureGroup: { appeared: Set<string>, extended: Set<string>, last: number, whys: string[], at: number } | null = null;

	constructor(private events: BuffEvents, private conjureKeys: Set<string>) { }

	update(obs: BuffObservation) {
		this.tick++;
		const now = obs.at ?? Date.now();
		this.readAt.set(this.tick, now);
		this.readAt.delete(this.tick - 20);
		this.changeAt = now;
		// all buffs (2+) disappearing in one read = interface covered, not buffs ending
		const suddenlyEmpty = obs.total == 0 && this.lastTotal >= 2 && this.blindReads < BLIND_MAX;
		if (!obs.visible || suddenlyEmpty) {
			if (this.blindReads == 0) { this.events.note?.(`Buff bar hidden or covered (${this.lastTotal} buffs vanished at once)`); }
			this.blindReads++;
			this.settleUntil = this.tick + SETTLE_READS;
			return;
		}
		if (this.blindReads > 0) { this.events.note?.(`Buff bar visible again after ${secs(this.blindReads)} (${obs.total} buffs)`); }
		this.blindReads = 0;
		this.lastTotal = obs.total;
		const settling = this.tick <= this.settleUntil;

		// ---- Bone Shield ----
		if (obs.shieldLevel != null) {
			this.shieldMissing = 0;
			if (!this.shield) {
				this.shield = { level: obs.shieldLevel, lastSeen: this.tick };
				const gapReads = this.shieldGoneAt ? this.tick - this.shieldGoneAt : Infinity;
				const gap = isFinite(gapReads) ? `, ${secs(gapReads)} after it was last seen` : " (first time seen)";
				// back almost straight away = it was only hidden for a moment, not switched off and on
				const flicker = gapReads <= SHIELD_FLICKER_READS;
				const note = settling ? ", not charged: app just started or buff bar was covered"
					: flicker ? ", not charged: back too quickly to have been switched off and on" : "";
				this.events.shieldOn(obs.shieldLevel, !settling && !flicker, `Bone Shield buff appeared (level ${obs.shieldLevel})${gap}${note}`);
			} else if (obs.shieldLevel != this.shield.level) {
				// switching shield type while one is active casts the other one.
				// require the new number twice in a row so a single misread can't trigger it
				if (this.pendingLevel == obs.shieldLevel) {
					const from = this.shield.level;
					this.shield.level = obs.shieldLevel;
					this.pendingLevel = null;
					this.events.shieldOn(obs.shieldLevel, !settling, `Bone Shield level changed ${from} -> ${obs.shieldLevel}`);
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
				this.shieldGoneAt = this.shield.lastSeen;
				this.shield = null;
				this.events.shieldOff(`Bone Shield buff not seen for ${secs(SHIELD_GONE_AFTER)} (${obs.total} buffs on bar)`);
			}
		}

		// ---- taught buffs ----
		for (const b of obs.buffs) {
			const prev = this.seen.get(b.key);
			let isNew = !prev || this.tick - prev.lastSeen > GONE_AFTER;
			if (isNew && prev && !settling && isSameInstance(prev.times, b.time, this.tick - prev.lastSeen)) {
				// it was only hidden or flashing: the timer carried on from where it was
				this.events.note?.(`${b.key} buff back after ${secs(this.tick - prev.lastSeen)} with its timer where it left off (${prev.times[prev.times.length - 1]}s -> ${b.time}s): same cast, not counted`);
				isNew = false;
			}
			const times = isNew ? [] : prev!.times;
			times.push(b.time);
			if (times.length > 4) { times.shift(); }
			this.seen.set(b.key, { lastSeen: this.tick, times });
			const refreshed = !isNew && isTimerRefresh(times);
			if (settling || !(isNew || refreshed)) { continue; }
			const why = isNew
				? (prev ? `buff appeared ${secs(this.tick - prev.lastSeen)} after it was last seen` : "buff appeared (first time seen)")
				: `timer went up: ${times.join(" -> ")}s`;

			if (this.conjureKeys.has(b.key)) {
				const g = this.conjureGroup = this.conjureGroup || { appeared: new Set(), extended: new Set(), last: this.tick, whys: [], at: isNew ? now : (this.readAt.get(this.tick - 1) ?? now) };
				(isNew ? g.appeared : g.extended).add(b.key);
				g.whys.push(`${b.key}: ${why}`);
				g.last = this.tick;
			} else {
				// a timer jump is confirmed one read after it happens
				this.changeAt = isNew ? now : (this.readAt.get(this.tick - 1) ?? now);
				this.events.cast(b.key, why, { from: isNew ? null : Math.max(times[0], times[1]), to: b.time });
			}
		}

		// ---- conjures: wait a moment so ones summoned together are counted together ----
		const g = this.conjureGroup;
		if (g && this.tick - g.last >= CONJURE_WINDOW) {
			this.conjureGroup = null;
			this.changeAt = g.at;
			if (g.appeared.size > 0) {
				// timers reset alongside new summons = those were re-summoned by the same Undead Army
				const all = new Set([...g.appeared, ...(g.appeared.size + g.extended.size > 1 ? g.extended : [])]);
				this.events.conjuresSummoned([...all], g.whys.join("; "));
			} else if (g.extended.size > 0) {
				this.events.conjuresExtended([...g.extended], g.whys.join("; "));
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
	// Both of the last two reads must be above both reads before them, so a single misread digit
	// can't count. 2s is enough: recasting a no-cooldown ability like Lord of Bones only lifts
	// its timer a few seconds. Minute timers ("2m") can only step up by a whole minute.
	const slack = before >= 60 ? 0 : 1;
	return c > before + slack && d > before + slack;
}

/**
 * A buff that went missing and came back is the same cast (not a new one) if its timer is where
 * it would have been anyway: the last value seen minus the time it was gone, plus a little slack.
 * A real recast resets the timer higher than that.
 */
export function isSameInstance(prevTimes: number[], nowTime: number, goneReads: number) {
	const last = prevTimes[prevTimes.length - 1];
	if (!last || !nowTime) { return false; }//no timer to compare
	const expected = last - goneReads * 0.6;
	return nowTime <= Math.max(0, expected) + 3;
}

/**
 * How many casts of Darkness a timer change means. Each cast adds 12 minutes (up to 1 hour);
 * the right-click multicast fills it to 1 hour for 5x the runes.
 * Timers of a minute or more are shown in whole minutes ("11m"), so these are approximate.
 */
export function darknessCasts(from: number | null, to: number): { casts: number, multicast: boolean } {
	const CAST = 12 * 60, MAX = 60 * 60;
	const added = to - (from ?? 0);
	// jumped to (about) the full hour by more than one cast's worth = multicast
	if (to >= MAX - 60 && added > CAST + 60) { return { casts: 5, multicast: true }; }
	return { casts: Math.max(1, Math.round(added / CAST)), multicast: false };
}
