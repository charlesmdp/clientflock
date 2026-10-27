import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {billingApi,requirePaidAccess} from '../server/billing.mjs';

function environment() {
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE searches(id TEXT PRIMARY KEY,data TEXT,status TEXT,expires_at INTEGER)');
 return {DB:{prepare(query){return {bind(...values){return {first:async()=>db.prepare(query).get(...values),run:async()=>db.prepare(query).run(...values)}}}}},STRIPE_SECRET_KEY:'sk_test_example',STRIPE_PUBLISHABLE_KEY:'pk_test_example',STRIPE_PRICE_ID:'price_example',STRIPE_WEBHOOK_SECRET:'whsec_example'};
}
const rootId='12345678-1234-4123-8123-123456789012';
async function seed(env){await env.DB.prepare('INSERT INTO searches VALUES(?,?,?,?)').bind(rootId,JSON.stringify({leads:[{},{},{}],mission:{document:'Mission'},market:{document:'Market'},idealClients:{document:'Ideal'}}),'complete',Date.now()+7*86400000).run();}
const req=(path,body,cookie='',extra={})=>new Request('https://clientflock.test/api/billing/'+path,{...(body!==undefined?{method:'POST',body:JSON.stringify(body)}:{}),headers:{origin:'https://clientflock.test','content-type':'application/json',...(cookie?{cookie}:{}),...extra}});
function provider() {
 const sessions=new Map(),idempotency=new Map(),calls=[];let creates=0;
 const fetch=async(url,options={})=>{
  calls.push({url,options});const path=new URL(url).pathname;
  if(path.startsWith('/v1/prices/'))return Response.json({id:'price_example',active:true,type:'one_time',billing_scheme:'per_unit',unit_amount:2900,currency:'eur',livemode:false});
  if(path==='/v1/checkout/sessions'&&options.method==='POST') {
   const key=options.headers['Idempotency-Key'];if(idempotency.has(key))return Response.json(idempotency.get(key));
   const p=new URLSearchParams(options.body),session={id:'cs_test_session'+(++creates),client_secret:'cs_test_client_secret'+creates,status:'open',payment_status:'unpaid',mode:'payment',livemode:false,client_reference_id:p.get('client_reference_id'),metadata:{purchase_id:p.get('metadata[purchase_id]'),visitor_hash:p.get('metadata[visitor_hash]'),root_id:p.get('metadata[root_id]')},amount_total:2900,currency:'eur',payment_intent:'pi_example',line_items:{data:[{price:{id:'price_example'},quantity:1,amount_subtotal:2900}],has_more:false}};
   sessions.set(session.id,session);idempotency.set(key,session);return Response.json(session);
  }
  if(path.startsWith('/v1/checkout/sessions/')){const s=sessions.get(path.split('/').at(-1));return s?Response.json(s):new Response('',{status:404});}
  if(path.startsWith('/v1/payment_intents/'))return Response.json({id:'pi_example',metadata:{purchase_id:[...sessions.values()][0]?.metadata.purchase_id}});
  throw Error('Unexpected provider URL');
 };
 return {fetch,sessions,calls,get creates(){return creates;}};
}
async function browser(env){const response=await billingApi(req('config?jobId='+rootId),env);return {cookie:response.headers.get('set-cookie')?.split(';')[0],data:await response.json()};}
async function buy(env,cookie){const r=await billingApi(req('checkout',{jobId:rootId},cookie),env);assert.equal(r.status,200,JSON.stringify(await r.clone().json()));return r.json();}
async function sign(event,secret='whsec_example',timestamp=Math.floor(Date.now()/1000)) {
 const raw=JSON.stringify(event),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+raw))),signature=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
 return new Request('https://clientflock.test/api/billing/webhook',{method:'POST',headers:{'stripe-signature':'t='+timestamp+',v1='+signature,'content-type':'application/json'},body:raw});
}

