import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageGate } from "../src/quota";

function gate() {
	const data = new Map();
	let queue = Promise.resolve();
	const state = {
		storage: {
			transaction(callback: (tx: unknown) => unknown) {
				const result = queue.then(() => callback({
					get: (key: string) => structuredClone(data.get(key)),
					put: (key: string, value: unknown) => data.set(key, structuredClone(value)),
				}));
				queue = result.then(() => {});
				return result;
			},
		},
	} as unknown as DurableObjectState;
	const worker = new UsageGate(state);
	return async (kind: string, neurons = 1, owner = "test") => (await worker.fetch(new Request(kind === "search" ? "https://internal/search" : "https://internal/reserve", {
		method: "POST", body: JSON.stringify({ kind, neurons, credits: neurons, owner }),
	}))).status;
}

afterEach(() => vi.useRealTimers());

describe("daily account quota", () => {
	it("serializes reservations, has distinct counts for images and text, and resets by UTC day", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-11-26T23:59:59Z"));
		const reserve = gate();
		const images = await Promise.all(Array.from({ length: 10 }, () => reserve("image")));
		const text = await Promise.all(Array.from({ length: 36 }, () => reserve("text")));
		expect(images.filter(status => status === 204)).toHaveLength(8);
		expect(text.filter(status => status === 204)).toHaveLength(35);
		vi.setSystemTime(new Date("2026-11-27T00:00:00Z"));
		expect(await reserve("image")).toBe(204);
		expect(await reserve("text")).toBe(204);
	});

	it("shares one neuron budget across images, text and retries", async () => {
		const reserve = gate();
		expect(await reserve("image", 500)).toBe(204);
		expect(await reserve("text", 4000)).toBe(204);
		expect(await reserve("retry", 3500)).toBe(204);
		expect(await reserve("retry")).toBe(429);
		expect(await reserve("image")).toBe(429);
	});
});

it("reserves search credits atomically and resets them monthly", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-11-30T23:59:59Z"));
	const reserve = gate();
	const batch = await Promise.all(Array.from({ length: 61 }, () => reserve("search", 2)));
	expect(batch.filter(status => status === 204)).toHaveLength(60);
	expect(await reserve("search")).toBe(429);
	vi.setSystemTime(new Date("2026-12-01T00:00:00Z"));
	expect(await reserve("search")).toBe(204);
});
