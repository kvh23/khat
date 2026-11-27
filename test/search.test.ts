import { afterEach, expect, it, vi } from "vitest";
import { searchQueries, tavilySearch } from "../src/search";
import type { Account } from "../src/accounts";
import type { Env } from "../src/types";

afterEach(() => vi.unstubAllGlobals());

it("limits automatic research and skips sensitive or URL-bearing messages", () => {
	expect(searchQueries("auto", "Hej")).toEqual([]);
	expect(searchQueries("auto", "Seneste nyheder om astronomi")).toHaveLength(1);
	expect(searchQueries("deep", "First question here? Second question here? Third question here? Fourth question here?")).toHaveLength(3);
	expect(searchQueries("quick", "Ask about user@example.test")).toEqual([]);
	expect(searchQueries("quick", "Explain https://example.test/private?key=abc")).toEqual([]);
});

it("reserves credits, sends only the query, enables safe search and rejects unsafe result URLs", async () => {
	const reserve = vi.fn(async () => new Response(null, { status: 204 }));
	const env = { TAVILY_API_KEY: "fixture", USAGE: { idFromName: () => "", get: () => ({ fetch: reserve }) } } as unknown as Env;
	const provider = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ results: [
		{ title: "Source", url: "https://example.test/report", content: "Evidence" },
		{ title: "Invalid", url: "javascript:alert(1)", content: "Ignored" },
	] }));
	vi.stubGlobal("fetch", provider);
	const account = { id: "private-account" } as Account;
	const signal = new AbortController().signal;
	expect(await tavilySearch(env, account, ["current astronomy news"], "advanced", signal)).toHaveLength(1);
	expect(JSON.parse(String(provider.mock.calls[0][1].body))).toMatchObject({
		query: "current astronomy news", search_depth: "advanced", safe_search: true, auto_parameters: false,
	});
	expect(String(provider.mock.calls[0][1].body)).not.toContain(account.id);
	reserve.mockResolvedValueOnce(new Response(null, { status: 429 }));
	expect(await tavilySearch(env, account, ["another query"], "quick", signal)).toEqual([]);
	expect(provider).toHaveBeenCalledTimes(1);
});
