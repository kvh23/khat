import { describe, expect, it } from "vitest";
import { calculate, contextWindow } from "../src/context";
import { publicStream } from "../src/public-stream";

describe("bounded intelligence context", () => {
	it("selects relevant older excerpts and keeps the last turn verbatim", () => {
		const earlier = [{ role: "user" as const, content: "Remember the Saturn telescope. Use the crosshair." }];
		const filler = Array.from({ length: 9 }, (_, index) => ({ role: "assistant" as const, content: `Coffee note ${index}` }));
		const latest = { role: "user" as const, content: "Revisit the Saturn telescope." };
		const result = contextWindow([...earlier, ...filler, latest]);
		expect(result.recent).toHaveLength(6);
		expect(result.recent.at(-1)).toEqual(latest);
		expect(result.summary.some(item => item.excerpt.includes("Saturn telescope"))).toBe(true);
	});

	it("uses a bounded arithmetic parser with precedence and rejects unsafe or nonfinite expressions", () => {
		expect(calculate("beregn: (2 + 3) × -4 ÷ 2")?.value).toBe(-10);
		expect(calculate("2 + 3 * 4")?.value).toBe(14);
		expect(calculate("1/0")).toBeNull();
		expect(calculate("Math.random()")).toBeNull();
		expect(calculate("2(3 + 4)")).toBeNull();
	});
});

it("does not forward split private thinking tags or structured reasoning deltas", async () => {
	const input = [
		'data: {"response":"<th"}\r\n\r\n',
		'data: {"response":"ink>SECRET A</th"}\n\n',
		'data: {"response":"ink>Public"}\n\n',
		'data: {"choices":[{"delta":{"reasoning_content":"SECRET B"}}]}\n\n',
		'data: {"choices":[{"delta":{"content":" answer"}}]}\n\n',
		'data: [DONE]\n\n',
	];
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) { input.forEach(chunk => controller.enqueue(encoder.encode(chunk))); controller.close(); },
	});
	const response = await new Response(publicStream(stream)).text();
	expect(response).toContain('{"response":"Public"}');
	expect(response).toContain('{"response":" answer"}');
	expect(response).not.toContain("SECRET");
});
