const encoder = new TextEncoder();

// This object stores nothing. Its internal binding gives the deliberately slow
// password derivation a separate CPU allowance from the public Free-plan Worker.
export class PasswordHasher {
	async fetch(request: Request) {
		const { password, salt } = await request.json<{ password: unknown; salt: unknown }>();
		if (typeof password !== "string" || password.length < 12 || password.length > 128 ||
			typeof salt !== "string" || !/^[\w-]{12,64}$/.test(salt)) return new Response(null, { status: 400 });
		const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
		const hash = await crypto.subtle.deriveBits({
			name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 600_000,
		}, key, 256);
		return new Response(Buffer.from(hash).toString("hex"));
	}
}
