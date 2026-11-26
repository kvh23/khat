import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";

const encoder = new TextEncoder();

// This object stores nothing. Its internal binding gives the deliberately slow
// password derivation a separate CPU allowance from the public Free-plan Worker.
export class PasswordHasher {
	async fetch(request: Request) {
		const { password, salt } = await request.json<{ password: unknown; salt: unknown }>();
		if (typeof password !== "string" || password.length < 12 || password.length > 128 ||
			typeof salt !== "string" || !/^[\w-]{12,64}$/.test(salt)) return new Response(null, { status: 400 });
		// Cloudflare's native Web Crypto and node:crypto PBKDF2 can reject
		// high iteration counts. Keep the original derivation and stored hash format.
		const hash = pbkdf2(sha256, encoder.encode(password), encoder.encode(salt), {
			c: 600_000, dkLen: 32,
		});
		return new Response(Buffer.from(hash).toString("hex"));
	}
}
