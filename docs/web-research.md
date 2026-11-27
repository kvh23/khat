# Web research with Tavily

Khat calls the Tavily Search REST endpoint from its authenticated Cloudflare Worker using the `TAVILY_API_KEY` secret. No package, local process, CLI integration or MCP server is required.

## Enable on Cloudflare

1. In the Tavily dashboard, confirm the account is on Researcher (free, 1,000 credits per month) and pay-as-you-go is off. Create or select a key dedicated to Khat. Share the free allowance with other workloads only if their consumption is accounted for.
2. In Cloudflare, open **Workers & Pages → khat → Settings → Variables and Secrets**. Add a **Secret** named `TAVILY_API_KEY` and paste the value directly into Cloudflare. Keep the secret out of source, build variables, client code and chat.
3. After review and deployment, sign in and select **Quick search**. Ask a nonpersonal question about recent public information. Confirm that source links open the retrieved pages. Verify usage in the Tavily dashboard and confirm the account remains on the free plan.

Khat reserves up to 800 credits per UTC calendar month globally and 120 per account. Quick costs one credit, Advanced two, and Deep at most three. Auto is opt-in and uses a local heuristic. Provider failures and exhausted credits fall back to Wikipedia. Reservations stay charged locally when a call fails, since the provider may already have counted them. The existing Cloudflare AI budget still applies to answer generation and includes retrieved excerpts.

Search is off by default. Khat sends only a bounded portion of the current message and skips obvious secrets, contact details and URL-bearing prompts. This is heuristic filtering. Temporary chats use Wikipedia only when search is enabled. Search snippets are untrusted reference text. The Worker enables Tavily safe search and the existing AI safety rules still apply. Khat stores credit counts in its existing usage object. There is no shared query cache.

Deep research is limited to the explicit question clauses in the current message. Direct URL extraction, cross-request caching and live stage streaming are outside this change. Automated coverage uses mocked provider responses. A live Tavily request requires an authorized key. Apple hardware was not available for testing.

[Path B](https://tavily.com/agent-setup/SKILL.md) · [Search API](https://docs.tavily.com/api-reference/endpoint/search) · [Tavily credits](https://docs.tavily.com/documentation/api-credits) · [Cloudflare pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
