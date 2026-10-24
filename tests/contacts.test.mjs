import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleContacts,selectPerson,parseEmailResult} from '../server/contacts.mjs';
function db(){const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_overrated_lady_deathstrike.sql',import.meta.url),'utf8'));return {prepare(q){return {bind(...v){return {first:async()=>sql.prepare(q).get(...v),run:async()=>sql.prepare(q).run(...v)}}}}};}
const request=(index=0)=>new Request('https://clientflock.test/api/search/job/contacts',{method:'POST',headers:{'Content-Type':'application/json','cf-connecting-ip':'127.0.0.1'},body:JSON.stringify({leadIndex:index})});
async function setup(){const env={DB:db(),ICYPEAS_API_KEY:'test-not-real'};const now=Date.now();const id=crypto.randomUUID();const data={leads:[{name:'Acme',website:'https://acme.com',roleToContact:'Founder'},{name:'Other',website:'https://other.com',roleToContact:'Founder'},{name:'Third',website:'https://third.com',roleToContact:'Founder'}]};await env.DB.prepare("INSERT INTO searches(id,cache_key,input,data,status,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?)").bind(id,id,'{}',JSON.stringify(data),'complete',now,now,now+86400000).run();return {env,id,row:()=>env.DB.prepare('SELECT * FROM searches WHERE id=?').bind(id).first()};}
async function clearCooldown(job){const row=await job.row();const data=JSON.parse(row.data);data.contactLookup={...data.contactLookup,nextAt:0};await job.env.DB.prepare('UPDATE searches SET data=? WHERE id=?').bind(JSON.stringify(data),job.id).run();}
const person={firstname:'Alex',lastname:'Miller',currentJobTitle:'Founder',currentCompanyWebsite:'https://acme.com',linkedinUrl:'https://www.linkedin.com/in/alex-miller/'};
test('people require explicit current company, real name and professional profile',()=>{assert.equal(selectPerson({people:[person]},'acme.com').fullName,'Alex Miller');assert.throws(()=>selectPerson({people:[{...person,currentCompanyWebsite:'other.com'}]},'acme.com'));assert.throws(()=>selectPerson({people:[{...person,linkedinUrl:'https://example.com/private'}]},'acme.com'));assert.throws(()=>selectPerson({success:true},'acme.com'));assert.equal(selectPerson({people:[]},'acme.com'),null);});
test('provider certainty controls result status, without inventing or promoting email addresses',()=>{
 const result=(certainty,email='alex@acme.com')=>({items:[{_id:'p1',status:'DEBITED',results:{emails:[{email,certainty}]}}]});
 assert.equal(parseEmailResult(result('ULTRA_SURE'),'p1','acme.com').status,'found');
 assert.equal(parseEmailResult(result('very_sure'),'p1','acme.com').status,'found');
 assert.equal(parseEmailResult(result('probable'),'p1','acme.com').status,'risky');
 assert.throws(()=>parseEmailResult(result('sure'),'p1','acme.com'));
 assert.throws(()=>parseEmailResult(result('ultra_sure','alex@gmail.com'),'p1','acme.com'));
 assert.throws(()=>parseEmailResult(result('ultra_sure'),'wrong-id','acme.com'));
 assert.equal(parseEmailResult({items:[{_id:'p1',status:'DEBITED_NOT_FOUND'}]},'p1','acme.com').status,'not_found');
});
test('missing key is explicit and does not call provider',async()=>{const job=await setup();delete job.env.ICYPEAS_API_KEY;const res=await handleContacts(request(),job.env,await job.row());assert.equal(res.status,503);assert.equal((await res.json()).contact.status,'skipped');});
test('concurrent discover requests spend once; identifier persists before polling; cache is reused',async()=>{
 const original=globalThis.fetch;const job=await setup();let calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body),headers:options.headers});if(url.endsWith('find-people'))return Response.json({people:[person]});if(url.endsWith('email-search'))return Response.json({success:true,item:{_id:'provider-1',status:'NONE'}});return Response.json({items:[{_id:'provider-1',status:'DEBITED',results:{emails:[{email:'alex@acme.com',certainty:'ultra_sure'}]}}]});};
 try{
  await Promise.all([handleContacts(request(),job.env,await job.row()),handleContacts(request(),job.env,await job.row())]);
  assert.equal(calls.length,1);assert.equal(calls[0].headers.Authorization,'test-not-real');
  await handleContacts(request(1),job.env,await job.row());assert.equal(calls.length,1,'cooldown applies across leads');
  await clearCooldown(job);await handleContacts(request(),job.env,await job.row());assert.equal(calls.length,2);assert.equal(calls[1].body.custom.externalId,'clientflock:'+job.id+':0');
  let saved=JSON.parse((await job.row()).data).contacts[0];assert.equal(saved.providerId,'provider-1');assert.equal(saved.phase,'poll');
  await clearCooldown(job);const final=await(await handleContacts(request(),job.env,await job.row())).json();assert.equal(final.contact.email,'alex@acme.com');assert.equal(final.contact.status,'found');
  await handleContacts(request(),job.env,await job.row());assert.equal(calls.length,3,'cache makes no provider call');
 }finally{globalThis.fetch=original;}
});
test('timed out paid request is durably stopped instead of resubmitted',async()=>{
 const original=globalThis.fetch;const job=await setup();let calls=0;
 globalThis.fetch=async()=>{calls++;throw new DOMException('Timed out','TimeoutError');};
 try{const result=await(await handleContacts(request(),job.env,await job.row())).json();assert.equal(result.contact.status,'error');assert.match(result.contact.message,/unknown outcome/);await clearCooldown(job);await handleContacts(request(),job.env,await job.row());assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
test('expired crash marker prevents replay and read budget prevents extra polls',async()=>{
 const original=globalThis.fetch;const job=await setup();let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({});};
 try{
  let data=JSON.parse((await job.row()).data);data.contacts={0:{status:'working',phase:'requesting',startedAt:Date.now()},1:{status:'working',phase:'poll',providerId:'p1',startedAt:Date.now(),person}};
  await job.env.DB.prepare('UPDATE searches SET data=? WHERE id=?').bind(JSON.stringify(data),job.id).run();
  const stopped=await(await handleContacts(request(),job.env,await job.row())).json();assert.equal(stopped.contact.status,'error');assert.match(stopped.contact.message,/unknown outcome/);assert.equal(calls,0);
  await job.env.DB.prepare('INSERT INTO budgets(key,count) VALUES(?,?)').bind('icypeas:reads:'+Math.floor(Date.now()/60000),20).run();
  const waiting=await handleContacts(request(1),job.env,await job.row());assert.equal(waiting.status,202);assert.equal(calls,0);assert.ok((await waiting.json()).retryAfterMs>0);
 }finally{globalThis.fetch=original;}
});
test('per-day and per-search bounds reject extra work without provider calls',async()=>{
 const original=globalThis.fetch;const job=await setup();let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({people:[person]});};
 try{
  const day=new Date().toISOString().slice(0,10);await job.env.DB.prepare('INSERT INTO budgets(key,count) VALUES(?,?)').bind('icypeas:daily:'+day,30).run();
  assert.equal((await handleContacts(request(),job.env,await job.row())).status,429);
  assert.equal((await handleContacts(request(3),job.env,await job.row())).status,400);assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});
test('a response from an expired lease cannot overwrite a newer owner',async()=>{
 const original=globalThis.fetch;const job=await setup();let started,resolveFetch;const began=new Promise(resolve=>started=resolve);
 globalThis.fetch=async()=>{started();return new Promise(resolve=>resolveFetch=resolve);};
 try{
  const pending=handleContacts(request(),job.env,await job.row());await began;
  const before=JSON.parse((await job.row()).data);before.newOwnerMarker=true;
  await job.env.DB.prepare('UPDATE searches SET lease=?,lease_until=?,data=? WHERE id=?').bind('other-owner',Date.now()+90000,JSON.stringify(before),job.id).run();
  resolveFetch(Response.json({people:[person]}));assert.equal((await pending).status,500);
  const saved=await job.row();assert.equal(saved.lease,'other-owner');assert.equal(JSON.parse(saved.data).newOwnerMarker,true);assert.equal(JSON.parse(saved.data).contacts[0].phase,'requesting');
 }finally{globalThis.fetch=original;}
});

test('contact route advertises optional setup, rejects cross-origin writes and honors job expiry',async()=>{
 const {api}=await import('../server/research.mjs');const job=await setup();job.env.OPENAI_API_KEY='test';
 const path='/api/search/'+job.id+'/contacts';
 const post=(origin='https://clientflock.test',contentType='application/json')=>new Request('https://clientflock.test'+path,{method:'POST',headers:{origin,'Content-Type':contentType},body:JSON.stringify({leadIndex:0})});
 const health=await(await api(new Request('https://clientflock.test/api/health'),job.env)).json();assert.equal(health.contacts,true);
 assert.equal((await api(post('https://other.test'),job.env)).status,403);
 assert.equal((await api(post('https://clientflock.test','text/plain'),job.env)).status,403);
 delete job.env.ICYPEAS_API_KEY;
 assert.equal((await(await api(new Request('https://clientflock.test/api/health'),job.env)).json()).contacts,false);
 const unconfigured=await api(post(),job.env);assert.equal(unconfigured.status,503);assert.equal((await unconfigured.json()).contact.status,'skipped');
 assert.equal((await api(new Request('https://clientflock.test'+path),job.env)).status,405);
 await job.env.DB.prepare('UPDATE searches SET expires_at=0 WHERE id=?').bind(job.id).run();assert.equal((await api(post(),job.env)).status,404);
});
test('public search views strip contact provider and budget internals',async()=>{
 const {api}=await import('../server/research.mjs');const job=await setup();job.env.OPENAI_API_KEY='test';
 const data=JSON.parse((await job.row()).data);data.contacts={0:{status:'found',email:'alex@acme.com',certainty:'ultra_sure',message:'Found.',providerId:'private-provider-id',phase:'done',startedAt:123,person:{firstName:'Alex',lastName:'Miller',fullName:'Alex Miller',title:'Founder',profileUrl:'https://www.linkedin.com/in/alex-miller/',score:999,providerRaw:{anything:'internal'}}}};data.contactLookup={nextAt:999,internal:'hidden'};
 await job.env.DB.prepare('UPDATE searches SET data=? WHERE id=?').bind(JSON.stringify(data),job.id).run();
 const result=await(await api(new Request('https://clientflock.test/api/search/'+job.id),job.env)).json();
 assert.equal(result.data.contacts[0].email,'alex@acme.com');assert.equal(result.data.contacts[0].person.title,'Founder');
 assert.equal(result.data.contacts[0].providerId,undefined);assert.equal(result.data.contacts[0].phase,undefined);assert.equal(result.data.contacts[0].startedAt,undefined);assert.equal(result.data.contacts[0].person.score,undefined);assert.equal(result.data.contacts[0].person.providerRaw,undefined);assert.equal(result.data.contactLookup,undefined);
 const stored=JSON.parse((await job.row()).data);assert.equal(stored.contacts[0].providerId,'private-provider-id','view sanitization does not destroy resumable state');
});
test('contact endpoint dispatches one real adapter step and returns public state',async()=>{
 const {api}=await import('../server/research.mjs');const original=globalThis.fetch;const job=await setup();job.env.OPENAI_API_KEY='test';let calls=0;
 globalThis.fetch=async(url)=>{calls++;assert.equal(url,'https://app.icypeas.com/api/find-people');return Response.json({people:[person]});};
 try{
  const res=await api(new Request('https://clientflock.test/api/search/'+job.id+'/contacts',{method:'POST',headers:{origin:'https://clientflock.test','Content-Type':'application/json'},body:JSON.stringify({leadIndex:0})}),job.env);
  assert.equal(res.status,202);const result=await res.json();assert.equal(result.contact.status,'working');assert.equal(result.contact.person.fullName,'Alex Miller');assert.equal(result.contact.phase,undefined);assert.equal(result.retryAfterMs,3000);assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});
