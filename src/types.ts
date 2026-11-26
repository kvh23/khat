interface RateLimiter {
	limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
	AI: Ai;
	DB?: D1Database;
	PASSWORDS?: DurableObjectNamespace;
	ACCOUNTS_REQUIRED?: string;
	ASSETS: { fetch(request: Request): Promise<Response> };
	KHAT_PASSWORD?: string;
	AUTH_LIMIT: RateLimiter;
	CHAT_LIMIT: RateLimiter;
	USAGE: DurableObjectNamespace;
}
