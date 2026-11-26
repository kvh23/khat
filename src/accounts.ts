import { timingSafeEqual } from "node:crypto";
import { usageGate } from "./quota";
import type { Env } from "./types";

const cookie = "__Host-khat_session";
const lifetime = 7 * 24 * 60 * 60;
const now = () => Math.floor(Date.now() / 1000);
const encoder = new TextEncoder();
export type Account = { id: string; username: string; role: "member" | "admin"; text_limit: number; image_limit: number };
type Credentials = Account & { salt: string; password_hash: string; active: number };

export const randomToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
export async function digest(text: string) {
	return Buffer.from(await crypto.subtle.digest("SHA-256", encoder.encode(text))).toString("hex");
}
async function passwordHash(env: Env, password: string, salt: string) {
	const namespace = env.PASSWORDS!;
	const shard = namespace.get(namespace.idFromName(salt.slice(0, 2)));
	const response = await shard.fetch("https://internal/derive", {
		method: "POST", body: JSON.stringify({ password, salt }),
	});
	if (!response.ok) throw new Error("Password derivation unavailable");
	const hash = await response.text();
	if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid password derivation");
	return hash;
}
const cookieValue = (value: string, maxAge: number) =>
	`${cookie}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

function token(request: Request) {
	for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
		const match = /^__Host-khat_session=([\w-]{43})$/.exec(part.trim());
		if (match) return match[1];
	}
	return null;
}

export async function authenticate(request: Request, db: D1Database): Promise<Account | null> {
	const session = token(request);
	if (!session) return null;
	return db.prepare(`SELECT a.id, a.username, a.role, a.text_limit, a.image_limit FROM sessions s
		JOIN accounts a ON a.id=s.owner WHERE s.digest=? AND s.expires>? AND a.active=1`)
		.bind(await digest(session), now()).first<Account>();
}

const name = (value: unknown) => typeof value === "string" && /^[a-z0-9_]{3,24}$/i.test(value.trim()) ? value.trim().toLowerCase() : null;
const validPassword = (value: unknown): value is string => typeof value === "string" && value.length >= 12 && value.length <= 128;
const fail = (status: number, error: string) => Response.json({ error }, { status });
const publicAccount = ({ id, username, role }: Account) => ({ id, username, role });

async function correct(env: Env, password: string, user: Credentials | null) {
	const submitted = await passwordHash(env, password, user?.salt ?? "khat-dummy-salt-unknown-account");
	return timingSafeEqual(Buffer.from(submitted, "hex"), Buffer.from(user?.password_hash ?? "0".repeat(64), "hex"));
}

async function session(db: D1Database, account: Account, request: Request) {
	const value = randomToken();
	const old = token(request);
	const result = await db.batch([
		db.prepare("DELETE FROM sessions WHERE expires<=? OR digest=?").bind(now(), old ? await digest(old) : ""),
		db.prepare(`DELETE FROM sessions WHERE owner=? AND digest NOT IN
			(SELECT digest FROM sessions WHERE owner=? ORDER BY expires DESC, digest LIMIT 4)`).bind(account.id, account.id),
		db.prepare("INSERT INTO sessions(digest,owner,expires) SELECT ?,id,? FROM accounts WHERE id=? AND active=1")
			.bind(await digest(value), now() + lifetime, account.id),
	]);
	if (!result[2].meta.changes) return fail(401, "accountInvalid");
	return Response.json({ account: publicAccount(account) }, { headers: { "Set-Cookie": cookieValue(value, lifetime) } });
}

export async function accountRoute(path: string, request: Request, input: Record<string, unknown>, env: Env, account: Account | null) {
	const db = env.DB!;
	if (path === "/api/session") return Response.json({ account: account ? publicAccount(account) : null });

	if (path === "/api/login" || path === "/api/register") {
		const username = name(input.username);
		if (!username || !validPassword(input.password)) return fail(400, "accountInvalid");
		let stage = "rate_limit";
		try {
			const ip = request.headers.get("CF-Connecting-IP") ?? "local";
			if (!(await env.AUTH_LIMIT.limit({ key: `account-ip:${ip}` })).success ||
				!(await env.AUTH_LIMIT.limit({ key: `account-name:${username}` })).success) return fail(429, "limited");
			if (path === "/api/login") {
				stage = "account_lookup";
				const user = await db.prepare("SELECT * FROM accounts WHERE username=?").bind(username).first<Credentials>();
				stage = "password_check";
				if (!(await correct(env, input.password, user)) || !user?.active) return fail(401, "accountInvalid");
				stage = "session_write";
				return await session(db, user, request);
			}
			if (typeof input.invite !== "string" || !/^[\w-]{43}$/.test(input.invite)) return fail(400, "inviteInvalid");
			stage = "invite_lookup";
			const invitation = await digest(input.invite);
			const available = await db.prepare("SELECT 1 FROM invitations WHERE digest=? AND expires>? AND redeemed_at IS NULL")
				.bind(invitation, now()).first();
			if (!available) return fail(400, "inviteInvalid");
			const id = crypto.randomUUID();
			const salt = randomToken();
			stage = "password_hash";
			const hash = await passwordHash(env, input.password, salt);
			const time = now();
			stage = "account_write";
			const result = await db.batch([
				db.prepare(`INSERT OR IGNORE INTO accounts(id,username,salt,password_hash,role)
					SELECT ?,?,?,?,role FROM invitations WHERE digest=? AND expires>? AND redeemed_at IS NULL`)
					.bind(id, username, salt, hash, invitation, time),
				db.prepare(`UPDATE invitations SET redeemed_at=? WHERE digest=? AND EXISTS(SELECT 1 FROM accounts WHERE id=?)`)
					.bind(time, invitation, id),
				db.prepare("INSERT INTO workspaces(owner) SELECT id FROM accounts WHERE id=?").bind(id),
			]);
			if (!result[0].meta.changes) return fail(400, "inviteInvalid");
			stage = "account_lookup";
			const user = await db.prepare("SELECT * FROM accounts WHERE id=?").bind(id).first<Account>();
			if (!user) throw new Error("Account unavailable after insert");
			stage = "session_write";
			return await session(db, user, request);
		} catch {
			// Use fixed identifiers only. Passwords, invitation codes, SQL errors,
			// usernames and cookies must never appear in diagnostic output.
			console.error("Khat account operation failed", { operation: path === "/api/register" ? "register" : "login", stage });
			return Response.json({ error: "unavailable", stage }, { status: 503 });
		}
	}
	if (!account) return fail(401, "signInRequired");

	if (path === "/api/logout") {
		const current = token(request);
		if (current) await db.prepare("DELETE FROM sessions WHERE owner=? AND digest=?").bind(account.id, await digest(current)).run();
		return new Response(null, { status: 204, headers: { "Set-Cookie": cookieValue("", 0) } });
	}
	if (path === "/api/delete-account") {
		if (!validPassword(input.password)) return fail(400, "accountInvalid");
		if (!(await env.AUTH_LIMIT.limit({ key: `account-delete:${account.id}` })).success) return fail(429, "limited");
		const user = await db.prepare("SELECT * FROM accounts WHERE id=?").bind(account.id).first<Credentials>();
		if (!await correct(env, input.password, user)) return fail(401, "accountInvalid");
		const result = await db.prepare(`DELETE FROM accounts WHERE id=? AND
			(role<>'admin' OR (SELECT COUNT(*) FROM accounts WHERE role='admin' AND active=1)>1)`).bind(account.id).run();
		if (!result.meta.changes) return fail(409, "lastAdmin");
		await usageGate(env).fetch("https://internal/erase-user", {
			method: "POST", body: JSON.stringify({ id: account.id }),
		}).catch(() => {});
		return new Response(null, { status: 204, headers: { "Set-Cookie": cookieValue("", 0) } });
	}
	return fail(404, "notFound");
}
