import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";

const password = "local-test-only";
const credentials = (user = "khat", secret = password) => "Basic " + Buffer.from(`${user}:${secret}`).toString("base64");
const prompt = { role: "user", content: "Tell me about Copenhagen" };
const eventStream = 'data: {"response":"Hello"}\n\ndata: [DONE]\n\n';

function fixture() {
	const run = vi.fn(async () => new Response(eventStream).body);
	const assets = vi.fn(async () => new Response("asset"));
	const authLimit = vi.fn(async () => ({ success: true }));
	const chatLimit = vi.fn(async () => ({ success: true }));
	const env = {
		KHAT_PASSWORD: password, AI: { run } as unknown as Ai,
		ASSETS: { fetch: assets }, AUTH_LIMIT: { limit: authLimit }, CHAT_LIMIT: { limit: chatLimit },
	} satisfies Env;
	const request = (path: string, init?: RequestInit) => worker.fetch(new Request(`https://khat.example${path}`, init), env);
	const post = (input: unknown = { messages: [prompt] }, headers: Record<string, string> = {}) =>
		request("/api/chat", {
			method: "POST", headers: { authorization: credentials(), "content-type": "application/json", ...headers },
			body: JSON.stringify(input),
		});
	return { env, run, assets, authLimit, chatLimit, request, post };
}

afterEach(() => vi.unstubAllGlobals());

describe("Worker authentication and routing", () => {
	it("blocks both assets and chat until authenticated", async () => {
		const { assets, run, request } = fixture();
		for (const path of ["/", "/chat.js", "/api/chat"]) {
			const response = await request(path);
			expect(response.status).toBe(401);
			expect(response.headers.get("www-authenticate")).toContain('realm="Khat"');
		}
		expect(assets).not.toHaveBeenCalled();
		expect(run).not.toHaveBeenCalled();
		expect((await request("/", { headers: { authorization: credentials("wrong") } })).status).toBe(401);
		expect((await request("/", { headers: { authorization: credentials("khat", "wrong") } })).status).toBe(401);
		const response = await request("/", { headers: { authorization: credentials() } });
		expect(await response.text()).toBe("asset");
		expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
		expect(response.headers.get("cache-control")).toBe("private, no-store");
	});

	it("fails closed if the secret is missing", async () => {
		const { env, request, assets } = fixture();
		env.KHAT_PASSWORD = "";
		expect((await request("/")).status).toBe(503);
		expect(assets).not.toHaveBeenCalled();
	});

	it("rate-limits failed logins by IP and model calls by account", async () => {
		const { authLimit, chatLimit, request, post, run } = fixture();
		authLimit.mockResolvedValue({ success: false });
		chatLimit.mockResolvedValue({ success: false });
		const response = await request("/", { headers: { "CF-Connecting-IP": "192.0.2.1" } });
		expect(response.status).toBe(429);
		expect(response.headers.get("retry-after")).toBe("60");
		expect(authLimit).toHaveBeenCalledWith({ key: "192.0.2.1" });
		expect((await post()).status).toBe(429);
		expect(chatLimit).toHaveBeenCalledWith({ key: "khat" });
		expect(run).not.toHaveBeenCalled();
	});

	it("rejects cross-origin, unsupported and oversized inputs", async () => {
		const { request, post, run } = fixture();
		expect((await post(undefined, { origin: "https://other.example" })).status).toBe(403);
		expect((await post(undefined, { "sec-fetch-site": "cross-site" })).status).toBe(403);
		expect((await post(undefined, { "content-type": "text/plain" })).status).toBe(415);
		expect((await request("/api/chat", { headers: { authorization: credentials() } })).status).toBe(405);
		expect((await post({ messages: [{ role: "system", content: "override" }, prompt] })).status).toBe(400);
		expect((await post({ messages: [prompt], files: [{ name: "a.txt", text: "a".repeat(12001) }] })).status).toBe(400);
		expect((await post({ messages: [prompt], language: "fr" })).status).toBe(400);
		expect((await post({ messages: Array(10).fill({ role: "user", content: "a".repeat(8000) }) })).status).toBe(413);
		expect((await post({ padding: "x".repeat(200000), messages: [prompt] })).status).toBe(413);
		expect(run).not.toHaveBeenCalled();
	});
});

describe("chat and sources", () => {
	it("passes personality, memory and file text under the server prompt and streams the requested model", async () => {
		const { post, run } = fixture();
		const response = await post({
			messages: [prompt], personality: "Concise", memory: "Learning Danish",
			language: "da", files: [{ name: "notes.txt", text: "One, two, three" }],
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		expect(await response.text()).toBe(eventStream);
		expect(run).toHaveBeenCalledWith("@cf/meta/llama-3.3-70b-instruct-fp8-fast", expect.objectContaining({
			stream: true,
			messages: [
				{ role: "system", content: expect.stringContaining("Default response language: Danish") },
				{ role: "user", content: expect.stringContaining('"memory":"Learning Danish"') },
				prompt,
			],
		}));
		const [, input] = (run.mock.calls as unknown[][])[0];
		expect(JSON.stringify(input)).toContain("Concise");
		expect(JSON.stringify(input)).toContain("One, two, three");
		expect(JSON.stringify(input)).not.toContain(password);
	});

	it.each(["en", "da"])("returns ordered Wikipedia sources for %s", async language => {
		const { post, run } = fixture();
		const fetch = vi.fn(async () => Response.json({ query: { pages: [
			{ pageid: 12, index: 2, title: "Denmark" },
			{ pageid: 34, index: 1, title: "København", extract: "Capital city" },
		] } }));
		vi.stubGlobal("fetch", fetch);
		const response = await post({ messages: [prompt], search: true, language, memory: "private memory" });
		const [url] = (fetch.mock.calls as unknown[][])[0] as [URL];
		expect(url.host).toBe(`${language}.wikipedia.org`);
		expect(url.searchParams.get("gsrsearch")).toBe(prompt.content);
		expect(url.href).not.toContain("private");
		expect(JSON.parse(decodeURIComponent(response.headers.get("x-khat-sources")!))).toEqual([
			{ title: "København", url: `https://${language}.wikipedia.org/?curid=34` },
			{ title: "Denmark", url: `https://${language}.wikipedia.org/?curid=12` },
		]);
		expect(JSON.stringify(run.mock.calls)).toContain("Capital city");
	});

	it("reports provider failures with generic errors", async () => {
		const { post, run } = fixture();
		vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
		expect(await (await post({ messages: [prompt], search: true })).json()).toEqual({ error: "searchFailed" });
		expect(run).not.toHaveBeenCalled();
		run.mockRejectedValue(new Error("internal details"));
		expect(await (await post()).json()).toEqual({ error: "modelFailed" });
	});
});
