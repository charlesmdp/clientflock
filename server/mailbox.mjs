// Draft-only mailbox bridge. This module intentionally contains no send endpoint.
const COOKIE = '__Host-cf_mail';
const DAY = 86400000;
const SESSION_DAYS = 90;
const MAX_DAILY = 3;
const encoder = new TextEncoder();
const booted = new WeakMap();
const providers = {
  gmail: { id: 'GMAIL_CLIENT_ID', secret: 'GMAIL_CLIENT_SECRET', authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/gmail.compose' },
  outlook: { id: 'MICROSOFT_CLIENT_ID', secret: 'MICROSOFT_CLIENT_SECRET', authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', scope: 'offline_access https://graph.microsoft.com/Mail.ReadWrite' }
};
const schema = [
  `CREATE TABLE IF NOT EXISTS mail_sessions(id TEXT PRIMARY KEY,expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS mail_connections(owner TEXT PRIMARY KEY,provider TEXT NOT NULL,tokens TEXT NOT NULL,updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS mail_oauth(state TEXT PRIMARY KEY,owner TEXT NOT NULL,provider TEXT NOT NULL,verifier TEXT NOT NULL,expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS mail_drafts(id TEXT PRIMARY KEY,owner TEXT NOT NULL,request_key TEXT NOT NULL,recipient TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,company TEXT NOT NULL,status TEXT NOT NULL,scheduled_at INTEGER NOT NULL,provider_id TEXT,open_url TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(owner,request_key))`,
  `CREATE INDEX IF NOT EXISTS mail_drafts_owner ON mail_drafts(owner,status,scheduled_at)`,
  `CREATE TABLE IF NOT EXISTS mail_daily(owner TEXT NOT NULL,day TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(owner,day))`,
  `CREATE TABLE IF NOT EXISTS mail_mcp(token_hash TEXT PRIMARY KEY,owner TEXT NOT NULL,expires_at INTEGER NOT NULL)`
];
const statement = (env, sql, args = []) => env.DB.prepare(sql).bind(...args);
const first = (env, sql, ...args) => statement(env, sql, args).first();
const run = (env, sql, ...args) => statement(env, sql, args).run();
const rows = async (env, sql, ...args) => (await statement(env, sql, args).all()).results || [];
async function setup(env) {
  if (!env.DB) throw problem(503, 'Mailbox storage is not configured yet.');
  if (!booted.has(env.DB)) booted.set(env.DB, (async () => { for (const sql of schema) await run(env, sql); })().catch(error => { booted.delete(env.DB); throw error; }));
  await booted.get(env.DB);
}
function problem(status, message) { const error = new Error(message); error.status = status; return error; }
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const b64url = bytes => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const hash = async text => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))));
function appOrigin(env) {
  try { const u = new URL(env.APP_ORIGIN); return u.protocol === 'https:' && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash ? u.origin : null; } catch { return null; }
}
function keyBytes(env) { try { const bytes = unb64(String(env.MAIL_TOKEN_ENCRYPTION_KEY || '')); return bytes.length === 32 ? bytes : null; } catch { return null; } }
const ready = env => !!env.DB && !!appOrigin(env) && !!keyBytes(env);
const providerReady = (env, name) => ready(env) && !!env[providers[name]?.id] && !!env[providers[name]?.secret];
async function crypt(env, value, context, decrypt = false) {
  const bytes = keyBytes(env); if (!bytes) throw problem(503, 'Mailbox encryption is not configured yet.');
  const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, [decrypt ? 'decrypt' : 'encrypt']);
  if (decrypt) {
    const [iv, data] = value.split('.');
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: encoder.encode(context) }, key, unb64(data)));
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) }, key, encoder.encode(value));
  return b64(iv) + '.' + b64(new Uint8Array(cipher));
}
function json(data, status = 200, cookie) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(cookie ? { 'set-cookie': cookie } : {}) } });
}
function sameOrigin(request, env) {
  const allowed = appOrigin(env); if (!allowed || new URL(request.url).origin !== allowed) throw problem(403, 'Open ClientFlock on its configured website to connect your mailbox.');
  const origin = request.headers.get('origin');
  if (origin) { if (origin !== allowed) throw problem(403, 'This request must come from ClientFlock.'); return; }
  if (request.headers.get('sec-fetch-site') === 'same-origin') return;
  try { if (new URL(request.headers.get('referer')).origin === allowed) return; } catch {}
  throw problem(403, 'This request must come from ClientFlock.');
}
function cookieFor(token) { return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`; }
async function session(request, env, create = false) {
  const raw = (request.headers.get('cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  if (raw && /^[A-Za-z0-9_-]{43}$/.test(raw)) {
    const id = await hash(raw); const current = await first(env, 'SELECT id FROM mail_sessions WHERE id=? AND expires_at>?', id, Date.now());
    if (current) return { id };
  }
  if (!create) throw problem(401, 'Connect your mailbox to continue.');
  const token = random(), id = await hash(token);
  await run(env, 'INSERT INTO mail_sessions(id,expires_at) VALUES(?,?)', id, Date.now() + SESSION_DAYS * DAY);
  return { id, cookie: cookieFor(token) };
}
async function input(request) {
  if (Number(request.headers.get('content-length') || 0) > 20000) throw problem(413, 'Draft is too large.');
  const reader = request.body?.getReader();
  const chunks = []; let size = 0;
  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 20000) { await reader.cancel(); throw problem(413, 'Draft is too large.'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw problem(400, 'Invalid request.'); }
  try { const value = JSON.parse(text || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; } catch { throw problem(400, 'Invalid request.'); }
}
function draftInput(value) {
  const to = String(value.to || '').trim(), subject = String(value.subject || '').trim(), body = String(value.body || ''), company = String(value.company || '').trim();
  if (!/^[A-Za-z0-9.!#$%&'*+\/= ?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(to) || /[\r\n\s]/.test(to) || to.length > 254) throw problem(400, 'Use one valid recipient email address.');
  if (!subject || subject.length > 200 || /[\r\n]/.test(subject)) throw problem(400, 'Use a subject of 1 to 200 characters without line breaks.');
  if (!body.trim() || body.length > 12000) throw problem(400, 'Use a message of 1 to 12,000 characters.');
  if (company.length > 200) throw problem(400, 'Company name is too long.');
  return { to, subject, body, company };
}
function publicDraft(row) { return { id: row.id, to: row.recipient, subject: row.subject, body: row.body, company: row.company, status: row.status, scheduledFor: row.status === 'queued' ? new Date(row.scheduled_at).toISOString() : null, openUrl: row.open_url || null, instruction: row.status === 'created' && !row.open_url ? 'Open Drafts in the email account you connected.' : null }; }
function nextMorning() { const date = new Date(); date.setUTCDate(date.getUTCDate() + 1); date.setUTCHours(9, 0, 0, 0); return date.getTime(); }
async function fetchJson(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15000), redirect: 'error' });
  let data; try { data = await response.json(); } catch { throw problem(502, 'The mailbox provider returned an unexpected response.'); }
  if (!response.ok) throw problem(response.status === 401 || response.status === 403 ? 401 : 502, response.status === 401 || response.status === 403 ? 'Reconnect your mailbox to prepare drafts.' : 'Your mailbox provider is temporarily unavailable.');
  return data;
}
async function accessToken(env, owner, connection) {
  const tokens = JSON.parse(await crypt(env, connection.tokens, owner, true));
  if (tokens.access_token && tokens.expires_at > Date.now() + 60000) return tokens.access_token;
  const provider = providers[connection.provider];
  const body = new URLSearchParams({ client_id: env[provider.id], client_secret: env[provider.secret], grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
  if (connection.provider === 'outlook') body.set('scope', provider.scope);
  const fresh = await fetchJson(provider.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!fresh.access_token) throw problem(401, 'Reconnect your mailbox to prepare drafts.');
  const updated = { access_token: fresh.access_token, refresh_token: fresh.refresh_token || tokens.refresh_token, expires_at: Date.now() + Math.max(60, Number(fresh.expires_in) || 3600) * 1000 };
  await run(env, 'UPDATE mail_connections SET tokens=?,updated_at=? WHERE owner=? AND tokens=?', await crypt(env, JSON.stringify(updated), owner), Date.now(), owner, connection.tokens);
  return updated.access_token;
}
function gmailMessage(draft) {
  const subject = '=?UTF-8?B?' + b64(encoder.encode(draft.subject)) + '?=';
  const body = b64(encoder.encode(draft.body)).match(/.{1,76}/g)?.join('\r\n') || '';
  return b64url(encoder.encode(`To: ${draft.recipient}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${body}`));
}
async function dispatch(env, owner, id) {
  const connection = await first(env, 'SELECT * FROM mail_connections WHERE owner=?', owner);
  if (!connection || !providerReady(env, connection.provider)) throw problem(409, 'Connect your mailbox before preparing a draft.');
  const claimed = await first(env, "UPDATE mail_drafts SET status='preparing',updated_at=? WHERE id=? AND owner=? AND status='queued' RETURNING *", Date.now(), id, owner);
  if (!claimed) return first(env, 'SELECT * FROM mail_drafts WHERE id=? AND owner=?', id, owner);
  const day = new Date().toISOString().slice(0, 10);
  const budget = await first(env, `INSERT INTO mail_daily(owner,day,count) VALUES(?,?,1) ON CONFLICT(owner,day) DO UPDATE SET count=count+1 WHERE count<? RETURNING count`, owner, day, MAX_DAILY);
  if (!budget) {
    await run(env, "UPDATE mail_drafts SET status='queued',scheduled_at=?,updated_at=? WHERE id=? AND owner=?", nextMorning(), Date.now(), id, owner);
    return first(env, 'SELECT * FROM mail_drafts WHERE id=? AND owner=?', id, owner);
  }
  let token;
  try { token = await accessToken(env, owner, connection); }
  catch { await run(env, "UPDATE mail_drafts SET status='reconnect_required',updated_at=? WHERE id=? AND owner=?", Date.now(), id, owner); return first(env, 'SELECT * FROM mail_drafts WHERE id=? AND owner=?', id, owner); }
  // Persist before the external write. An uncertain outcome is never retried automatically.
  await run(env, "UPDATE mail_drafts SET status='dispatching',updated_at=? WHERE id=? AND owner=?", Date.now(), id, owner);
  try {
    const payload = connection.provider === 'gmail' ? { message: { raw: gmailMessage(claimed) } } : { subject: claimed.subject, body: { contentType: 'Text', content: claimed.body }, toRecipients: [{ emailAddress: { address: claimed.recipient } }] };
    const url = connection.provider === 'gmail' ? 'https://gmail.googleapis.com/gmail/v1/users/me/drafts' : 'https://graph.microsoft.com/v1.0/me/messages';
    const result = await fetchJson(url, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    if (!result.id) throw Error('Missing draft id');
    // Browser account indexes do not identify the OAuth-connected mailbox. Never guess /u/0.
    let openUrl = null;
    if (connection.provider === 'outlook' && typeof result.webLink === 'string') { try { const u = new URL(result.webLink); if (u.protocol === 'https:' && ['outlook.office.com', 'outlook.office365.com', 'outlook.live.com'].includes(u.hostname)) openUrl = u.href; } catch {} }
    await run(env, "UPDATE mail_drafts SET status='created',provider_id=?,open_url=?,updated_at=? WHERE id=? AND owner=? AND status='dispatching'", String(result.id).slice(0, 1000), openUrl, Date.now(), id, owner);
  } catch {
    await run(env, "UPDATE mail_drafts SET status='check_mailbox',updated_at=? WHERE id=? AND owner=? AND status='dispatching'", Date.now(), id, owner);
  }
  return first(env, 'SELECT * FROM mail_drafts WHERE id=? AND owner=?', id, owner);
}
async function createDraft(env, owner, value) {
  const content = draftInput(value), key = String(value.idempotencyKey || '');
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw problem(400, 'A unique draft request key is required.');
  if (value.delivery !== 'now' && value.delivery !== 'daily') throw problem(400, 'Choose immediate or daily draft preparation.');
  if (!await first(env, 'SELECT owner FROM mail_connections WHERE owner=?', owner)) throw problem(409, 'Connect your mailbox first.');
  const old = await first(env, 'SELECT * FROM mail_drafts WHERE owner=? AND request_key=?', owner, key);
  if (old) return old;
  const id = crypto.randomUUID(), now = Date.now(), scheduled = value.delivery === 'daily' ? nextMorning() : now;
  await run(env, `INSERT OR IGNORE INTO mail_drafts(id,owner,request_key,recipient,subject,body,company,status,scheduled_at,created_at,updated_at) SELECT ?,?,?,?,?,?,?,'queued',?,?,? WHERE (SELECT COUNT(*) FROM mail_drafts WHERE owner=? AND status='queued')<30`, id, owner, key, content.to, content.subject, content.body, content.company, scheduled, now, now, owner);
  let row = await first(env, 'SELECT * FROM mail_drafts WHERE owner=? AND request_key=?', owner, key);
  if (!row) throw problem(429, 'Your draft queue is full. Review or cancel queued drafts first.');
  if (value.delivery === 'now' && row.status === 'queued') row = await dispatch(env, owner, row.id);
  return row;
}
async function editDraft(env, owner, id, value) {
  const draft = draftInput(value);
  const row = await first(env, "UPDATE mail_drafts SET recipient=?,subject=?,body=?,company=?,updated_at=? WHERE id=? AND owner=? AND status='queued' RETURNING *", draft.to, draft.subject, draft.body, draft.company, Date.now(), id, owner);
  if (!row) throw problem(409, 'Only your queued drafts can be edited here. Edit created drafts in your mailbox.');
  return row;
}
async function connect(request, env, owner, providerName) {
  if (!providers[providerName] || !providerReady(env, providerName)) throw problem(503, 'This mailbox connection is not configured yet.');
  const config = providers[providerName], state = random(), verifier = random();
  await run(env, 'DELETE FROM mail_oauth WHERE owner=? OR expires_at<?', owner, Date.now());
  await run(env, 'INSERT INTO mail_oauth(state,owner,provider,verifier,expires_at) VALUES(?,?,?,?,?)', await hash(state), owner, providerName, await crypt(env, verifier, owner + ':oauth'), Date.now() + 10 * 60000);
  const url = new URL(config.authorize);
  Object.entries({ client_id: env[config.id], response_type: 'code', redirect_uri: appOrigin(env) + '/api/mail/callback/' + providerName, scope: config.scope, state, code_challenge: await hash(verifier), code_challenge_method: 'S256' }).forEach(([name, value]) => url.searchParams.set(name, value));
  if (providerName === 'gmail') { url.searchParams.set('access_type', 'offline'); url.searchParams.set('prompt', 'consent'); }
  else { url.searchParams.set('response_mode', 'query'); url.searchParams.set('prompt', 'select_account'); }
  return { url: url.href };
}
async function callback(request, env, name) {
  const origin = appOrigin(env); if (!origin || new URL(request.url).origin !== origin) throw problem(400, 'Invalid mailbox callback.');
  const url = new URL(request.url), state = url.searchParams.get('state') || '', code = url.searchParams.get('code') || '';
  const owner = (await session(request, env)).id;
  const pending = await first(env, 'DELETE FROM mail_oauth WHERE state=? AND owner=? AND provider=? AND expires_at>? RETURNING *', await hash(state), owner, name, Date.now());
  if (!pending || !code || code.length > 8000 || !providerReady(env, name)) throw problem(400, 'This mailbox connection expired. Start again from ClientFlock.');
  const config = providers[name];
  const result = await fetchJson(config.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: env[config.id], client_secret: env[config.secret], redirect_uri: origin + '/api/mail/callback/' + name, code_verifier: await crypt(env, pending.verifier, owner + ':oauth', true) }) });
  if (!result.access_token || !result.refresh_token) throw problem(400, 'Offline mailbox access was not granted. Please reconnect and approve draft access.');
  // Changing the connected account must not deliver old queued content to a different mailbox.
  await run(env, "UPDATE mail_drafts SET status='cancelled',updated_at=? WHERE owner=? AND status IN ('queued','reconnect_required')", Date.now(), owner);
  await run(env, 'DELETE FROM mail_mcp WHERE owner=?', owner);
  const tokens = await crypt(env, JSON.stringify({ access_token: result.access_token, refresh_token: result.refresh_token, expires_at: Date.now() + Math.max(60, Number(result.expires_in) || 3600) * 1000 }), owner);
  await run(env, 'INSERT INTO mail_connections(owner,provider,tokens,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET provider=excluded.provider,tokens=excluded.tokens,updated_at=excluded.updated_at', owner, name, tokens, Date.now());
  return new Response(null, { status: 303, headers: { location: origin + '/?mail=connected', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}
const draftSchema = { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, company: { type: 'string' }, delivery: { type: 'string', enum: ['now', 'daily'] }, idempotencyKey: { type: 'string', description: 'Stable unique request ID, 16 to 128 letters, numbers, hyphens or underscores. Reuse on retries.' } }, required: ['to', 'subject', 'body', 'delivery', 'idempotencyKey'], additionalProperties: false };
const mcpTools = [
  { name: 'list_drafts', description: 'List this connected mailbox’s ClientFlock draft queue. No inbox access. Never sends email.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'create_draft', description: 'Prepare an editable draft in the user’s connected mailbox now, or queue it for a daily batch. Never sends email. Ask the user before creating a draft and use their approved recipient and text.', inputSchema: draftSchema, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
  { name: 'edit_queued_draft', description: 'Edit a ClientFlock draft that has not yet been created in the mailbox. Never sends email.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, company: { type: 'string' } }, required: ['id', 'to', 'subject', 'body'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } }
];
async function mcp(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST required.' }, 405);
  const origin = request.headers.get('origin'); if (origin && origin !== appOrigin(env)) return json({ error: 'Origin not allowed.' }, 403);
  const bearer = request.headers.get('authorization')?.match(/^Bearer (cfm_[A-Za-z0-9_-]{43})$/)?.[1];
  if (!bearer) return json({ error: 'A ClientFlock mailbox MCP token is required.' }, 401);
  const token = await first(env, 'SELECT owner FROM mail_mcp WHERE token_hash=? AND expires_at>?', await hash(bearer), Date.now());
  if (!token || !await first(env, 'SELECT owner FROM mail_connections WHERE owner=?', token.owner)) return json({ error: 'Reconnect your mailbox and create a new MCP token.' }, 401);
  const body = await input(request), id = body.id ?? null;
  const response = result => json({ jsonrpc: '2.0', id, result });
  if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') return json({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid request' } }, 400);
  if (body.method === 'notifications/initialized' && body.id === undefined) return new Response(null, { status: 202 });
  if (body.method === 'initialize') return response({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'ClientFlock drafts', version: '1.0.0' }, instructions: 'Drafts only. The user reviews and presses Send in their email application.' });
  if (body.method === 'server/discover') return response({ supportedVersions: ['2026-07-28', '2025-03-26'], capabilities: { tools: {} }, serverInfo: { name: 'ClientFlock drafts', version: '1.0.0' } });
  if (body.method === 'ping') return response({});
  if (body.method === 'tools/list') return response({ tools: mcpTools });
  if (body.method !== 'tools/call') return json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  try {
    const args = body.params?.arguments || {}; let result;
    if (body.params?.name === 'list_drafts') result = (await rows(env, 'SELECT * FROM mail_drafts WHERE owner=? ORDER BY created_at DESC LIMIT 50', token.owner)).map(publicDraft);
    else if (body.params?.name === 'create_draft') result = publicDraft(await createDraft(env, token.owner, args));
    else if (body.params?.name === 'edit_queued_draft') result = publicDraft(await editDraft(env, token.owner, String(args.id || ''), args));
    else throw problem(400, 'Unknown tool. Sending email is not supported.');
    return response({ content: [{ type: 'text', text: JSON.stringify(result) }] });
  } catch (error) { return response({ isError: true, content: [{ type: 'text', text: error.status ? error.message : 'Draft preparation failed. Check your mailbox before trying again.' }] }); }
}
export async function mailboxApi(request, env) {
  const url = new URL(request.url), path = url.pathname;
  if (!path.startsWith('/api/mail/') && path !== '/mcp') return null;
  try {
    if (path === '/api/mail/status' && request.method === 'GET' && !ready(env)) return json({ configured: false, providers: { gmail: false, outlook: false }, connected: false, provider: null, queue: [], mcpReady: false });
    if (!ready(env)) throw problem(503, 'Mailbox connections are being prepared. Copy your draft into your email app for now.');
    await setup(env);
    if (path === '/mcp') return await mcp(request, env);
    if (path.startsWith('/api/mail/callback/') && request.method === 'GET') {
      try { return await callback(request, env, path.split('/').at(-1)); }
      catch { return new Response(null, { status: 303, headers: { location: appOrigin(env) + '/?mail=error', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } }); }
    }
    if (path === '/api/mail/status' && request.method === 'GET') {
      const current = await session(request, env, true), connection = await first(env, 'SELECT provider FROM mail_connections WHERE owner=?', current.id);
      const queue = (await rows(env, 'SELECT * FROM mail_drafts WHERE owner=? ORDER BY created_at DESC LIMIT 50', current.id)).map(publicDraft);
      return json({ configured: providerReady(env, 'gmail') || providerReady(env, 'outlook'), providers: { gmail: providerReady(env, 'gmail'), outlook: providerReady(env, 'outlook') }, connected: !!connection, provider: connection?.provider || null, queue, mcpReady: !!connection }, 200, current.cookie);
    }
    sameOrigin(request, env);
    const current = await session(request, env, path === '/api/mail/connect');
    if (path === '/api/mail/connect' && request.method === 'GET') return json(await connect(request, env, current.id, url.searchParams.get('provider')), 200, current.cookie);
    if (path === '/api/mail/drafts' && request.method === 'POST') return json({ draft: publicDraft(await createDraft(env, current.id, await input(request))) }, 201);
    const draftPath = path.match(/^\/api\/mail\/drafts\/([a-f0-9-]{36})$/);
    if (draftPath && request.method === 'PATCH') return json({ draft: publicDraft(await editDraft(env, current.id, draftPath[1], await input(request))) });
    if (draftPath && request.method === 'DELETE') {
      const row = await first(env, "UPDATE mail_drafts SET status='cancelled',updated_at=? WHERE id=? AND owner=? AND status='queued' RETURNING *", Date.now(), draftPath[1], current.id);
      if (!row) throw problem(404, 'Queued draft not found.'); return json({ draft: publicDraft(row) });
    }
    if (path === '/api/mail/mcp-token' && request.method === 'POST') {
      if (!await first(env, 'SELECT owner FROM mail_connections WHERE owner=?', current.id)) throw problem(409, 'Connect your mailbox first.');
      const token = 'cfm_' + random(), expiresAt = Date.now() + 30 * DAY;
      await run(env, 'DELETE FROM mail_mcp WHERE owner=? OR expires_at<?', current.id, Date.now());
      await run(env, 'INSERT INTO mail_mcp(token_hash,owner,expires_at) VALUES(?,?,?)', await hash(token), current.id, expiresAt);
      return json({ token, url: appOrigin(env) + '/mcp', expiresAt: new Date(expiresAt).toISOString() });
    }
    if (path === '/api/mail/disconnect' && request.method === 'POST') {
      await run(env, 'DELETE FROM mail_connections WHERE owner=?', current.id);
      await run(env, 'DELETE FROM mail_mcp WHERE owner=?', current.id);
      await run(env, 'DELETE FROM mail_oauth WHERE owner=?', current.id);
      await run(env, "UPDATE mail_drafts SET status='cancelled',updated_at=? WHERE owner=? AND status IN ('queued','reconnect_required')", Date.now(), current.id);
      return json({ connected: false });
    }
    throw problem(404, 'Mailbox route not found.');
  } catch (error) { return json({ error: error.status ? error.message : 'Mailbox preparation is temporarily unavailable.' }, error.status || 503); }
}
export async function deliverDailyDrafts(env) {
  if (!ready(env)) return { created: 0, pending: 0, configured: false };
  await setup(env);
  // Expired sessions must not continue preparing unattended drafts.
  const queued = await rows(env, "SELECT d.id,d.owner FROM mail_drafts d JOIN mail_connections c ON c.owner=d.owner JOIN mail_sessions s ON s.id=d.owner WHERE d.status='queued' AND d.scheduled_at<=? AND s.expires_at>? ORDER BY d.scheduled_at,d.created_at LIMIT 50", Date.now(), Date.now());
  let created = 0, pending = 0;
  for (const item of queued) {
    try { const result = await dispatch(env, item.owner, item.id); if (result?.status === 'created') created++; else pending++; } catch { pending++; }
  }
  return { created, pending, configured: true };
}
