import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mailboxApi, deliverDailyDrafts } from '../server/mailbox.mjs';

function environment() {
 const sqlite = new DatabaseSync(':memory:');
 const env = { APP_ORIGIN: 'https://clientflock.test', MAIL_TOKEN_ENCRYPTION_KEY: btoa('12345678901234567890123456789012'), GMAIL_CLIENT_ID: 'gmail-client', GMAIL_CLIENT_SECRET: 'gmail-secret', MICROSOFT_CLIENT_ID: 'ms-client', MICROSOFT_CLIENT_SECRET: 'ms-secret', DB: { prepare(sql) { return { bind(...values) { return { first: async () => sqlite.prepare(sql).get(...values), run: async () => sqlite.prepare(sql).run(...values), all: async () => ({results: sqlite.prepare(sql).all(...values)}) }; } }; } } };
 return { env, sqlite };
}
const req = (path, cookie, body, method = body === undefined ? 'GET' : 'POST', headers = {}) => new Request('https://clientflock.test' + path, { method, headers: { origin: 'https://clientflock.test', ...(cookie ? {cookie} : {}), ...(body !== undefined ? {'content-type': 'application/json'} : {}), ...headers }, ...(body !== undefined ? {body: JSON.stringify(body)} : {}) });
async function browser(env) { const response = await mailboxApi(req('/api/mail/status'), env); return response.headers.get('set-cookie').split(';')[0]; }
async function connect(env, cookie, provider = 'gmail') {
 const response = await mailboxApi(req('/api/mail/connect?provider=' + provider, cookie), env); assert.equal(response.status, 200);
 const auth = new URL((await response.json()).url);
 const callback = '/api/mail/callback/' + provider + '?state=' + auth.searchParams.get('state') + '&code=code';
 const result = await mailboxApi(req(callback, cookie), env); assert.equal(result.status, 303); assert.match(result.headers.get('location'), /mail=connected/); return auth;
}
const content = key => ({to: 'owner@example.com', subject: 'a workshop idea', body: 'Your new ceramics workshops look great. Would a booking page help?', company: 'Workshop', delivery: 'now', idempotencyKey: key || crypto.randomUUID()});
function mockedFetch(t, handler) { const original = globalThis.fetch; globalThis.fetch = handler; t.after(() => {globalThis.fetch = original;}); }
const tokenResponse = () => Response.json({access_token: 'access', refresh_token: 'refresh', expires_in: 3600});

test('unconfigured mailbox is honest and does not allocate sessions or claim a connection', async () => {
 const response = await mailboxApi(req('/api/mail/status'), {}); assert.equal(response.status, 200); const data = await response.json(); assert.equal(data.configured, false); assert.equal(data.connected, false); assert.deepEqual(data.queue, []);
 assert.equal((await mailboxApi(req('/api/mail/drafts', null, content()), {})).status, 503);
 assert.equal(await mailboxApi(req('/api/unrelated'), {}), null);
});

test('OAuth uses browser-bound single-use PKCE, encrypts tokens, and does not request Outlook send permission', async t => {
 const {env, sqlite} = environment(); let exchange;
 mockedFetch(t, async (url, init) => {assert.match(String(url), /oauth2.*token/); exchange = new URLSearchParams(init.body); return tokenResponse();});
 const cookie = await browser(env), other = await browser(env);
 const start = await mailboxApi(req('/api/mail/connect?provider=outlook', cookie), env), auth = new URL((await start.json()).url);
 assert.equal(auth.searchParams.get('code_challenge_method'), 'S256'); assert.match(auth.searchParams.get('scope'), /Mail.ReadWrite/); assert.doesNotMatch(auth.searchParams.get('scope'), /Mail.Send/);
 const callback = '/api/mail/callback/outlook?state=' + auth.searchParams.get('state') + '&code=code';
 assert.match((await mailboxApi(req(callback, other), env)).headers.get('location'), /mail=error/);
 assert.match((await mailboxApi(req(callback, cookie), env)).headers.get('location'), /mail=connected/);
 assert.equal(exchange.get('code_verifier').length, 43);
 assert.match((await mailboxApi(req(callback, cookie), env)).headers.get('location'), /mail=error/);
 const connection = sqlite.prepare('SELECT * FROM mail_connections').get(); assert.ok(connection.tokens); assert.doesNotMatch(connection.tokens, /access|refresh/);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM mail_oauth').get().n, 0);
 assert.equal((await (await mailboxApi(req('/api/mail/status', cookie), env)).json()).connected, true);
 assert.equal((await (await mailboxApi(req('/api/mail/status', other), env)).json()).connected, false);
});