test('unconfigured billing stays closed and never fabricates a price',async()=>{
 const env=environment();await seed(env);delete env.STRIPE_SECRET_KEY;
 const r=await billingApi(req('config?jobId='+rootId),env),data=await r.json();assert.equal(data.ready,false);assert.equal(data.price,undefined);assert.match(r.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
 assert.equal((await billingApi(req('checkout',{jobId:rootId}),env)).status,503);assert.equal((await requirePaidAccess(req('config'),env,rootId)).status,402);
});
test('configured price comes from Stripe and session is browser bound and idempotent',async t=>{
 const env=environment();await seed(env);const p=provider();t.mock.method(globalThis,'fetch',p.fetch);
 const b=await browser(env);assert.equal(b.data.price.amount,2900);assert.equal(b.data.price.formatted,'€29.00');assert.equal(b.data.publishableKey,'pk_test_example');assert.ok(!JSON.stringify(b.data).includes('sk_test'));
 const [a,c]=await Promise.all([buy(env,b.cookie),buy(env,b.cookie)]);assert.equal(a.sessionId,c.sessionId);assert.equal(p.creates,1);
 const data=new URLSearchParams(p.calls.find(c=>c.options.method==='POST').options.body);assert.equal(data.get('ui_mode'),'embedded');assert.equal(data.get('redirect_on_completion'),'never');assert.equal(data.get('line_items[0][quantity]'),'1');assert.equal(data.get('client_reference_id'),data.get('metadata[purchase_id]'));
 const other=await browser(env);const response=await billingApi(req('status',{jobId:rootId,sessionId:a.sessionId},other.cookie),env);assert.equal((await response.json()).unlocked,false);
});
test('paid sessions unlock only their visitor and research root',async t=>{
 const env=environment();await seed(env);const p=provider();t.mock.method(globalThis,'fetch',p.fetch);const b=await browser(env),purchase=await buy(env,b.cookie),s=p.sessions.get(purchase.sessionId);
 assert.equal((await requirePaidAccess(req('status',undefined,b.cookie),env,rootId)).status,402);
 s.status='complete';s.payment_status='paid';const response=await billingApi(req('status?jobId='+rootId+'&sessionId='+s.id,undefined,b.cookie),env);assert.equal((await response.json()).unlocked,true);
 assert.equal(await requirePaidAccess(req('status',undefined,b.cookie),env,rootId),null);
 const other=await browser(env);assert.equal((await requirePaidAccess(req('status',undefined,other.cookie),env,rootId)).status,402);
 assert.equal((await requirePaidAccess(req('status',undefined,b.cookie),env,'other-root-123456')).status,402);
 assert.equal((await buy(env,b.cookie)).unlocked,true);assert.equal(p.creates,1);
});
test('a complete but unpaid checkout and mismatched price never grant access',async t=>{
 const env=environment();await seed(env);const p=provider();t.mock.method(globalThis,'fetch',p.fetch);const b=await browser(env),purchase=await buy(env,b.cookie),s=p.sessions.get(purchase.sessionId);s.status='complete';
 assert.equal((await(await billingApi(req('status',{jobId:rootId},b.cookie),env)).json()).unlocked,false);
 s.payment_status='paid';s.line_items.data[0].price.id='price_wrong';assert.equal((await billingApi(req('status',{jobId:rootId},b.cookie),env)).status,409);
 assert.equal((await requirePaidAccess(req('status',undefined,b.cookie),env,rootId)).status,402);
});
test('cross-origin checkout and unsupported pricing are rejected',async t=>{
 const env=environment();await seed(env);assert.equal((await billingApi(req('checkout',{jobId:rootId},'',{origin:'https://evil.example'}),env)).status,403);
 t.mock.method(globalThis,'fetch',async()=>Response.json({id:'price_example',active:true,type:'recurring',unit_amount:2900,currency:'eur',livemode:false}));
 const b=await browser(env);assert.equal(b.data.ready,false);assert.equal((await billingApi(req('checkout',{jobId:rootId},b.cookie),env)).status,503);
});
test('signed webhook fulfillment is idempotent and rejects tampered or stale signatures',async t=>{
 const env=environment();await seed(env);const p=provider();t.mock.method(globalThis,'fetch',p.fetch);const b=await browser(env),purchase=await buy(env,b.cookie),s=p.sessions.get(purchase.sessionId);s.status='complete';s.payment_status='paid';
 const event={id:'evt_example',type:'checkout.session.completed',livemode:false,data:{object:s}};
 assert.equal((await billingApi(await sign(event,'whsec_wrong'),env)).status,400);
 assert.equal((await billingApi(await sign(event,'whsec_example',Math.floor(Date.now()/1000)-1000),env)).status,400);
 assert.equal((await billingApi(await sign(event),env)).status,200);const calls=p.calls.length;
 assert.equal((await billingApi(await sign(event),env)).status,200);assert.equal(p.calls.length,calls);
 assert.equal(await requirePaidAccess(req('status',undefined,b.cookie),env,rootId),null);
});
test('a refund revokes entitlement and delayed completion cannot restore it',async t=>{
 const env=environment();await seed(env);const p=provider();t.mock.method(globalThis,'fetch',p.fetch);const b=await browser(env),purchase=await buy(env,b.cookie),s=p.sessions.get(purchase.sessionId);s.status='complete';s.payment_status='paid';
 assert.equal((await billingApi(await sign({id:'evt_refund',livemode:false,type:'charge.refunded',data:{object:{payment_intent:'pi_example',amount_refunded:2900}}}),env)).status,200);
 assert.equal((await billingApi(await sign({id:'evt_complete',livemode:false,type:'checkout.session.completed',data:{object:s}}),env)).status,200);
 assert.equal((await requirePaidAccess(req('status',undefined,b.cookie),env,rootId)).status,402);
 const status=await(await billingApi(req('status',{jobId:rootId},b.cookie),env)).json();assert.equal(status.status,'revoked');assert.equal(status.unlocked,false);
});

test('payment preserves all cached batches for 30 days and access expires without charging again',async t=>{
 const env=environment();await seed(env);const child='child-search-1234567890';await env.DB.prepare('INSERT INTO searches VALUES(?,?,?,?)').bind(child,JSON.stringify({pagination:{rootId,page:2}}),'complete',Date.now()+10000).run();
 const p=provider();t.mock.method(globalThis,'fetch',p.fetch);const b=await browser(env),purchase=await buy(env,b.cookie),s=p.sessions.get(purchase.sessionId);s.status='complete';s.payment_status='paid';await billingApi(req('status',{jobId:rootId},b.cookie),env);
 const row=await env.DB.prepare('SELECT expires_at FROM searches WHERE id=?').bind(child).first();assert.ok(row.expires_at>Date.now()+29*86400000);
 await env.DB.prepare('UPDATE cf_purchases SET paid_at=?').bind(Date.now()-31*86400000).run();assert.equal((await requirePaidAccess(req('status',undefined,b.cookie),env,rootId)).status,402);
 const status=await(await billingApi(req('status',{jobId:rootId},b.cookie),env)).json();assert.equal(status.unlocked,false);assert.equal(status.status,'expired');
 assert.equal((await billingApi(req('checkout',{jobId:rootId},b.cookie),env)).status,410);assert.equal(p.creates,1);
});
test('expired research cannot enter checkout or charge Stripe',async t=>{
 const env=environment();await seed(env);await env.DB.prepare('UPDATE searches SET expires_at=?').bind(Date.now()-1000).run();let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('Should never call Stripe');});
 assert.equal((await billingApi(req('checkout',{jobId:rootId}),env)).status,410);assert.equal(calls,0);
});
