import { pbkdf2Sync } from "node:crypto";
import { expect, it } from "vitest";
import { PasswordHasher } from "../src/password-hasher";

it("keeps existing PBKDF2-SHA-256 hashes compatible, including Unicode passwords", async () => {
	const password = "Prøvekode med æøå 🔑";
	const salt = "password-hash-compatibility-fixture";
	const expected = pbkdf2Sync(password, salt, 600_000, 32, "sha256").toString("hex");
	const hasher = new PasswordHasher();
	const response = await hasher.fetch(new Request("https://internal/derive", {
		method: "POST", body: JSON.stringify({ password, salt }),
	}));
	expect(response.status).toBe(200);
	expect(await response.text()).toBe(expected);
});