test('drafts are created once, remain editable in email app, and unsafe headers/cross-origin writes are rejected', async t => {
 const {env} = environment(); let creations = 0, payload;
 mockedFetch(t, async (url, init) => {
  if (String(url).includes('/token')) return tokenResponse();
  assert.equal(String(url), 'https://gmail.googleapis.com/gmail/v1/users/me/drafts'); creations++; payload = JSON.parse(init.body); return Response.json({id: 'draft-one'});
 });
 const cookie = await browser(env); await connect(env, cookie);
 const item = content(); const responses = await Promise.all([mailboxApi(req('/api/mail/drafts', cookie, item), env), mailboxApi(req('/api/mail/drafts', cookie, item), env)]);
 assert.ok(responses.every(r => r.status === 201)); assert.equal(creations, 1);
 const again = await (await mailboxApi(req('/api/mail/drafts', cookie, item), env)).json(); assert.equal(again.draft.status, 'created'); assert.equal(again.draft.openUrl, null); assert.equal(again.draft.instruction, 'Open Drafts in the email account you connected.'); assert.equal(creations, 1);
 const raw = atob(payload.message.raw.replace(/-/g, '+').replace(/_/g, '/')); assert.match(raw, /To: owner@example.com/); assert.match(raw, /Content-Type: text\/plain/);
 assert.equal((await mailboxApi(req('/api/mail/drafts', cookie, {...content(), subject: 'hi\r\nBcc: bad@example.com'}), env)).status, 400);
 assert.equal((await mailboxApi(req('/api/mail/drafts', cookie, content(), 'POST', {origin: 'https://evil.test'}), env)).status, 403);
 assert.equal((await mailboxApi(req('/api/mail/drafts', null, content()), env)).status, 401);
});

test('unknown provider result is not automatically retried and does not create duplicate drafts', async t => {
 const {env} = environment(); let creations = 0;
 mockedFetch(t, async url => {if (String(url).includes('/token')) return tokenResponse(); creations++; throw Error('connection lost after provider accepted');});
 const cookie = await browser(env); await connect(env, cookie); const item = content();
 const first = await (await mailboxApi(req('/api/mail/drafts', cookie, item), env)).json(); assert.equal(first.draft.status, 'check_mailbox');
 const again = await (await mailboxApi(req('/api/mail/drafts', cookie, item), env)).json(); assert.equal(again.draft.status, 'check_mailbox');
 await deliverDailyDrafts(env); assert.equal(creations, 1);
});

test('daily queue creates at most three drafts per mailbox and disconnect cancels remaining queue', async t => {
 const {env, sqlite} = environment(); let creations = 0;
 mockedFetch(t, async url => {if (String(url).includes('/token')) return tokenResponse(); creations++; return Response.json({id: 'draft-' + creations, webLink: 'https://outlook.office.com/mail/deeplink/compose/draft-' + creations});});
 const cookie = await browser(env); await connect(env, cookie, 'outlook');
 for (let i = 0; i < 5; i++) {
  const data = await (await mailboxApi(req('/api/mail/drafts', cookie, {...content(), delivery: 'daily'}), env)).json(); assert.equal(data.draft.status, 'queued'); assert.ok(new Date(data.draft.scheduledFor).getTime() > Date.now());
 }
 assert.equal(creations, 0); sqlite.prepare('UPDATE mail_drafts SET scheduled_at=?').run(Date.now() - 1000);
 const counts = await deliverDailyDrafts(env); assert.equal(counts.created, 3); assert.equal(creations, 3);
 await deliverDailyDrafts(env); assert.equal(creations, 3);
 assert.equal((await mailboxApi(req('/api/mail/disconnect', cookie, {}), env)).status, 200);
 assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM mail_drafts WHERE status='queued'").get().n, 0);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM mail_connections').get().n, 0);
});

