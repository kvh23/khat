import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";

const password = "local-test-only";
const credentials = (user = "khat", secret = password) => "Basic " + Buffer.from(`${user}:${secret}`).toString("base64");
const prompt = { role: "user", content: "Tell me about Copenhagen" };
const eventStream = 'data: {"response":"Hello"}\n\ndata: [DONE]\n\n';

function fixture() {
	const run = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => new Response(eventStream).body);
	const assets = vi.fn(async () => new Response("asset"));
	const authLimit = vi.fn(async () => ({ success: true }));
	const chatLimit = vi.fn(async () => ({ success: true }));
	const quota = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));
	const env = {
		USAGE: { idFromName: () => "test", get: () => ({ fetch: quota }) } as unknown as DurableObjectNamespace,
		KHAT_PASSWORD: password, ACCOUNTS_REQUIRED: "false", AI: { run } as unknown as Ai,
		ASSETS: { fetch: assets }, AUTH_LIMIT: { limit: authLimit }, CHAT_LIMIT: { limit: chatLimit },
	} satisfies Env;
	const request = (path: string, init?: RequestInit) => worker.fetch(new Request(`https://khat.example${path}`, init), env);
	const post = (input: unknown = { messages: [prompt] }, headers: Record<string, string> = {}, path = "/api/chat") =>
		request(path, {
			method: "POST", headers: { authorization: credentials(), "content-type": "application/json", ...headers },
			body: JSON.stringify(input),
		});
	return { env, run, assets, authLimit, chatLimit, request, post, quota };
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

	it("fails closed when production authentication bindings are absent", async () => {
		const { env, post, run } = fixture();
		for (const flag of [undefined, "true"]) {
			Object.assign(env, { ACCOUNTS_REQUIRED: flag });
			const response = await post();
			expect(response.status).toBe(503);
			expect(response.headers.has("www-authenticate")).toBe(false);
		}
		expect(run).not.toHaveBeenCalled();
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
	it.each([
		["Hvem er du?", "thinkClassic"], ["Hvad hedder du?", "thinkClassic"], ["Hvad hedder jeg?", "thinkClassic"],
		["Forklar fotosyntese på dansk.", "thinkClassic"], ["Skriv en kort professionel e-mail.", "thinkClassic"],
		["Forklar forskellen på lineære og eksponentielle funktioner.", "thinkClassic"],
		["Beregn 12 * 17", "think"], ["Fejlfind min JavaScript-funktion", "think"],
		["Sammenlign mulige forklaringer og analysér antagelserne", "think"],
	])("routes Danish input %s and supplies language guidance", async (content, model) => {
		const f = fixture();
		const response = await f.post({ messages: [{ role: "user", content }], mode: "auto", language: "da" });
		expect(response.headers.get("x-khat-model")).toBe(model);
		const input = f.run.mock.calls[0]?.[1] as { messages: { role: string; content: string }[] };
		expect(input.messages[0].content).toContain("Default response language: Danish");
		expect(input.messages.at(-1)?.content).toBe(content);
	});

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

describe("model routing and quota", () => {
	it.each([
		["instant", "Tell me about Copenhagen", "@cf/ibm-granite/granite-4.0-h-micro", "instant"],
		["think", "Tell me about Copenhagen", "@cf/zai-org/glm-4.7-flash", "think"],
		["pro", "Tell me about Copenhagen", "@cf/google/gemma-4-26b-a4b-it", "pro"],
		["auto", "Explain Copenhagen", "@cf/ibm-granite/granite-4.0-h-micro", "instant"],
		["auto", "Hvad hedder du?", "@cf/qwen/qwen3-30b-a3b-fp8", "thinkClassic"],
		["auto", "Hvorfor fejler min JavaScript-funktion?", "@cf/zai-org/glm-4.7-flash", "think"],
		["auto", "Compare two ways to solve this", "@cf/zai-org/glm-4.7-flash", "think"],
		["auto", "x".repeat(3500), "@cf/google/gemma-4-26b-a4b-it", "pro"],
	])("routes %s to a real model", async (mode, content, id, served) => {
		const { post, run } = fixture();
		const response = await post({ mode, messages: [{ ...prompt, content }], length: "brief", aiName: "Aster",
			style: "direct", instructions: "Answer in a list." });
		expect(response.status).toBe(200);
		expect(response.headers.get("x-khat-model")).toBe(served);
		expect(response.headers.get("x-khat-fallback")).toBe("false");
		expect(run.mock.calls[0][0]).toBe(id);
		expect(run.mock.calls[0][1]).toMatchObject({ max_tokens: 640 });
		expect(JSON.stringify(run.mock.calls[0][1])).toContain("Answer in a list.");
	});

	it("charges a fallback separately and tells the client which model answered", async () => {
		const { post, run, quota } = fixture();
		run.mockRejectedValueOnce(new Error("provider unavailable"));
		const response = await post({ mode: "pro", messages: [prompt] });
		expect(response.headers.get("x-khat-model")).toBe("legacy");
		expect(response.headers.get("x-khat-fallback")).toBe("true");
		expect(quota.mock.calls.map(([, init]) => JSON.parse(String(init.body)).kind)).toEqual(["text", "retry"]);
	});

	it("blocks an exhausted quota or unsupported model ID before provider access", async () => {
		const { post, run, quota } = fixture();
		quota.mockResolvedValueOnce(new Response(null, { status: 429 }));
		expect((await post()).status).toBe(429);
		expect((await post({ mode: "@cf/something/paid", messages: [prompt] })).status).toBe(400);
		expect(run).not.toHaveBeenCalled();
	});
});

describe("Studio", () => {
	const input = { prompt: "A watercolor of pine trees", ratio: "landscape", style: "illustration" };
	const call = (f: ReturnType<typeof fixture>) => f.post(input, {}, "/api/image");
	const jpeg = "/9j/eA==";
	it("authenticates image generation and validates presets", async () => {
		const f = fixture();
		expect((await f.request("/api/image", { method: "POST" })).status).toBe(401);
		expect((await f.post({ ...input, ratio: "__proto__" }, {}, "/api/image")).status).toBe(400);
		expect(f.run).not.toHaveBeenCalled();
	});

	it("generates with FLUX only after prompt approval and returns only approved output", async () => {
		const f = fixture();
		f.run.mockResolvedValueOnce({ response: "ALLOW" }).mockResolvedValueOnce({ image: jpeg })
			.mockResolvedValueOnce({ choices: [{ message: { content: "ALLOW" } }] });
		expect(await (await call(f)).json()).toEqual({ image: jpeg });
		expect(f.run.mock.calls[1]).toEqual(["@cf/black-forest-labs/flux-1-schnell", {
			steps: 4, prompt: expect.stringContaining("wide horizontal crop"),
		}]);
		expect(JSON.stringify(f.run.mock.calls[2])).toContain("data:image/jpeg;base64,");
		expect(JSON.parse(String(f.quota.mock.calls[0][1].body))).toEqual({ kind: "image", neurons: 500 });
	});

	it("fails closed on unsafe prompts, output classifier failures, and invalid images", async () => {
		const blocked = fixture();
		blocked.run.mockResolvedValueOnce({ response: "BLOCK" });
		expect((await call(blocked)).status).toBe(422);
		expect(blocked.run).toHaveBeenCalledTimes(1);
		const failed = fixture();
		failed.run.mockResolvedValueOnce({ response: "ALLOW" }).mockResolvedValueOnce({ image: jpeg })
			.mockRejectedValueOnce(new Error("classifier unavailable"));
		expect(await (await call(failed)).json()).toEqual({ error: "imageFailed" });
		const invalid = fixture();
		invalid.run.mockResolvedValueOnce({ response: "ALLOW" }).mockResolvedValueOnce({ image: "<svg>" });
		expect((await call(invalid)).status).toBe(502);
	});
});

describe("account memory and temporary chat", () => {
	it("uses only relevant opted-in memories and skips D1 memory reads in temporary chat", async () => {
		const f = fixture();
		const prepare = vi.fn((sql: string) => ({
			bind: () => ({
				first: async () => sql.includes("JOIN accounts") ? { id: "account-fixture" } : { preferences: '{"memoryEnabled":true}' },
				all: async () => ({ results: [{ content: "I am learning about mountain photography." }, { content: "I enjoy baking." }] }),
			}),
		}));
		Object.assign(f.env, { DB: { prepare }, PASSWORDS: {} });
		const headers = { cookie: `__Host-khat_session=${"X".repeat(43)}`, "x-khat-account": "account-fixture" };
		const payload = { messages: [{ role: "user", content: "Explain mountain photography" }], memory: "spoofed client memory" };
		const normal = await f.post(payload, headers);
		expect(normal.status).toBe(200);
		expect(JSON.stringify(f.run.mock.calls.at(-1))).toContain("learning about mountain photography");
		expect(JSON.stringify(f.run.mock.calls.at(-1))).not.toContain("baking");
		expect(JSON.stringify(f.run.mock.calls.at(-1))).not.toContain("spoofed");
		prepare.mockClear();
		const temporary = await f.post({ ...payload, temporary: true }, headers);
		expect(temporary.headers.get("x-khat-memory")).toBe("");
		expect(prepare.mock.calls.some(([sql]) => /memories|preferences/.test(sql))).toBe(false);
		expect(JSON.stringify(f.run.mock.calls.at(-1))).not.toContain("learning about mountain photography");
	});

	it("sends saved name and instructions in the model prompt only in regular chats", async () => {
		const f = fixture();
		const first = vi.fn(async () => ({ preferences: JSON.stringify({
			displayName: "Khat friend", instructions: "Mit navn er tjek.", aiName: "Khat",
		}) }));
		const prepare = vi.fn((sql: string) => ({
			bind: (owner: string) => ({
				first: sql.includes("JOIN accounts") ? async () => ({ id: "account-fixture" }) : () => {
					expect(owner).toBe("account-fixture");
					return first();
				},
			}),
		}));
		Object.assign(f.env, { DB: { prepare }, PASSWORDS: {} });
		const headers = { cookie: `__Host-khat_session=${"X".repeat(43)}`, "x-khat-account": "account-fixture" };
		const payload = { messages: [{ role: "user", content: "hvad er mit navn?" }], instructions: "untrusted replacement" };
		for (const temporary of [false, true]) {
			expect((await f.post({ ...payload, temporary }, headers)).status).toBe(200);
			const input = f.run.mock.calls.at(-1)?.[1] as { messages: { role: string; content: string }[] };
			const [system] = input.messages;
			expect(system.role).toBe("system");
			expect(system.content).toContain("appropriate for teens");
			expect(system.content.includes("Mit navn er tjek.")).toBe(!temporary);
			expect(system.content.includes("Khat friend")).toBe(!temporary);
			expect(system.content).not.toContain("untrusted replacement");
		}
		expect(first).toHaveBeenCalledOnce();
	});

	it("only emits canonical opt-in memory suggestions for approved explicit preferences", async () => {
		const { requestedMemory } = await import("../src/workspace");
		expect(requestedMemory("Please remember that I prefer concise replies.")).toBe("I prefer concise answers.");
		expect(requestedMemory("Husk at jeg foretrækker korte svar.")).toBe("Jeg foretrækker korte svar.");
		expect(requestedMemory("Remember my phone number is 123456789")).toBe("");
		expect(requestedMemory("Remember that I prefer concise replies and my address is private")).toBe("");
	});
});

it("reports only a fixed registration stage when password derivation fails", async () => {
	const { accountRoute } = await import("../src/accounts");
	const f = fixture();
	const diagnostics = vi.spyOn(console, "error").mockImplementation(() => {});
	try {
		const env = {
			...f.env,
			DB: { prepare: () => ({ bind: () => ({ first: async () => ({ 1: 1 }) }) }) },
			PASSWORDS: { idFromName: () => "fixture", get: () => ({
				fetch: async () => { throw new Error("Sensitive provider error fixture"); },
			}) },
		} as unknown as Env;
		const response = await accountRoute("/api/register", new Request("https://khat.example/api/register"), {
			username: "private_user", displayName: "Fixture", password: "private test passphrase", invite: "I".repeat(43),
		}, env, null);
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ error: "unavailable", stage: "password_hash" });
		expect(diagnostics.mock.calls).toEqual([
			["Khat account operation failed", { operation: "register", stage: "password_hash" }],
		]);
	} finally {
		diagnostics.mockRestore();
	}
});

