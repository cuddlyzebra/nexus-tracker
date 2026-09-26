// Parses the chat message printed by the nexus "Check contents" option:
//   [15:23:46] Your nexus contains:
//   [15:23:46] - 41,554 x Ectoplasm
//   [15:23:46] - 26,097 x Spirit rune
//   ...
import { ITEMS, ItemId, MAX_STACK } from "./data";

export type Counts = Record<ItemId, number>;

const HEADER = /your\s*nexus\s*contains/i;
const EMPTY = /your\s*nexus\s*is\s*empty/i;
const ITEM = /-?\s*([\d][\d,.' ]*)\s*[xX]\s*([A-Za-z ]+)/;

export type ParsedLine =
	| { kind: "header" }
	| { kind: "empty" }
	| { kind: "item", item: ItemId, count: number }
	| null;

export function stripTimestamp(text: string) {
	return text.replace(/^\s*\[[\d: ]+\]\s*/, "");
}

export function parseLine(raw: string): ParsedLine {
	const text = stripTimestamp(raw).trim();
	if (HEADER.test(text)) { return { kind: "header" }; }
	if (EMPTY.test(text)) { return { kind: "empty" }; }
	const m = text.match(ITEM);
	if (m && text.startsWith("-")) {
		const count = parseInt(m[1].replace(/[^\d]/g, ""), 10);
		const def = ITEMS.find(i => i.chatName.test(m[2]));
		if (def && isFinite(count) && count >= 0 && count <= MAX_STACK) {
			return { kind: "item", item: def.id, count };
		}
	}
	return null;
}

/**
 * Collects the multi-line "Your nexus contains:" message into a full set of counts.
 * Items that aren't listed are empty (0). Feed it every new chat line; call flush()
 * each tick so a finished message is emitted even if fewer than 5 items were listed.
 */
export class NexusMessageCollector {
	private open: { started: number, lastLine: number, counts: Partial<Counts> } | null = null;
	/** how long after the last matching line the message is considered complete */
	timeout = 1500;

	constructor(private onResult: (counts: Counts) => void) { }

	feed(text: string, now = Date.now()) {
		const p = parseLine(text);
		if (!p) { return; }
		if (p.kind == "header") {
			this.finish();
			this.open = { started: now, lastLine: now, counts: {} };
		} else if (p.kind == "empty") {
			this.finish();
			this.onResult({ ecto: 0, spirit: 0, bone: 0, flesh: 0, miasma: 0 });
		} else if (p.kind == "item" && this.open) {
			this.open.counts[p.item] = p.count;
			this.open.lastLine = now;
			if (Object.keys(this.open.counts).length == ITEMS.length) { this.finish(); }
		}
	}

	flush(now = Date.now()) {
		if (this.open && now - this.open.lastLine > this.timeout) { this.finish(); }
	}

	private finish() {
		const o = this.open;
		this.open = null;
		if (!o || Object.keys(o.counts).length == 0) { return; }
		const counts = {} as Counts;
		for (const i of ITEMS) { counts[i.id] = o.counts[i.id] ?? 0; }
		this.onResult(counts);
	}
}

/** Chat messages that mean an ability was used (the ones that have no buff to watch) */
const CHAT_EVENTS: { action: string, match: RegExp }[] = [
	// "You sacrifice some life points to extend your link with spirits from the Underworld."
	{ action: "lifetransfer", match: /sacrifice some life points to extend your link/i },
];

export function parseChatEvent(raw: string): string | null {
	const text = stripTimestamp(raw);
	for (const e of CHAT_EVENTS) {
		if (e.match.test(text)) { return e.action; }
	}
	return null;
}
