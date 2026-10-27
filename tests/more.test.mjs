import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {api} from '../server/research.mjs';

function environment(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../drizzle/0000_overrated_lady_deathstrike.sql',import.meta.url),'utf8'));
 return {OPENAI_API_KEY:'test',DB:{prepare(query){return {bind(...values){return {first:async()=>db.prepare(query).get(...values),run:async()=>db.prepare(query).run(...values)}}}}}};
}
const searchRequest=(id,action='',cookie='',body={})=>new Request('https://clientflock.test/api/search/'+id+(action?'/'+action:''),{...(action?{method:'POST',body:JSON.stringify(body)}:{}),headers:{origin:'https://clientflock.test','content-type':'application/json',...(cookie?{cookie}:{})}});
const post=(id,cookie='')=>searchRequest(id,'more',cookie);
async function browser(env,rootId){
 const response=await api(new Request('https://clientflock.test/api/billing/config?jobId='+rootId),env);
 assert.equal(response.status,200);
 const cookie=response.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie,'Billing issues a browser capability cookie.');
 return cookie;
}
async function paidBrowser(env,rootId){
 const cookie=await browser(env,rootId),token=cookie.split('=')[1],hash=createHash('sha256').update(token).digest('hex'),now=Date.now();
 await env.DB.prepare("INSERT INTO cf_purchases(visitor_hash,root_id,purchase_id,price_id,amount,currency,livemode,state,created_at,expires_at,paid_at) VALUES(?,?,?,?,?,?,?,'paid',?,?,?)").bind(hash,rootId,crypto.randomUUID(),'price_testfixture',2900,'eur',0,now,now+3600000,now).run();
 return cookie;
}
const leads=(prefix='a')=>[1,2,3].map(n=>({name:prefix+n,website:'https://'+prefix+n+'.example',websiteCheck:{status:'checked'}}));
async function seed(env){
 const id=crypto.randomUUID(),now=Date.now(),data={understanding:{profile:{name:'Example',requirements:[{type:'platform',name:'Shopify',required:true}]}},mission:{document:'Mission'},market:{document:'Market'},idealClients:{document:'Customers',priorityList:'Shopify workshops'},qualification:{version:1,status:'verified',requiredPlatforms:['Shopify']},leads:leads(),contacts:{0:{status:'found',discoveryPayload:{secret:'never copy'}}}};
 await env.DB.prepare("INSERT INTO searches(id,cache_key,input,data,status,stage,created_at,updated_at,expires_at) VALUES(?,?,?,?,'complete',8,?,?,?)").bind(id,id,JSON.stringify({mode:'website',value:'https://seller.example'}),JSON.stringify(data),now,now,now+86400000).run();return {id,data};
}
async function complete(env,job,prefix){
 const row=await env.DB.prepare('SELECT * FROM searches WHERE id=?').bind(job.id).first(),data=JSON.parse(row.data);data.qualification.status='verified';data.leads=leads(prefix);
 await env.DB.prepare("UPDATE searches SET data=?,stage=8,status='complete' WHERE id=?").bind(JSON.stringify(data),job.id).run();
}
const startedBudget=async env=>(await env.DB.prepare('SELECT count FROM budgets WHERE key=?').bind('jobs:'+new Date().toISOString().slice(0,10)).first())?.count||0;

