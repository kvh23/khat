import type { Account } from "./accounts";

type RecordValue = Record<string, unknown>;
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const isObject = (value: unknown): value is RecordValue => !!value && typeof value === "object" && !Array.isArray(value);
const memoryKinds = ["manual", "explicit"];
const options: Record<string, string[]> = {
	language: ["en", "da"], theme: ["auto", "light", "dark"], style: ["balanced", "direct", "warm", "formal", "professional", "creative", "mentor", "technical", "concise", "educational", "friendly"],
	length: ["brief", "balanced", "detailed"], accent: ["ink", "blue", "green", "rose", "custom"],
	mode: ["auto", "instant", "think", "pro"], orbStyle: ["minimal", "fluid", "aurora", "classic", "intelligence"],
	density: ["comfortable", "compact"], rail: ["glass", "solid"],
};
const stringLimits: Record<string, number> = { aiName: 40, displayName: 40, personality: 1000, instructions: 2000 };
const bools = ["collapsed", "memoryEnabled", "motionEnabled", "ambience"];

function sanitizePreferences(value: unknown) {
	if (!isObject(value)) return null;
	const result: RecordValue = {};
	for (const [key, allowed] of Object.entries(options)) {
		if (typeof value[key] === "string" && allowed.includes(value[key])) result[key] = value[key];
	}
	for (const [key, limit] of Object.entries(stringLimits)) if (text(value[key], limit)) result[key] = value[key];
	for (const key of bools) if (typeof value[key] === "boolean") result[key] = value[key];
	for (const key of ["customAccent", "orbOne", "orbTwo"]) {
		if (typeof value[key] === "string" && /^#[0-9a-f]{6}$/i.test(value[key])) result[key] = value[key];
	}
	const ranges = { motionIntensity: [0, 100], glassOpacity: [65, 100], glassBlur: [0, 24],
		orbGlow: [0, 100], orbSpeed: [0, 100], orbDetail: [0, 100], orbSize: [65, 120], textSize: [14, 22] };
	for (const [key, [min, max]] of Object.entries(ranges)) {
		const number = value[key];
		if (typeof number === "number" && Number.isInteger(number) && number >= min && number <= max) result[key] = number;
	}
	if (text(value.avatar, 36_000) && (value.avatar === "" || /^data:image\/jpeg;base64,\/9j\/[a-z0-9+/]+={0,2}$/i.test(value.avatar))) result.avatar = value.avatar;
	return result;
}

type Memory = { id: string; content: string; source: string };
type Chat = { id: string; title: string; archived?: boolean; messages: RecordValue[] };
const id = (value: unknown): value is string => typeof value === "string" && /^[\w-]{1,64}$/.test(value);
const isChat = (value: unknown): value is Chat => isObject(value) && id(value.id) && text(value.title, 64) &&
	Array.isArray(value.messages) && value.messages.length <= 160 && value.messages.every(msg =>
		isObject(msg) && (msg.role === "user" || msg.role === "assistant") && text(msg.content, 40_000) &&
		JSON.stringify(msg).length <= 48_000);

export async function readWorkspace(db: D1Database, owner: string) {
	const [workspace, conversations, messages, memories] = await db.batch([
		db.prepare("SELECT revision,preferences FROM workspaces WHERE owner=?").bind(owner),
		db.prepare("SELECT id,title,archived FROM conversations WHERE owner=? ORDER BY position").bind(owner),
		db.prepare("SELECT conversation,payload FROM messages WHERE owner=? ORDER BY conversation,position").bind(owner),
		db.prepare("SELECT id,content,source FROM memories WHERE owner=? ORDER BY rowid").bind(owner),
	]);
	const row = workspace.results[0] as { revision: number; preferences: string } | undefined;
	if (!row) return null;
	const histories = new Map<string, RecordValue[]>();
	for (const entry of messages.results as { conversation: string; payload: string }[]) {
		const history = histories.get(entry.conversation) ?? [];
		history.push(JSON.parse(entry.payload));
		histories.set(entry.conversation, history);
	}
	return {
		revision: row.revision, preferences: JSON.parse(row.preferences),
		chats: (conversations.results as { id: string; title: string; archived: number }[])
			.map(chat => ({ ...chat, archived: !!chat.archived, messages: histories.get(chat.id) ?? [] })),
		memories: memories.results as Memory[],
	};
}

export async function saveWorkspace(db: D1Database, owner: string, input: RecordValue) {
	const { revision, preferences, chats, memories } = input;
	const safe = sanitizePreferences(preferences);
	if (!Number.isSafeInteger(revision) || !safe || !Array.isArray(chats) || chats.length > 60 ||
		!chats.every(isChat) || new Set(chats.map(chat => chat.id)).size !== chats.length ||
		!Array.isArray(memories) || memories.length > 40 || new Set(memories.map(mem => mem?.id)).size !== memories.length ||
		!memories.every(mem => isObject(mem) && id(mem.id) && text(mem.content, 500) && mem.content.trim() &&
			typeof mem.source === "string" && memoryKinds.includes(mem.source))) return "invalid";
	// One D1 batch commits the revision and all owner-scoped rows together.
	const write = crypto.randomUUID();
	const guard = "EXISTS(SELECT 1 FROM workspaces WHERE owner=? AND write_token=?)";
	const chatShape = JSON.stringify(chats.map(chat => ({ id: chat.id, size: chat.messages.length })));
	const statements = [
		db.prepare("UPDATE workspaces SET revision=revision+1,write_token=?,preferences=? WHERE owner=? AND revision=?")
			.bind(write, JSON.stringify(safe), owner, revision),
		db.prepare(`DELETE FROM conversations WHERE owner=? AND ${guard}
			AND id NOT IN (SELECT json_extract(value,'$.id') FROM json_each(?))`).bind(owner, owner, write, chatShape),
		db.prepare(`INSERT INTO conversations(owner,id,title,archived,position)
			SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.title'),COALESCE(json_extract(value,'$.archived'),0),key
			FROM json_each(?) WHERE ${guard}
			ON CONFLICT(owner,id) DO UPDATE SET title=excluded.title,archived=excluded.archived,position=excluded.position
			WHERE title<>excluded.title OR archived<>excluded.archived OR position<>excluded.position`)
			.bind(owner, JSON.stringify(chats.map(({ id,title,archived }) => ({ id,title,archived: !!archived }))), owner, write),
		db.prepare(`DELETE FROM messages WHERE owner=? AND ${guard}
			AND position >= (SELECT json_extract(value,'$.size') FROM json_each(?) WHERE json_extract(value,'$.id')=conversation)`)
			.bind(owner, owner, write, chatShape),
		db.prepare(`INSERT INTO messages(owner,conversation,position,payload)
			SELECT ?,json_extract(c.value,'$.id'),m.key,m.value FROM json_each(?) c,json_each(c.value,'$.messages') m WHERE ${guard}
			ON CONFLICT(owner,conversation,position) DO UPDATE SET payload=excluded.payload WHERE payload<>excluded.payload`)
			.bind(owner, JSON.stringify(chats), owner, write),
		db.prepare(`DELETE FROM memories WHERE owner=? AND ${guard} AND id NOT IN (SELECT json_extract(value,'$.id') FROM json_each(?))`)
			.bind(owner, owner, write, JSON.stringify(memories)),
		db.prepare(`INSERT INTO memories(owner,id,content,source)
			SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.content'),json_extract(value,'$.source')
			FROM json_each(?) WHERE ${guard}
			ON CONFLICT(owner,id) DO UPDATE SET content=excluded.content,source=excluded.source WHERE content<>excluded.content OR source<>excluded.source`)
			.bind(owner, JSON.stringify(memories), owner, write),
	];
	const result = await db.batch(statements);
	return result[0].meta.changes ? "saved" : "syncConflict";
}

// Only explicitly requested, enumerated, nonsensitive preferences are learned automatically.
const learned = [
	{ phrase: /^husk (?:at )?jeg foretrækker korte svar[.!]?$/i, content: "Jeg foretrækker korte svar." },
	{ phrase: /^husk (?:at )?jeg foretrækker detaljerede svar[.!]?$/i, content: "Jeg foretrækker detaljerede svar." },
	{ phrase: /^husk (?:at )?jeg foretrækker punktopstillinger[.!]?$/i, content: "Jeg foretrækker punktopstillinger." },
	{ phrase: /^husk (?:at )?jeg foretrækker danske svar[.!]?$/i, content: "Jeg foretrækker danske svar." },
	{ phrase: /^(?:please )?remember (?:that )?i prefer (?:brief|short|concise) (?:answers|replies)[.!]?$/i, content: "I prefer concise answers." },
	{ phrase: /^(?:please )?remember (?:that )?i prefer detailed (?:answers|replies)[.!]?$/i, content: "I prefer detailed answers." },
	{ phrase: /^(?:please )?remember (?:that )?i prefer (?:bullet points|lists)[.!]?$/i, content: "I prefer bullet points." },
	{ phrase: /^(?:please )?remember (?:that )?i prefer (?:danish|english) (?:answers|replies)[.!]?$/i, content: "" },
];
function terms(text: string) {
	return new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => word.length >= 4));
}

