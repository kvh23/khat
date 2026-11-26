import type { Env } from "./types";

const DAILY_BUDGET = 8000;

type Kind = "text" | "image" | "retry";
type Usage = { day: string; text: number; image: number; neurons: number };

export class UsageGate {
	constructor(private readonly state: DurableObjectState) {}

	async fetch(request: Request): Promise<Response> {
		const { kind, neurons } = await request.json<{ kind: Kind; neurons: number }>();
		if (!["text", "image", "retry"].includes(kind) ||
			!Number.isSafeInteger(neurons) || neurons < 1 || neurons > DAILY_BUDGET) return new Response(null, { status: 400 });
		const day = new Date().toISOString().slice(0, 10);
		const accepted = await this.state.storage.transaction(async tx => {
			const previous = await tx.get<Usage>("usage");
			const usage = previous?.day === day ? previous : { day, text: 0, image: 0, neurons: 0 };
			if (usage.neurons + neurons > DAILY_BUDGET || (kind === "text" && usage.text >= 35) ||
				(kind === "image" && usage.image >= 8)) return false;
			usage.neurons += neurons;
			if (kind !== "retry") usage[kind]++;
			await tx.put("usage", usage);
			return true;
		});
		return new Response(null, { status: accepted ? 204 : 429 });
	}
}

export async function reserve(env: Env, kind: Kind, neurons: number) {
	if (neurons > DAILY_BUDGET) return false;
	const gate = env.USAGE.get(env.USAGE.idFromName("khat-account"));
	const response = await gate.fetch("https://internal/reserve", {
		method: "POST",
		body: JSON.stringify({ kind, neurons }),
	});
	if (response.status === 429) return false;
	if (response.status !== 204) throw new Error("Quota unavailable");
	return true;
}
