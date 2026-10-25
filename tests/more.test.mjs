import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {api} from '../server/research.mjs';

function environment(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../drizzle/0000_overrated_lady_deathstrike.sql',import.meta.url),'utf8'));
 return {OPENAI_API_KEY:'test',DB:{prepare(query){return {bind(...values){return {first:async()=>db.prepare(query).get(...values),run:async()=>db.prepare(query).run(...values)}}}}}};
}
const post=(id)=>new Request('https://clientflock.test/api/search/'+id+'/more',{method:'POST',headers:{origin:'https://clientflock.test','content-type':'application/json'},body:'{}'});
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
 const env=environment(),parent=await seed(env),response=await api(post(parent.id),env),next=await response.json();
 assert.equal(response.status,202);assert.equal(next.stage,4);assert.equal(next.status,'working');assert.deepEqual(next.data.mission,parent.data.mission);assert.deepEqual(next.data.qualification.requiredPlatforms,['Shopify']);assert.equal(next.data.qualification.status,'pending');assert.equal(next.data.contacts,undefined);assert.equal(next.data.leads,undefined);assert.deepEqual(next.data.rejectedDomains,leads().map(x=>x.website));assert.deepEqual(next.data.pagination,{page:2,previousId:parent.id,rootId:parent.id,maxPages:3});
 const original=await env.DB.prepare('SELECT * FROM searches WHERE id=?').bind(parent.id).first();assert.deepEqual(JSON.parse(original.data),parent.data);assert.equal(original.lease,null);
});
test('repeated and concurrent more clicks share a cached batch and charge one start budget',async()=>{
 const env=environment(),parent=await seed(env);
 const responses=await Promise.all([api(post(parent.id),env),api(post(parent.id),env)]);assert.ok(responses.every(r=>[200,202,409].includes(r.status)));assert.equal(await startedBudget(env),1);
 const jobs=await Promise.all(responses.filter(r=>r.status!==409).map(r=>r.json())),repeated=await(await api(post(parent.id),env)).json();assert.ok(jobs.every(j=>j.id===repeated.id));assert.equal(repeated.joined,true);assert.equal(await startedBudget(env),1);
 await complete(env,repeated,'b');const cached=await(await api(post(parent.id),env)).json();assert.equal(cached.cached,true);assert.equal(cached.id,repeated.id);assert.equal(await startedBudget(env),1);
});
test('third batch excludes both previous sets and cannot create a fourth',async()=>{
 const env=environment(),parent=await seed(env),second=await(await api(post(parent.id),env)).json();await complete(env,second,'b');
 const third=await(await api(post(second.id),env)).json();assert.equal(third.data.pagination.page,3);assert.equal(third.data.pagination.previousId,second.id);assert.deepEqual(third.data.rejectedDomains,[...leads(),...leads('b')].map(l=>l.website));await complete(env,third,'c');
 assert.equal((await api(post(third.id),env)).status,409);assert.equal(await startedBudget(env),2);
});
test('incomplete, unqualified and missing-playbook searches cannot produce more batches',async()=>{
 for(const variant of ['incomplete','unqualified','documents']){
  const env=environment(),parent=await seed(env);
  if(variant==='incomplete')await env.DB.prepare("UPDATE searches SET status='working' WHERE id=?").bind(parent.id).run();
  else {if(variant==='unqualified')delete parent.data.qualification;else delete parent.data.mission;await env.DB.prepare('UPDATE searches SET data=? WHERE id=?').bind(JSON.stringify(parent.data),parent.id).run();}
  assert.equal((await api(post(parent.id),env)).status,409);assert.equal(await startedBudget(env),0);
 }
});
test('existing parent lease and exhausted budget preserve results and release only owned lease',async()=>{
 const env=environment(),parent=await seed(env);env.DAILY_SEARCH_LIMIT=1;
 await env.DB.prepare('INSERT INTO budgets(key,count) VALUES(?,1)').bind('jobs:'+new Date().toISOString().slice(0,10)).run();
 await env.DB.prepare("UPDATE searches SET lease='contact-operation',lease_until=? WHERE id=?").bind(Date.now()+30000,parent.id).run();assert.equal((await api(post(parent.id),env)).status,409);
 assert.equal((await env.DB.prepare('SELECT lease FROM searches WHERE id=?').bind(parent.id).first()).lease,'contact-operation');
 await env.DB.prepare('UPDATE searches SET lease=NULL,lease_until=0 WHERE id=?').bind(parent.id).run();assert.equal((await api(post(parent.id),env)).status,400);
 const original=await env.DB.prepare('SELECT * FROM searches WHERE id=?').bind(parent.id).first();assert.equal(original.lease,null);assert.deepEqual(JSON.parse(original.data),parent.data);
});
