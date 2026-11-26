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