test('next batch reuses documents, starts at company research, excludes prior domains and leaves contacts private',async()=>{
 const env=environment(),parent=await seed(env),cookie=await paidBrowser(env,parent.id),response=await api(post(parent.id,cookie),env),next=await response.json();
 assert.equal(response.status,202);assert.equal(next.stage,4);assert.equal(next.status,'working');assert.deepEqual(next.data.mission,parent.data.mission);assert.deepEqual(next.data.qualification.requiredPlatforms,['Shopify']);assert.equal(next.data.qualification.status,'pending');assert.equal(next.data.contacts,undefined);assert.equal(next.data.leads,undefined);assert.deepEqual(next.data.rejectedDomains,leads().map(x=>x.website));assert.deepEqual(next.data.pagination,{page:2,previousId:parent.id,rootId:parent.id,maxPages:3});
 const original=await env.DB.prepare('SELECT * FROM searches WHERE id=?').bind(parent.id).first();assert.deepEqual(JSON.parse(original.data),parent.data);assert.equal(original.lease,null);
});
test('repeated and concurrent more clicks share a cached batch and charge one start budget',async()=>{
 const env=environment(),parent=await seed(env),cookie=await paidBrowser(env,parent.id);
 const responses=await Promise.all([api(post(parent.id,cookie),env),api(post(parent.id,cookie),env)]);assert.ok(responses.every(r=>[200,202,409].includes(r.status)));assert.equal(await startedBudget(env),1);
 const jobs=await Promise.all(responses.filter(r=>r.status!==409).map(r=>r.json())),repeated=await(await api(post(parent.id,cookie),env)).json();assert.ok(jobs.every(j=>j.id===repeated.id));assert.equal(repeated.joined,true);assert.equal(await startedBudget(env),1);
 await complete(env,repeated,'b');const cached=await(await api(post(parent.id,cookie),env)).json();assert.equal(cached.cached,true);assert.equal(cached.id,repeated.id);assert.equal(await startedBudget(env),1);
});
test('third batch excludes both previous sets and cannot create a fourth',async()=>{
 const env=environment(),parent=await seed(env),cookie=await paidBrowser(env,parent.id),second=await(await api(post(parent.id,cookie),env)).json();await complete(env,second,'b');
 const third=await(await api(post(second.id,cookie),env)).json();assert.equal(third.data.pagination.page,3);assert.equal(third.data.pagination.previousId,second.id);assert.deepEqual(third.data.rejectedDomains,[...leads(),...leads('b')].map(l=>l.website));await complete(env,third,'c');
 assert.equal((await api(post(third.id,cookie),env)).status,409);assert.equal(await startedBudget(env),2);
});
test('incomplete, unqualified and missing-playbook searches cannot produce more batches',async()=>{
 for(const variant of ['incomplete','unqualified','documents']){
  const env=environment(),parent=await seed(env),cookie=await paidBrowser(env,parent.id);
  if(variant==='incomplete')await env.DB.prepare("UPDATE searches SET status='working' WHERE id=?").bind(parent.id).run();
  else {if(variant==='unqualified')delete parent.data.qualification;else delete parent.data.mission;await env.DB.prepare('UPDATE searches SET data=? WHERE id=?').bind(JSON.stringify(parent.data),parent.id).run();}
  assert.equal((await api(post(parent.id,cookie),env)).status,409);assert.equal(await startedBudget(env),0);
 }
});
test('existing parent lease and exhausted budget preserve results and release only owned lease',async()=>{
 const env=environment(),parent=await seed(env),cookie=await paidBrowser(env,parent.id);env.DAILY_SEARCH_LIMIT=1;
 await env.DB.prepare('INSERT INTO budgets(key,count) VALUES(?,1)').bind('jobs:'+new Date().toISOString().slice(0,10)).run();
 await env.DB.prepare("UPDATE searches SET lease='contact-operation',lease_until=? WHERE id=?").bind(Date.now()+30000,parent.id).run();assert.equal((await api(post(parent.id,cookie),env)).status,409);
 assert.equal((await env.DB.prepare('SELECT lease FROM searches WHERE id=?').bind(parent.id).first()).lease,'contact-operation');
 await env.DB.prepare('UPDATE searches SET lease=NULL,lease_until=0 WHERE id=?').bind(parent.id).run();assert.equal((await api(post(parent.id,cookie),env)).status,400);
 const original=await env.DB.prepare('SELECT * FROM searches WHERE id=?').bind(parent.id).first();assert.equal(original.lease,null);assert.deepEqual(JSON.parse(original.data),parent.data);
});


test('unpaid next-batch requests are denied before a start budget or lease is consumed',async t=>{
 const env=environment(),parent=await seed(env),unpaid=await browser(env,parent.id);
 t.mock.method(globalThis,'fetch',async()=>{throw Error('Unpaid requests must never call a provider.');});
 for(const cookie of ['',unpaid]){
  const response=await api(post(parent.id,cookie),env),body=await response.json();
  assert.equal(response.status,402);assert.equal(body.paymentRequired,true);assert.equal(body.rootId,parent.id);assert.equal(body.data,undefined);
 }
 assert.equal(await startedBudget(env),0);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) AS count FROM budgets').bind().first()).count,0);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) AS count FROM searches').bind().first()).count,1);
 const original=await env.DB.prepare('SELECT data,lease,lease_until FROM searches WHERE id=?').bind(parent.id).first();
 assert.deepEqual(JSON.parse(original.data),parent.data);assert.equal(original.lease,null);assert.equal(original.lease_until,0);
});

test('knowing a paid next-job ID does not grant another browser read, advance or contact access',async t=>{
 const env=environment(),parent=await seed(env),owner=await paidBrowser(env,parent.id);
 const next=await(await api(post(parent.id,owner),env)).json(),other=await browser(env,parent.id);
 const snapshot=await env.DB.prepare('SELECT * FROM searches WHERE id=?').bind(next.id).first();
 t.mock.method(globalThis,'fetch',async()=>{throw Error('Denied access must never call a provider.');});
 for(const cookie of ['',other])for(const action of ['','advance','contacts']){
  const response=await api(searchRequest(next.id,action,cookie,{index:0}),env),body=await response.json();
  assert.equal(response.status,402,action||'read');assert.equal(body.paymentRequired,true);assert.equal(body.data,undefined);
 }
 const allowed=await api(searchRequest(next.id,'',owner),env);assert.equal(allowed.status,200);assert.equal((await allowed.json()).id,next.id);
 assert.equal(await startedBudget(env),1);
 assert.deepEqual(await env.DB.prepare('SELECT * FROM searches WHERE id=?').bind(next.id).first(),snapshot);
});

test('the first free shortlist remains readable without a purchase or billing cookie',async t=>{
 const env=environment(),parent=await seed(env);
 t.mock.method(globalThis,'fetch',async()=>{throw Error('A cached free shortlist must not call a provider.');});
 const response=await api(searchRequest(parent.id),env),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.id,parent.id);assert.equal(body.status,'complete');
 assert.deepEqual(body.data.leads,parent.data.leads);assert.deepEqual(body.data.mission,parent.data.mission);assert.equal(body.paymentRequired,undefined);
 assert.equal(await startedBudget(env),0);
 assert.equal((await env.DB.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='cf_purchases'").bind().first()).count,0);
});
