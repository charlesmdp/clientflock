# ClientFlock

A Cloudflare Workers + D1 MVP: website or business description → mission → market research → ideal-client lists → 3 sourced companies → checked source quotes → short email drafts.

Two landing layouts: `/` and `/split.html`. Eleven profession examples rotate three at a time. Examples are clearly fictional; actual searches use the server pipeline.

## Runtime

- `server/research.mjs`: HTTP API, resumable stages, Responses API background jobs, source verification, budgets.
- `db/schema.ts`, `drizzle/`: D1 schema and migrations.
- `public/`: assets, profession demos, live research interface.
- `content/`: landing HTML.
- `worker/`: existing Sites-hosted Cloudflare runtime.
- `cloudflare/`: standalone Worker entry and Wrangler configuration for your own Cloudflare account. No framework build needed for this entry.

The model defaults to `gpt-6-luna`. Configure `OPENAI_MODEL` to change it. No automatic expensive model escalation. OpenAI web search discovers companies; bounded HTTP fetches check exact prospect quotes against source pages. Pages that cannot be checked cause an explicit pause. No paywall, no automatic email sending.

## Cloudflare deployment in your account

Install with `npm install` (Node >=22.13), then authenticate Wrangler with your Cloudflare account. Create D1 using `npx wrangler d1 create clientflock`, and put its returned `database_id` in `cloudflare/wrangler.jsonc` under `d1_databases`. Apply schema with `npx wrangler d1 migrations apply DB --remote --config cloudflare/wrangler.jsonc`. Deploy with `npx wrangler deploy --config cloudflare/wrangler.jsonc`.

Set `OPENAI_API_KEY` as an encrypted Cloudflare Worker secret using the Cloudflare dashboard. Do not put it in source, GitHub, browser code or a public environment variable. The existing managed deployment alternatively supports an RSA-OAEP/SHA-256 encrypted key envelope via two server secrets, `OPENAI_KEY_CIPHERTEXT` and `OPENAI_KEY_PRIVATE_JWK`, decrypted only in server memory. Neither secret belongs in Git.

The standalone deployment is separate from the existing managed Site. Creating the GitHub repository does not connect it to your own Cloudflare account. D1 and secrets must be provisioned in that account.

## Cache and resumption

Public website input is canonicalized to HTTPS hostname, stripping `www`, path and query. Cache version `v1`, TTL 7 days. Simultaneous equivalent searches join one row through a unique key. Completed results cause no provider calls. Descriptions receive a private random cache key and cannot be looked up by submitting the same text. Search IDs are unguessable bearer capabilities: keep them private. The UI stores only the resume ID on the current browser. Stages advance while the research window is open; completed work persists when closed. OpenAI background calls already launched may finish after close.

D1 leases prevent simultaneous stage processing. There is a small crash window between creating a provider request and saving its ID; an interrupted submission can be retried and charged again. Search budget: 20 new jobs/day globally, 5/day per IP (user ID/local fallback), and 100 provider requests/day globally. Configure limits deliberately before public launch. These are count limits, not exact currency caps; set a provider spending budget too. Expired rows are replaced when searched again; no scheduled deletion is implemented yet.

## Reliability and current limits

- Three documents are generated before company research. Word ranges checked: 200–300 / 250–350 / 500–700. A failed constraint pauses and can be retried.
- Market figures are instructed to be sourced; figures are not independently recalculated. Documents distinguish hypotheses from observed facts.
- Exact prospect quotes are matched against public source HTML before emails are drafted. This confirms the quoted text, not the prospect's purchasing intent or every generated inference.
- Emails are drafts: subject lowercase, <=6 words, no emoji; <=6 short sentences and a final question. Review before sending.
- No Icypeas, Findymail or FullEnrich credentials are connected yet. Results provide a company contact page and a suggested decision-maker role. They do not claim verified personal email addresses.
- No browser-rendering fallback yet. Blocked or JavaScript-only source pages can pause the verification step. HTTP safety rejects non-public hostnames/IPs, non-HTTPS sources, credentials and custom ports and checks DNS for redirects; DNS rebinding remains a limitation of preflight DNS plus fetch and should be hardened before untrusted public deployment.
- Origin checks and application rate budgets are included. The current managed Site remains owner-private. Before a public launch, add Cloudflare Turnstile/rate limiting and a retention policy.

## Validation

`node --test tests/research.test.mjs` checks canonicalization, concurrent cache reuse semantics, completed cache hits, private descriptions, origin checks, setup errors and email constraints using SQLite. `npm run build` validates the managed Cloudflare bundle. The standalone Worker can be checked with `npx wrangler deploy --dry-run --config cloudflare/wrangler.jsonc`.

Docs: [OpenAI models](https://developers.openai.com/api/docs/models), [Responses background](https://developers.openai.com/api/docs/guides/background), [web search](https://developers.openai.com/api/docs/guides/tools-web-search), [Cloudflare static assets](https://developers.cloudflare.com/workers/static-assets/binding/).
