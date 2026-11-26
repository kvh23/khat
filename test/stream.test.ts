import { describe, expect, it, vi } from "vitest";
import { readReply } from "../public/stream.js";

function stream(chunks: Uint8Array[]) {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			chunks.forEach(chunk => controller.enqueue(chunk));
			controller.close();
		},
	});
}

describe("SSE decoding", () => {
	it("reads both token formats across CRLF and UTF-8 chunk boundaries", async () => {
		const bytes = new TextEncoder().encode(
			'data: {"response":"Kø"}\r\n\r\ndata: {"choices":[{"delta":{"content":"benhavn"}}]}\n\ndata: [DONE]\n\n',
		);
		const update = vi.fn();
		expect(await readReply(stream(Array.from(bytes, byte => Uint8Array.of(byte))), update)).toBe("København");
		expect(update.mock.calls).toEqual([["Kø"], ["København"]]);
	});

	it("rejects incomplete and error streams", async () => {
		for (const data of ['data: {"response":"partial"}\n\n', 'data: {"error":"details"}\n\n']) {
			await expect(readReply(stream([new TextEncoder().encode(data)]), vi.fn())).rejects.toThrow("modelFailed");
		}
	});
});

it("holds back split reasoning tags and never displays reasoning deltas", async () => {
	const values = [
		{ response: "<th" }, { response: "ink>private" }, { response: " notes</think>" },
		{ choices: [{ delta: { reasoning_content: "internal" } }] }, { response: "Answer" },
	];
	const encoder = new TextEncoder();
	const packets = values.map(value => encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
	packets.push(encoder.encode("data: [DONE]\n\n"));
	const update = vi.fn();
	expect(await readReply(stream(packets), update)).toBe("Answer");
	expect(update.mock.calls).toEqual([["Answer"]]);
});
