export const models = {
	instant: { id: "@cf/meta/llama-3.1-8b-instruct-fp8", input: 13778, output: 26128 },
	think: { id: "@cf/qwen/qwen3-30b-a3b-fp8", input: 4625, output: 30475 },
	pro: { id: "@cf/google/gemma-4-26b-a4b-it", input: 9091, output: 27273 },
	legacy: { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", input: 26668, output: 204805 },
} as const;

type Model = keyof typeof models;
export type Mode = Model | "auto";

export function allowedMode(value: unknown): value is Mode {
	return typeof value === "string" && (value === "auto" || Object.hasOwn(models, value));
}

export function modelOrder(mode: Mode, prompt: string, contextSize: number): Model[] {
	const selected = mode === "auto" ? automatic(prompt, contextSize) : mode;
	if (selected === "pro") return ["pro", "legacy", "instant"];
	if (selected === "think") return ["think", "legacy", "instant"];
	if (selected === "legacy") return ["legacy", "instant"];
	return ["instant", "legacy"];
}

function automatic(prompt: string, contextSize: number): Model {
	if (contextSize >= 3500) return "pro";
	if (/\b(reason|prove|proof|analy[sz]e|debug|derive|compare|bevis|analysér?|fejlfind|sammenlign)\b/i.test(prompt)) return "think";
	return "instant";
}

export function estimatedNeurons(model: Model, messages: unknown, maxTokens: number): number {
	const inputBound = new TextEncoder().encode(JSON.stringify(messages)).length + 1024;
	const { input, output } = models[model];
	return Math.ceil((inputBound * input + maxTokens * output) / 1_000_000);
}
