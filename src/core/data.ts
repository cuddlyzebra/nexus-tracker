export const VERSION = "0.9.0-beta";
export const REPO_URL = "https://github.com/cuddlyzebra/nexus-tracker";

// Static game data: nexus items, ability/incantation costs, bone shield scaling.
// Sources: RuneScape Wiki (Incantations, Lesser/Greater Bone Shield, Ectoplasm) + in-game testing.

export type ItemId = "ecto" | "spirit" | "bone" | "flesh" | "miasma";
export type Cost = Partial<Record<ItemId, number>>;

export const ITEMS: { id: ItemId, name: string, chatName: RegExp, icon: string }[] = [
	{ id: "ecto", name: "Ectoplasm", chatName: /ecto/i, icon: "imgs/ectoplasm.png" },
	{ id: "spirit", name: "Spirit rune", chatName: /spirit/i, icon: "imgs/spirit.png" },
	{ id: "bone", name: "Bone rune", chatName: /bone/i, icon: "imgs/bone.png" },
	{ id: "flesh", name: "Flesh rune", chatName: /flesh/i, icon: "imgs/flesh.png" },
	{ id: "miasma", name: "Miasma rune", chatName: /miasma/i, icon: "imgs/miasma.png" },
];

/** Max stack for every item in the nexus */
export const MAX_STACK = 2147483647;

export type ShieldTier = "lesser" | "greater";

export const SHIELD_COST: Record<ShieldTier, Cost> = {
	lesser: { spirit: 5, bone: 5 },
	greater: { spirit: 10, bone: 10, flesh: 5 },
};

export type NexusType = "standard" | "zemouregal";

/** The three nexus items. Deathwarden and The Devourer's scale Bone Shield the same way. */
export type NexusItem = "deathwarden" | "devourer" | "zemouregal";
export const NEXUS_ITEMS: { id: NexusItem, name: string, icon: string, scale: NexusType }[] = [
	{ id: "deathwarden", name: "Deathwarden nexus", icon: "imgs/nexus_deathwarden.png", scale: "standard" },
	{ id: "devourer", name: "The Devourer's Nexus", icon: "imgs/nexus_devourer.png", scale: "standard" },
	{ id: "zemouregal", name: "Zemouregal's nexus", icon: "imgs/nexus_zemouregal.png", scale: "zemouregal" },
];

/**
 * Bone Shield level as a fraction of Necromancy level.
 * Deathwarden / Devourer's: lesser 25%, greater 50%  (120 -> 30 / 60)
 * Zemouregal's:             lesser 37.5%, greater 62.5% (120 -> 45 / 75)
 */
export const SHIELD_SCALE: Record<NexusType, Record<ShieldTier, number>> = {
	standard: { lesser: 0.25, greater: 0.5 },
	zemouregal: { lesser: 0.375, greater: 0.625 },
};

/** Work out which shield is active from the number on the Bone Shield buff */
export function classifyShield(level: number, nexus: NexusType, necroLevel: number): ShieldTier {
	const s = SHIELD_SCALE[nexus];
	const lesser = Math.floor(necroLevel * s.lesser);
	const greater = Math.floor(necroLevel * s.greater);
	return Math.abs(level - lesser) < Math.abs(level - greater) ? "lesser" : "greater";
}

export type ActionGroup = "shield" | "defensive" | "incantation" | "conjure";

export interface ActionDef {
	id: string;
	name: string;
	group: ActionGroup;
	/** fixed cost; defensives use the active shield's cost instead */
	cost?: Cost;
	/** true if this ability puts a buff on the buff bar, so it can be taught/detected */
	hasBuff: boolean;
	/** false to leave it off the "Log a cast" panel */
	manual?: boolean;
}

export const ACTIONS: ActionDef[] = [
	// Shield toggles (detected automatically from the Bone Shield buff)
	{ id: "lesserboneshield", name: "Lesser Bone Shield", group: "shield", cost: SHIELD_COST.lesser, hasBuff: false },
	{ id: "greaterboneshield", name: "Greater Bone Shield", group: "shield", cost: SHIELD_COST.greater, hasBuff: false },

	// Defensives that need a shield: cost the active Bone Shield's runes, free without Bone Shield
	{ id: "resonance", name: "Resonance", group: "defensive", hasBuff: true },
	{ id: "divert", name: "Divert", group: "defensive", hasBuff: true },
	{ id: "barricade", name: "Barricade", group: "defensive", hasBuff: true },
	{ id: "reflect", name: "Reflect", group: "defensive", hasBuff: true },
	{ id: "immortality", name: "Immortality", group: "defensive", hasBuff: true },
	{ id: "rejuvenate", name: "Rejuvenate", group: "defensive", hasBuff: true },
	{ id: "preparation", name: "Preparation", group: "defensive", hasBuff: true },

	// Incantations
	{ id: "threadsoffate", name: "Threads of Fate", group: "incantation", cost: { spirit: 5, bone: 2, flesh: 1 }, hasBuff: true },
	// no buff: detected from its chat message and from conjure timers being extended
	{ id: "lifetransfer", name: "Life Transfer", group: "incantation", cost: { spirit: 10, bone: 5, flesh: 2, miasma: 1 }, hasBuff: false },//cost confirmed in game
	{ id: "invokelordofbones", name: "Invoke Lord of Bones", group: "incantation", cost: { spirit: 8, bone: 6, flesh: 2, miasma: 1 }, hasBuff: true },
	{ id: "invokedeath", name: "Invoke Death", group: "incantation", cost: { spirit: 5, bone: 2, flesh: 2, miasma: 1 }, hasBuff: true },
	{ id: "darkness", name: "Darkness", group: "incantation", cost: { spirit: 40, bone: 20, flesh: 10, miasma: 5 }, hasBuff: true },
	{ id: "splitsoul", name: "Split Soul", group: "incantation", cost: { spirit: 10, bone: 5, flesh: 2, miasma: 1 }, hasBuff: true },
	{ id: "umteleport", name: "City of Um Teleport", group: "incantation", cost: { spirit: 5 }, hasBuff: false },
	{ id: "ungaelteleport", name: "Ungael Teleport", group: "incantation", cost: { spirit: 5 }, hasBuff: false },

	// Conjures: 1 ectoplasm each, 2 each when summoned together by Conjure Undead Army
	{ id: "conjureskeleton", name: "Skeleton Warrior", group: "conjure", cost: { ecto: 1 }, hasBuff: true },
	{ id: "conjurezombie", name: "Putrid Zombie", group: "conjure", cost: { ecto: 1 }, hasBuff: true },
	{ id: "conjureghost", name: "Vengeful Ghost", group: "conjure", cost: { ecto: 1 }, hasBuff: true },
	{ id: "conjurephantom", name: "Phantom Guardian", group: "conjure", cost: { ecto: 1 }, hasBuff: true },
	// charged once per conjure it summons (detected as several conjures appearing together)
	{ id: "conjurearmy", name: "Conjure Undead Army", group: "conjure", cost: { ecto: 2 }, hasBuff: false, manual: false },
];

export const ACTION_BY_ID: Record<string, ActionDef> = Object.fromEntries(ACTIONS.map(a => [a.id, a]));

export function scaleCost(cost: Cost, mult: number): Cost {
	const r: Cost = {};
	for (const k in cost) { r[k as ItemId] = cost[k as ItemId]! * mult; }
	return r;
}

export function formatCost(cost: Cost) {
	return ITEMS.filter(i => cost[i.id]).map(i => `${cost[i.id]} ${i.name.replace(" rune", "")}`).join(", ");
}