it("falls back to a cheaper model when Auto cannot reserve its first candidate", async () => {
	const { post, run, quota } = fixture();
	quota.mockResolvedValueOnce(new Response(null, { status: 429 }));
	const response = await post({ mode: "auto", messages: [{ ...prompt, content: "Document ".repeat(410) }] });
	expect(response.headers.get("x-khat-model")).toBe("think");
	expect(response.headers.get("x-khat-fallback")).toBe("true");
	expect(run).toHaveBeenCalledTimes(1);
	expect(quota.mock.calls.map(([, init]) => JSON.parse(String(init.body)).kind)).toEqual(["text", "text"]);
});

it("preserves screen content in enhanced prompts and checks both prompt versions and the result", async () => {
	const f = fixture();
	const rewritten = "A silly monkey holds a phone with a banana pictured on its screen.";
	f.run.mockResolvedValueOnce({ response: "ALLOW" }).mockResolvedValueOnce({ response: rewritten })
		.mockResolvedValueOnce({ response: "ALLOW" }).mockResolvedValueOnce({ image: "/9j/eA==" })
		.mockResolvedValueOnce({ response: "ALLOW" });
	const prompt = "lav et fjollet billede af en abe med en telefon og en banan på skærmen af telefonen";
	const response = await f.post({ prompt, style: "illustration", ratio: "wide", quality: "detail", enhance: true }, {}, "/api/image");
	expect(response.status).toBe(200);
	expect(f.run).toHaveBeenCalledTimes(5);
	expect(JSON.stringify(f.run.mock.calls[0][1])).toContain(prompt);
	expect(JSON.stringify(f.run.mock.calls[2][1])).toContain(rewritten);
	expect(f.run.mock.calls[3][1]).toMatchObject({ steps: 8, prompt: expect.stringContaining(rewritten) });
	expect(f.run.mock.calls[3][1]).toMatchObject({ prompt: expect.stringContaining("16:9") });
	expect(JSON.stringify(f.run.mock.calls[4][1])).toContain("data:image/jpeg");
	expect(JSON.parse(String(f.quota.mock.calls[0][1].body))).toEqual({ kind: "image", neurons: 600 });
});