test('MCP tokens isolate mailboxes, expire and revoke, and expose no send tool', async t => {
 const {env, sqlite} = environment(); mockedFetch(t, async () => tokenResponse());
 const cookie = await browser(env), second = await browser(env); await connect(env, cookie); await connect(env, second);
 const draft = await (await mailboxApi(req('/api/mail/drafts', cookie, {...content(), delivery: 'daily'}), env)).json();
 const tokenA = await (await mailboxApi(req('/api/mail/mcp-token', cookie, {}), env)).json(), tokenB = await (await mailboxApi(req('/api/mail/mcp-token', second, {}), env)).json();
 const call = (token, method, params = {}) => mailboxApi(req('/mcp', null, {jsonrpc: '2.0', id: 1, method, params}, 'POST', {authorization: 'Bearer ' + token}), env);
 const tools = await (await call(tokenA.token, 'tools/list')).json(); assert.ok(tools.result.tools.some(tool => tool.name === 'create_draft')); assert.ok(tools.result.tools.every(tool => !tool.name.includes('send')));
 const a = await (await call(tokenA.token, 'tools/call', {name: 'list_drafts'})).json(); assert.equal(JSON.parse(a.result.content[0].text).length, 1);
 const b = await (await call(tokenB.token, 'tools/call', {name: 'list_drafts'})).json(); assert.deepEqual(JSON.parse(b.result.content[0].text), []);
 const edit = await (await call(tokenB.token, 'tools/call', {name: 'edit_queued_draft', arguments: {...content(), id: draft.draft.id}})).json(); assert.equal(edit.result.isError, true);
 assert.equal((await call('cfm_' + 'x'.repeat(43), 'tools/list')).status, 401);
 assert.ok(!sqlite.prepare('SELECT * FROM mail_mcp').all().some(row => row.token_hash === tokenA.token));
 await mailboxApi(req('/api/mail/disconnect', cookie, {}), env); assert.equal((await call(tokenA.token, 'tools/list')).status, 401);
 sqlite.prepare('UPDATE mail_mcp SET expires_at=0').run(); assert.equal((await call(tokenB.token, 'tools/list')).status, 401);
});

test('queued draft edits and cancellation require the owner and do not alter created mailbox drafts', async t => {
 const {env} = environment(); mockedFetch(t, async () => tokenResponse()); const cookie = await browser(env), other = await browser(env); await connect(env, cookie); await connect(env, other);
 const item = await (await mailboxApi(req('/api/mail/drafts', cookie, {...content(), delivery:'daily'}), env)).json();
 const path = '/api/mail/drafts/' + item.draft.id;
 assert.equal((await mailboxApi(req(path, other, {...content(), subject:'changed'}, 'PATCH'), env)).status, 409);
 const edited = await (await mailboxApi(req(path, cookie, {...content(), subject:'changed'}, 'PATCH'), env)).json(); assert.equal(edited.draft.subject, 'changed');
 assert.equal((await mailboxApi(req(path, other, {}, 'DELETE'), env)).status, 404);
 assert.equal((await mailboxApi(req(path, cookie, {}, 'DELETE'), env)).status, 200);
});


test('request bodies are capped while streaming, including multi-byte data without content-length', async t => {
 const {env} = environment(); mockedFetch(t, async () => tokenResponse()); const cookie = await browser(env); await connect(env, cookie);
 let cancelled = false, readChunks = 0;
 const stream = new ReadableStream({ pull(controller) { readChunks++; controller.enqueue(new Uint8Array(7000).fill(65)); }, cancel() { cancelled = true; } });
 const oversized = new Request('https://clientflock.test/api/mail/drafts', {method:'POST', headers:{origin:'https://clientflock.test',cookie}, body:stream, duplex:'half'});
 const response = await mailboxApi(oversized, env); assert.equal(response.status, 413); assert.equal(cancelled, true); assert.ok(readChunks <= 4);
 const bytes = {...content(), body:'é'.repeat(11000)};
 assert.equal((await mailboxApi(req('/api/mail/drafts', cookie, bytes), env)).status, 413);
 const declared = req('/api/mail/drafts', cookie, content(), 'POST', {'content-length':'20001'});
 assert.equal((await mailboxApi(declared, env)).status, 413);
});

test('only provider-returned Outlook links are used, and guessed default-account links are absent', async t => {
 const {env} = environment(); let mode = 'unsafe';
 mockedFetch(t, async url => {if(String(url).includes('/token')) return tokenResponse(); return Response.json({id:'draft-' + mode, webLink:mode === 'safe' ? 'https://outlook.office.com/mail/deeplink/compose/my-draft' : 'https://evil.test/draft'});});
 const cookie = await browser(env); await connect(env, cookie, 'outlook');
 const unsafe = await(await mailboxApi(req('/api/mail/drafts',cookie,content()),env)).json(); assert.equal(unsafe.draft.openUrl,null); assert.match(unsafe.draft.instruction,/account you connected/);
 mode='safe';const safe = await(await mailboxApi(req('/api/mail/drafts',cookie,content()),env)).json(); assert.equal(safe.draft.openUrl,'https://outlook.office.com/mail/deeplink/compose/my-draft'); assert.equal(safe.draft.instruction,null);
});
