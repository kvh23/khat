import { digest, randomToken } from "./accounts";
import type { Account } from "./accounts";
import type { Env } from "./types";
import { usageGate } from "./quota";

export async function adminRoute(path: string, input: Record<string, unknown>, env: Env, admin: Account) {
	if (admin.role !== "admin") return Response.json({ error: "forbidden" }, { status: 403 });
	const db = env.DB!;
	if (path === "/api/admin") {
		const [users, usage] = await Promise.all([
			db.prepare("SELECT id,username,role,active,joined,text_limit,image_limit FROM accounts ORDER BY username LIMIT 100").all(),
			usageGate(env).fetch("https://internal/stats").then(response => response.json<{ users?: Record<string, unknown> }>()),
		]);
		const ids = new Set(users.results.map(user => user.id));
		return Response.json({ users: users.results, usage: {
			...usage, users: Object.fromEntries(Object.entries(usage.users ?? {}).filter(([id]) => ids.has(id))),
		} });
	}
	if (path === "/api/admin/invite") {
		const token = randomToken();
		const expires = Math.floor(Date.now() / 1000) + 86400 * 7;
		const invite = await db.prepare(`INSERT INTO invitations(digest,expires,issued_by)
			SELECT ?,?,? WHERE (SELECT COUNT(*) FROM invitations WHERE expires>? AND redeemed_at IS NULL)<20`)
			.bind(await digest(token), expires, admin.id, Math.floor(Date.now() / 1000)).run();
		if (!invite.meta.changes) return Response.json({ error: "limited" }, { status: 429 });
		return Response.json({ invite: token, expires });
	}
	if (path === "/api/admin/user") {
		const { id, active, textLimit, imageLimit } = input;
		if (typeof id !== "string" || typeof active !== "boolean" ||
			typeof textLimit !== "number" || !Number.isInteger(textLimit) || textLimit < 0 || textLimit > 35 ||
			typeof imageLimit !== "number" || !Number.isInteger(imageLimit) || imageLimit < 0 || imageLimit > 8)
			return Response.json({ error: "invalid" }, { status: 400 });
		const result = await db.batch([
			db.prepare("UPDATE accounts SET active=?,text_limit=?,image_limit=? WHERE id=? AND role='member'")
				.bind(Number(active), textLimit, imageLimit, id),
			db.prepare(`DELETE FROM sessions WHERE owner=? AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND active=0 AND role='member')`)
				.bind(id, id),
		]);
		return new Response(null, { status: result[0].meta.changes ? 204 : 404 });
	}
	return Response.json({ error: "notFound" }, { status: 404 });
}