it("does not generate when the revised image prompt is blocked", async () => {
	const f = fixture();
	f.run.mockResolvedValueOnce({ response: "ALLOW" }).mockResolvedValueOnce({ response: "Rewritten scene" })
		.mockResolvedValueOnce({ response: "BLOCK" });
	expect((await f.post({ prompt: "A cabin", style: "plain", ratio: "square", enhance: true }, {}, "/api/image")).status).toBe(422);
	expect(f.run).toHaveBeenCalledTimes(3);
});

it("checks an attached image before routing vision to Gemma 4", async () => {
	const f = fixture();
	// Minimal JPEG marker fixture with a 1×1 baseline frame.
	const jpeg = Buffer.from([255, 216, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 255, 217]).toString("base64");
	f.run.mockResolvedValueOnce({ response: "ALLOW" });
	const response = await f.post({ mode: "instant", messages: [prompt], vision: jpeg });
	expect(response.headers.get("x-khat-model")).toBe("pro");
	expect(f.run).toHaveBeenCalledTimes(2);
	expect(f.run.mock.calls[1][0]).toBe("@cf/google/gemma-4-26b-a4b-it");
	expect(JSON.stringify(f.run.mock.calls[1][1])).toContain("data:image/jpeg;base64,");
	const blocked = fixture();
	blocked.run.mockResolvedValueOnce({ response: "BLOCK" });
	expect((await blocked.post({ messages: [prompt], vision: jpeg })).status).toBe(422);
	expect(blocked.run).toHaveBeenCalledTimes(1);
});