export async function readPreferences(db: D1Database, owner: string) {
	const workspace = await db.prepare("SELECT preferences FROM workspaces WHERE owner=?").bind(owner)
		.first<{ preferences: string }>();
	return sanitizePreferences(workspace ? JSON.parse(workspace.preferences) : {}) ?? {};
}

export async function memoryContext(db: D1Database, account: Account, prompt: string, enabled: boolean) {
	if (!enabled) return "";

	// Browser commits memories with the conversation revision. Return suggestions separately.
	const { results } = await db.prepare("SELECT content FROM memories WHERE owner=? LIMIT 40").bind(account.id).all<{ content: string }>();
	const words = terms(prompt);
	const context = results.map(({ content }) => ({
		content, score: (learned.some(entry => entry.content && entry.content === content) ||
			content === "I prefer Danish answers." || content === "I prefer English answers." ? .5 : 0)
			+ [...terms(content)].filter(word => words.has(word)).length,
	})).filter(entry => entry.score).sort((a, b) => b.score - a.score).slice(0, 3).map(entry => entry.content).join("\n");
	return context;
}

export function requestedMemory(prompt: string) {
	const match = learned.find(entry => entry.phrase.test(prompt.trim()));
	if (!match) return "";
	return match.content || (prompt.toLowerCase().includes("danish") ? "I prefer Danish answers." : "I prefer English answers.");
}

export async function studioHistory(db: D1Database, owner: string, input?: RecordValue) {
	if (!input) {
		const { results } = await db.prepare("SELECT id,prompt,data FROM studio_images WHERE owner=? ORDER BY created DESC")
			.bind(owner).all();
		return Response.json({ images: results });
	}
	if (!id(input.id)) return Response.json({ error: "invalid" }, { status: 400 });
	if (input.remove === true) {
		await db.prepare("DELETE FROM studio_images WHERE owner=? AND id=?").bind(owner, input.id).run();
		return new Response(null, { status: 204 });
	}
	if (!text(input.prompt, 900) || !text(input.data, 220_000) ||
		!/^data:image\/jpeg;base64,\/9j\/[a-z0-9+/]+={0,2}$/i.test(input.data))
		return Response.json({ error: "invalid" }, { status: 400 });
	const result = await db.prepare(`INSERT OR IGNORE INTO studio_images(owner,id,prompt,data,created)
		SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM studio_images WHERE owner=?)<12`)
		.bind(owner, input.id, input.prompt, input.data, Date.now(), owner).run();
	return result.meta.changes ? new Response(null, { status: 204 }) : Response.json({ error: "galleryFull" }, { status: 409 });
}
