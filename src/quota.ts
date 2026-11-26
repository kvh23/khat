import type { Account } from "./accounts";
import type { Env } from "./types";

const DAILY_BUDGET = 8000;

type Kind = "text" | "image" | "retry";
type Counts = { text: number; image: number };
type Usage = Counts & { day: string; neurons: number; users?: Record<string, Counts> };

export class UsageGate {
	constructor(private readonly state: DurableObjectState) {}

	async fetch(request: Request): Promise<Response> {
		const day = new Date().toISOString().slice(0, 10);
		if (new URL(request.url).pathname === "/stats") {
			const stats = await this.state.storage.get<Usage>("usage");
			return Response.json(stats?.day === day ? stats : { day, text: 0, image: 0, neurons: 0, users: {} });
		}
		if (new URL(request.url).pathname === "/erase-user") {
			const { id } = await request.json<{ id: string }>();
			await this.state.storage.transaction(async tx => {
				const stored = await tx.get<Usage>("usage");
				if (!stored?.users || !Object.hasOwn(stored.users, id)) return;
				delete stored.users[id];
				await tx.put("usage", stored);
			});
			return new Response(null, { status: 204 });
		}
		const { kind, neurons, account } = await request.json<{ kind: Kind; neurons: number; account?: Account }>();
		if (!["text", "image", "retry"].includes(kind) ||
			!Number.isSafeInteger(neurons) || neurons < 1 || neurons > DAILY_BUDGET) return new Response(null, { status: 400 });
		const accepted = await this.state.storage.transaction(async tx => {
			const previous = await tx.get<Usage>("usage");
			const usage = previous?.day === day ? previous : { day, text: 0, image: 0, neurons: 0 };
			if (usage.neurons + neurons > DAILY_BUDGET || (kind === "text" && usage.text >= 35) ||
				(kind === "image" && usage.image >= 8)) return false;
			if (account && kind !== "retry") {
				usage.users ??= {};
				const counts = usage.users[account.id] ?? { text: 0, image: 0 };
				if (counts[kind] >= (kind === "text" ? account.text_limit : account.image_limit)) return false;
				counts[kind]++;
				usage.users[account.id] = counts;
			}
			usage.neurons += neurons;
			if (kind !== "retry") usage[kind]++;
			await tx.put("usage", usage);
			return true;
		});
		return new Response(null, { status: accepted ? 204 : 429 });
	}
}

export function usageGate(env: Env) {
	return env.USAGE.get(env.USAGE.idFromName("khat-account"));
}
export async function reserve(env: Env, kind: Kind, neurons: number, account?: Account | null) {
	if (neurons > DAILY_BUDGET) return false;
	const gate = usageGate(env);
	const response = await gate.fetch("https://internal/reserve", {
		method: "POST",
		body: JSON.stringify({ kind, neurons, account: account ?? undefined }),
	});
	if (response.status === 429) return false;
	if (response.status !== 204) throw new Error("Quota unavailable");
	return true;
}
