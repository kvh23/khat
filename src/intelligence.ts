export const models = {
	instant: { id: "@cf/ibm-granite/granite-4.0-h-micro", input: 1542, output: 10158 },
	think: { id: "@cf/zai-org/glm-4.7-flash", input: 5500, output: 36400 },
	pro: { id: "@cf/google/gemma-4-26b-a4b-it", input: 9091, output: 27273 },
	legacy: { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", input: 26668, output: 204805 },
	instantClassic: { id: "@cf/meta/llama-3.1-8b-instruct-fp8", input: 13778, output: 26128 },
	thinkClassic: { id: "@cf/qwen/qwen3-30b-a3b-fp8", input: 4625, output: 30475 },
} as const;

type Model = keyof typeof models;
export type Mode = Model | "auto";

export function allowedMode(value: unknown): value is Mode {
	return typeof value === "string" && (value === "auto" || Object.hasOwn(models, value));
}

export function modelOrder(mode: Mode, prompt: string, contextSize: number, language = "en"): Model[] {
	const selected = mode === "auto" ? automatic(prompt, contextSize) : mode;
	if (mode === "auto") {
		if (selected === "pro") return ["pro", "think", "instant", "legacy"];
		if (selected === "think") return ["think", "instant", "legacy"];
		if (language === "da") return ["thinkClassic", "instant", "legacy"];
	}
	if (selected === "pro") return ["pro", "legacy", "instant"];
	if (selected === "think") return ["think", "legacy", "instant"];
	if (selected === "legacy") return ["legacy", "instant"];
	if (selected === "instantClassic") return ["instantClassic", "instant"];
	if (selected === "thinkClassic") return ["thinkClassic", "think", "instant"];
	return ["instant", "legacy"];
}

function automatic(prompt: string, contextSize: number): Model {
	if (contextSize >= 3500) return "pro";
	if (/\b(reason|prove|proof|analy[sz]e|debug|derive|compare|algorithm|refactor|math|ligning|beregn|debugging|bevis|analysér?|fejlfind|sammenlign)\b/i.test(prompt)) return "think";
	return "instant";
}

export function estimatedNeurons(model: Model, messages: unknown, maxTokens: number): number {
	const inputBound = new TextEncoder().encode(JSON.stringify(messages)).length + 1024;
	const { input, output } = models[model];
	return Math.ceil((inputBound * input + maxTokens * output) / 1_000_000);
}
