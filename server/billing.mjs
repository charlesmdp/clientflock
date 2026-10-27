// A payment unlocks only one visitor's next two batches for one research root.
// Stripe's keys and the browser capability never enter public search data.
const COOKIE = '__Host-clientflock_billing';
const ACCESS_DURATION = 30 * 86400000;
const hasAccess = record => record?.state === 'paid' && Number(record.paid_at) + ACCESS_DURATION > Date.now();
const API_VERSION = '2025-03-31.basil';
const schemas = new WeakMap();
const encoder = new TextEncoder();
const idPattern = /^[a-zA-Z0-9_-]{12,128}$/;
const json = (body, status = 200, cookie) => Response.json(body, {status, headers: {'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...(cookie ? {'Set-Cookie':cookie} : {})}});
const error = (message, status = 400) => Object.assign(new Error(message), {status});
const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2,'0')).join('');
const hash = async value => hex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))));
function configured(env) {
 return !!(env.DB && /^sk_(test|live)_/.test(env.STRIPE_SECRET_KEY || '') && /^pk_(test|live)_/.test(env.STRIPE_PUBLISHABLE_KEY || '') && /^price_[a-zA-Z0-9]+$/.test(env.STRIPE_PRICE_ID || '') && /^whsec_/.test(env.STRIPE_WEBHOOK_SECRET || '') && env.STRIPE_SECRET_KEY.split('_')[1] === env.STRIPE_PUBLISHABLE_KEY.split('_')[1]);
}
async function schema(db) {
 if (!db) throw error('Payment storage is not configured yet.',503);
 if (!schemas.has(db)) schemas.set(db,(async () => {
  await db.prepare(`CREATE TABLE IF NOT EXISTS cf_purchases (
   visitor_hash TEXT NOT NULL, root_id TEXT NOT NULL, purchase_id TEXT UNIQUE NOT NULL,
   session_id TEXT UNIQUE, payment_intent TEXT, price_id TEXT NOT NULL, amount INTEGER NOT NULL,
   currency TEXT NOT NULL, livemode INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
   created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, paid_at INTEGER,
   PRIMARY KEY(visitor_hash,root_id)
  )`).bind().run();
  await db.prepare('CREATE TABLE IF NOT EXISTS cf_payment_events (id TEXT PRIMARY KEY NOT NULL, processed_at INTEGER NOT NULL)').bind().run();
 })().catch(cause => {schemas.delete(db);throw cause;}));
 await schemas.get(db);
}
async function visitor(request, create = false) {
 let token = request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
 if (!/^[a-f0-9]{64}$/.test(token || '')) token = null;
 let cookie;
 if (!token && create) { token = hex(crypto.getRandomValues(new Uint8Array(32))); cookie = COOKIE+'='+token+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000'; }
 return {hash: token ? await hash(token) : null, cookie};
}
function sameOrigin(request) {
 const url = new URL(request.url);
 if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') throw error('Open checkout from ClientFlock.',403);
}
async function boundedText(request, max = 8192) {
 if (Number(request.headers.get('content-length')) > max) throw error('Request is too large.',413);
 const reader=request.body?.getReader();if(!reader)return '';
 let size=0;const chunks=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw error('Request is too large.',413);}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const value of chunks){bytes.set(value,offset);offset+=value.byteLength;}
 return new TextDecoder().decode(bytes);
}
async function input(request) {
 if (request.method === 'GET') return Object.fromEntries(new URL(request.url).searchParams);
 if (!request.headers.get('content-type')?.startsWith('application/json')) throw error('Use JSON for this request.',415);
 try {const data=JSON.parse(await boundedText(request));if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data;}catch(cause){if(cause.status)throw cause;throw error('Invalid request.');}
}
async function rootFor(db, jobId, requireComplete=false) {
 if (!idPattern.test(String(jobId || ''))) throw error('Choose a completed customer search first.');
 const row=await db.prepare('SELECT id,data,status,expires_at FROM searches WHERE id=?').bind(jobId).first();
 if (!row) throw error('This research could not be found.',404);
 let data;try{data=JSON.parse(row.data);}catch{throw error('This research is unavailable.',409);}
 const rootId=data.pagination?.rootId || row.id;
 if (!idPattern.test(String(rootId))) throw error('This research is unavailable.',409);
 const root=rootId===row.id?row:await db.prepare('SELECT id,data,status,expires_at FROM searches WHERE id=?').bind(rootId).first();
 if (!root) throw error('The original research could not be found.',404);
 if(Number(row.expires_at)<=Date.now()||Number(root.expires_at)<=Date.now())throw error('This research has expired. Start a fresh search before purchasing.',410);
 if(requireComplete && Number(root.expires_at)<Date.now()+3600000)throw error('This research is about to expire. Start a fresh search before purchasing.',409);
 if (requireComplete) {
  const details=JSON.parse(root.data);
  if(root.status!=='complete'||details.leads?.length!==3||!details.mission?.document||!details.market?.document||!details.idealClients?.document) throw error('Finish your first three customers before unlocking more.',409);
 }
 return rootId;
}
async function stripe(env, path, parameters, idempotencyKey) {
 const response=await fetch('https://api.stripe.com/v1/'+path, {method:parameters?'POST':'GET',headers:{Authorization:'Bearer '+env.STRIPE_SECRET_KEY,'Stripe-Version':API_VERSION,...(parameters?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},...(parameters?{body:new URLSearchParams(parameters).toString()}:{}),signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw error('Checkout could not be reached. Please try again shortly.',503);
 return response.json();
}
async function price(env) {
 const p=await stripe(env,'prices/'+encodeURIComponent(env.STRIPE_PRICE_ID));
 if(p.id!==env.STRIPE_PRICE_ID||!p.active||p.type!=='one_time'||p.recurring||p.billing_scheme!=='per_unit'||!Number.isSafeInteger(p.unit_amount)||p.unit_amount<=0||!/^\w{3}$/.test(p.currency)||p.livemode!==(env.STRIPE_SECRET_KEY.startsWith('sk_live_')))throw error('Checkout needs an active, fixed, one-time price in the matching Stripe mode.',503);
 const format=new Intl.NumberFormat('en',{style:'currency',currency:p.currency});
 return {id:p.id,amount:p.unit_amount,currency:p.currency,formatted:format.format(p.unit_amount/10**format.resolvedOptions().maximumFractionDigits),livemode:p.livemode};
}
const purchaseFor=(db,visitorHash,rootId)=>db.prepare('SELECT * FROM cf_purchases WHERE visitor_hash=? AND root_id=?').bind(visitorHash,rootId).first();
function owns(session,record) {
 return session.id===record.session_id && session.mode==='payment' && session.client_reference_id===record.purchase_id && session.metadata?.purchase_id===record.purchase_id && session.metadata?.visitor_hash===record.visitor_hash && session.metadata?.root_id===record.root_id && session.livemode===!!record.livemode;
}
async function verifyAndFulfill(env,record,providedSession) {
 const session=providedSession || await stripe(env,'checkout/sessions/'+encodeURIComponent(record.session_id)+'?expand[]=line_items');
 if(!owns(session,record))throw error('This checkout does not match your purchase.',403);
 if(session.status!=='complete'||session.payment_status!=='paid')return session;
 const items=session.line_items?.data;
 if(!Array.isArray(items)||items.length!==1||session.line_items.has_more||items[0].price?.id!==record.price_id||items[0].quantity!==1||items[0].amount_subtotal!==record.amount||session.amount_total!==record.amount||session.currency!==record.currency||typeof session.payment_intent!=='string') throw error('The paid checkout does not match the configured offer.',409);
 if(record.state!=='revoked')await env.DB.prepare("UPDATE searches SET expires_at=MAX(expires_at,?) WHERE id=? OR json_extract(data,'$.pagination.rootId')=?").bind((Number(record.paid_at)||Date.now())+ACCESS_DURATION,record.root_id,record.root_id).run();
 await env.DB.prepare("UPDATE cf_purchases SET state='paid',paid_at=COALESCE(paid_at,?),payment_intent=? WHERE purchase_id=? AND state='pending'").bind(Date.now(),session.payment_intent,record.purchase_id).run();
 return session;
}
export async function requirePaidAccess(request,env,rootId) {
 try {
  if(!idPattern.test(String(rootId||'')))return json({error:'The original research could not be found.'},404);
  await schema(env.DB);const user=await visitor(request);
  const record=user.hash?await purchaseFor(env.DB,user.hash,rootId):null;
  return hasAccess(record)?null:json({error:'Unlock the next customers to continue.',paymentRequired:true,rootId},402);
 } catch {return json({error:'Purchase verification is temporarily unavailable.'},503);}
}
async function signatureValid(raw,header,secret) {
 if(!header||header.length>4096)return false;
 const parts=header.split(',').map(v=>v.trim().split('='));
 const timestamp=parts.find(([k])=>k==='t')?.[1];
 if(!/^\d{10,}$/.test(timestamp||'')||Math.abs(Date.now()/1000-Number(timestamp))>300)return false;
 const signatures=parts.filter(([k,v])=>k==='v1'&&/^[a-f0-9]{64}$/.test(v)).slice(0,8);
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 for(const [,value] of signatures){const bytes=Uint8Array.from(value.match(/../g),v=>parseInt(v,16));if(await crypto.subtle.verify('HMAC',key,bytes,encoder.encode(timestamp+'.'+raw)))return true;}
 return false;
}
async function webhook(request,env) {
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(!configured(env))return json({error:'Webhook is not configured.'},503);
 const raw=await boundedText(request,262144);
 if(!await signatureValid(raw,request.headers.get('stripe-signature'),env.STRIPE_WEBHOOK_SECRET))return json({error:'Invalid webhook signature.'},400);
 let event;try{event=JSON.parse(raw);}catch{return json({error:'Invalid webhook.'},400);}
 if(!/^evt_[a-zA-Z0-9]+$/.test(event.id||''))return json({error:'Invalid webhook.'},400);
 await schema(env.DB);
 if(await env.DB.prepare('SELECT id FROM cf_payment_events WHERE id=?').bind(event.id).first())return json({received:true});
 const object=event.data?.object;
 if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)) {
  const record=await env.DB.prepare('SELECT * FROM cf_purchases WHERE session_id=?').bind(String(object?.id||'')).first();
  // An event can arrive before the creating request stores its Stripe session ID.
  if(!record && object?.metadata?.purchase_id)throw error('Checkout is still being saved. Please retry.',503);
  if(record)await verifyAndFulfill(env,record);
 } else if(['charge.refunded','charge.dispute.created'].includes(event.type)) {
  if(event.type==='charge.dispute.created'||Number(object?.amount_refunded)>0) {
   const intent=typeof object?.payment_intent==='string'?object.payment_intent:null;
   if(intent) {
    // Also copy purchase_id to PaymentIntent metadata, so an early refund cannot race fulfillment.
    const payment=await stripe(env,'payment_intents/'+encodeURIComponent(intent));
    const purchaseId=payment.metadata?.purchase_id;
    if(purchaseId)await env.DB.prepare("UPDATE cf_purchases SET state='revoked',payment_intent=? WHERE purchase_id=? AND livemode=?").bind(intent,purchaseId,event.livemode?1:0).run();
   }
  }
 }
 await env.DB.prepare('INSERT OR IGNORE INTO cf_payment_events(id,processed_at) VALUES(?,?)').bind(event.id,Date.now()).run();
 return json({received:true});
}
async function config(request,env) {
 const user=await visitor(request,true);
 if(!env.DB)return json({ready:false,unlocked:false,message:'Checkout is being connected. Your first three customers and email unlocks stay free.'},200,user.cookie);
 await schema(env.DB);
 const jobId=new URL(request.url).searchParams.get('jobId'),rootId=jobId?await rootFor(env.DB,jobId):null;
 const record=rootId?await purchaseFor(env.DB,user.hash,rootId):null;
 const base={ready:configured(env),unlocked:hasAccess(record),rootId,maxAdditionalCustomers:6,batches:2,accessDays:30,accessExpiresAt:record?.paid_at?Number(record.paid_at)+ACCESS_DURATION:null};
 if(!base.ready)return json({...base,message:'Checkout is being connected. Your first three customers and email unlocks stay free.'},200,user.cookie);
 try{return json({...base,publishableKey:env.STRIPE_PUBLISHABLE_KEY,price:await price(env)},200,user.cookie);}
 catch(cause){return json({...base,ready:false,message:cause.message},200,user.cookie);}
}
async function checkout(request,env) {
 sameOrigin(request);
 if(!configured(env))throw error('Checkout is being connected. Your first three customers and email unlocks stay free.',503);
 await schema(env.DB);const data=await input(request),user=await visitor(request,true),rootId=await rootFor(env.DB,data.jobId,true);
 let record=await purchaseFor(env.DB,user.hash,rootId);
 if(record?.state==='paid'){if(!hasAccess(record))throw error('This 30-day purchase has expired. Start a fresh search to unlock another shortlist.',410);return json({unlocked:true,rootId},200,user.cookie);}
 if(record?.state==='revoked')throw error('This purchase was refunded or disputed. Contact support before purchasing again.',409);
 if(record?.session_id) {
  const session=await verifyAndFulfill(env,record);
  record=await purchaseFor(env.DB,user.hash,rootId);
  if(record?.state==='paid'){if(!hasAccess(record))throw error('This 30-day purchase has expired. Start a fresh search to unlock another shortlist.',410);return json({unlocked:true,rootId},200,user.cookie);}
  if(session.status==='open'&&typeof session.client_secret==='string')return json({sessionId:session.id,clientSecret:session.client_secret,publishableKey:env.STRIPE_PUBLISHABLE_KEY,rootId},200,user.cookie);
  if(session.status!=='expired')throw error('Your payment is still being confirmed. Please check its status.',409);
  await env.DB.prepare("DELETE FROM cf_purchases WHERE purchase_id=? AND state='pending' AND session_id=?").bind(record.purchase_id,record.session_id).run();record=null;
 }
 if(!record) {
  const p=await price(env),now=Date.now();
  await env.DB.prepare('INSERT OR IGNORE INTO cf_purchases(visitor_hash,root_id,purchase_id,price_id,amount,currency,livemode,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(user.hash,rootId,crypto.randomUUID(),p.id,p.amount,p.currency,p.livemode?1:0,now,Math.floor(now/1000)+3600).run();
  record=await purchaseFor(env.DB,user.hash,rootId);
 }
 // Retrying uncertain creation uses exactly the same request and Stripe idempotency key.
 // Never create another charge after its 24-hour Stripe idempotency retention window.
 if(Date.now()-record.created_at>23*3600000)throw error('This checkout needs a status check before retrying. Please contact support.',409);
 const parameters={mode:'payment',ui_mode:'embedded',redirect_on_completion:'never','payment_method_types[0]':'card','line_items[0][price]':record.price_id,'line_items[0][quantity]':'1',client_reference_id:record.purchase_id,'metadata[purchase_id]':record.purchase_id,'metadata[root_id]':rootId,'metadata[visitor_hash]':user.hash,'payment_intent_data[metadata][purchase_id]':record.purchase_id,expires_at:String(record.expires_at)};
 const session=await stripe(env,'checkout/sessions',parameters,'clientflock:'+record.purchase_id);
 if(!/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(session.id||'')||typeof session.client_secret!=='string')throw error('Checkout did not return a usable session.',503);
 await env.DB.prepare('UPDATE cf_purchases SET session_id=? WHERE purchase_id=? AND session_id IS NULL').bind(session.id,record.purchase_id).run();
 return json({sessionId:session.id,clientSecret:session.client_secret,publishableKey:env.STRIPE_PUBLISHABLE_KEY,rootId},200,user.cookie);
}
async function status(request,env) {
 if(request.method==='POST')sameOrigin(request);
 await schema(env.DB);const data=await input(request),user=await visitor(request),rootId=await rootFor(env.DB,data.jobId);
 const record=user.hash?await purchaseFor(env.DB,user.hash,rootId):null;
 if(!record)return json({paid:false,unlocked:false,status:'pending',rootId});
 if(data.sessionId&&data.sessionId!==record.session_id)throw error('This checkout belongs to a different visit.',403);
 if(record.state==='paid'||record.state==='revoked')return json({paid:record.state==='paid',unlocked:hasAccess(record),status:record.state==='paid'&&!hasAccess(record)?'expired':record.state,rootId,accessExpiresAt:record.paid_at?Number(record.paid_at)+ACCESS_DURATION:null});
 if(!record.session_id)return json({paid:false,unlocked:false,status:'pending',rootId});
 if(!configured(env))throw error('Payment confirmation is temporarily unavailable.',503);
 const session=await verifyAndFulfill(env,record),updated=await purchaseFor(env.DB,user.hash,rootId);
 return json({paid:updated.state==='paid',unlocked:hasAccess(updated),status:updated.state==='paid'?'paid':updated.state==='revoked'?'revoked':session.status,rootId});
}
export async function billingApi(request,env) {
 const path=new URL(request.url).pathname;
 if(!path.startsWith('/api/billing/'))return null;
 try {
  if(path==='/api/billing/webhook')return await webhook(request,env);
  if(request.headers.get('sec-fetch-site')==='cross-site')return json({error:'Open billing from ClientFlock.'},403);
  if(path==='/api/billing/config'&&request.method==='GET')return await config(request,env);
  if(path==='/api/billing/checkout'&&request.method==='POST')return await checkout(request,env);
  if(path==='/api/billing/status'&&['GET','POST'].includes(request.method))return await status(request,env);
  return json({error:'Billing endpoint not found.'},404);
 } catch(cause) {return json({error:cause.status?cause.message:'Payment service is temporarily unavailable.'},cause.status||503);}
}
