import type { Account } from "./accounts";
import { usageGate } from "./quota";
import type { Env } from "./types";

export const searchModes = ["off", "auto", "quick", "advanced", "deep"] as const;
export type SearchMode = typeof searchModes[number];
export type Source = { title: string; url: string; excerpt: string; date?: string };

export function searchQueries(mode: SearchMode, message: string): string[] {
	const query = message.trim().slice(0, 280);
	// Skip obvious secrets and contact details rather than forwarding them.
	if (!query || /https?:\/\/|@|\b(?:password|passphrase|adgangskode|api.?key|bearer|secret|token)\b|(?:\d[ -]?){8,}/i.test(message)) return [];
	if (mode === "off" || (mode === "auto" && !/\b(?:latest|current|today|news|price|specifications|documentation|sources|verify|seneste|nyheder|pris|lige nu|dokumentation|kilder|undersøg)\b/i.test(query))) return [];
	if (mode === "auto" && /^(?:write|invent|imagine|skriv|opfind)\b/i.test(query)) return [];
	const clauses = query.split(/\s*[;?]\s*/).filter(part => part.trim().length >= 12);
	return [...new Set([query, ...clauses])].slice(0, mode === "deep" ? 3 : 1);
}

export async function tavilySearch(env: Env, account: Account, queries: string[], mode: SearchMode, signal: AbortSignal) {
	const sources = new Map<string, Source>();
	for (const query of queries) {
		signal.throwIfAborted();
		const depth = mode === "advanced" ? "advanced" : "basic";
		const reservation = await usageGate(env).fetch("https://internal/search", {
			method: "POST", body: JSON.stringify({ owner: account.id, credits: depth === "advanced" ? 2 : 1 }),
		});
		if (!reservation.ok) break;
		signal.throwIfAborted();
		const response = await fetch("https://api.tavily.com/search", {
			method: "POST", redirect: "error",
			signal: AbortSignal.any([signal, AbortSignal.timeout(4500)]),
			headers: { Authorization: `Bearer ${env.TAVILY_API_KEY}`, "Content-Type": "application/json" },
			body: JSON.stringify({ query, search_depth: depth, safe_search: true, auto_parameters: false,
				max_results: 4, include_answer: false, include_raw_content: false, include_images: false }),
		});
		if (!response.ok) break;
		const result = await response.json<{ results?: { url?: unknown; title?: unknown; content?: unknown; published_date?: unknown }[] }>();
		for (const row of (Array.isArray(result.results) ? result.results : []).slice(0, 4)) {
			if (typeof row?.url !== "string" || row.url.length > 320 || typeof row.title !== "string" ||
				typeof row.content !== "string" || !row.content.trim()) continue;
			try {
				const url = new URL(row.url);
				if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) continue;
				url.hash = "";
				if (sources.size >= 6 || sources.has(url.href)) continue;
				const date = typeof row.published_date === "string" && Number.isFinite(Date.parse(row.published_date))
					? new Date(row.published_date).toISOString().slice(0, 10) : undefined;
				sources.set(url.href, { url: url.href, title: row.title.slice(0, 130), excerpt: row.content.slice(0, 650), date });
			} catch {
				// Ignore malformed provider links.
			}
		}
	}
	return [...sources.values()];
}
