import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleContacts,selectPerson,parseEmailResult,publicContact} from '../server/contacts.mjs';
function db(){const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_overrated_lady_deathstrike.sql',import.meta.url),'utf8'));return {prepare(q){return {bind(...v){return {first:async()=>sql.prepare(q).get(...v),run:async()=>sql.prepare(q).run(...v)}}}}};}
const request=(index=0,retry=false,allowNewLookup=false)=>new Request('https://clientflock.test/api/search/job/contacts',{method:'POST',headers:{'Content-Type':'application/json','cf-connecting-ip':'127.0.0.1'},body:JSON.stringify({leadIndex:index,...(retry?{retry:true}:{}),...(allowNewLookup?{allowNewLookup:true}:{})})});
async function setup(){const env={DB:db(),ICYPEAS_API_KEY:'test-not-real'};const now=Date.now();const id=crypto.randomUUID();const data={qualification:{version:1,status:'verified',requiredPlatforms:[]},leads:[{name:'Acme',website:'https://acme.com',roleToContact:'Founder'},{name:'Other',website:'https://other.com',roleToContact:'Founder'},{name:'Third',website:'https://third.com',roleToContact:'Founder'}]};await env.DB.prepare("INSERT INTO searches(id,cache_key,input,data,status,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?)").bind(id,id,'{}',JSON.stringify(data),'complete',now,now,now+86400000).run();return {env,id,row:()=>env.DB.prepare('SELECT * FROM searches WHERE id=?').bind(id).first()};}
async function clearCooldown(job){const row=await job.row();const data=JSON.parse(row.data);data.contactLookup={...data.contactLookup,nextAt:0};await job.env.DB.prepare('UPDATE searches SET data=? WHERE id=?').bind(JSON.stringify(data),job.id).run();}
async function seedContact(job,contact){const data=JSON.parse((await job.row()).data);data.contacts={0:contact};await job.env.DB.prepare('UPDATE searches SET data=? WHERE id=?').bind(JSON.stringify(data),job.id).run();}
const person={firstname:'Alex',lastname:'Miller',currentJobTitle:'Founder',currentCompanyWebsite:'https://acme.com',linkedinUrl:'https://www.linkedin.com/in/alex-miller/'};
// Field names from the response accordion at https://api-doc.icypeas.com/leads-db/find-people/
// (official Docusaurus chunk assets/js/b780ae89.4ffd5d17.js). Identity below is fictional.
const officialPerson={firstname:'Alex',lastname:'Miller',lastJobTitle:'Chief Executive Officer',lastCompanyWebsite:'https://www.acme.com',profileUrl:'https://www.linkedin.com/in/alex-miller/'};
test('people require explicit current company, real name and professional profile',()=>{assert.equal(selectPerson({people:[person]},'acme.com').fullName,'Alex Miller');assert.throws(()=>selectPerson({people:[{...person,currentCompanyWebsite:'other.com'}]},'acme.com'));assert.throws(()=>selectPerson({people:[{...person,linkedinUrl:'https://example.com/private'}]},'acme.com'));assert.throws(()=>selectPerson({success:true},'acme.com'));assert.equal(selectPerson({people:[]},'acme.com'),null);});
test('documented leads envelope and most-recent company/job fields match CEO, co-founder and shop owner roles',()=>{
 const payload=record=>({success:true,total:1,leads:[record],pagination:{size:3,token:'unused'}});
 assert.equal(selectPerson(payload(officialPerson),'acme.com','CEO').fullName,'Alex Miller');
 for(const title of ['Co-Founder','CoFounder','Business Owner','Owner','General Manager','Workshop Operations Manager'])assert.equal(selectPerson(payload({...officialPerson,lastJobTitle:title}),'acme.com','Owner or workshop operations manager').title,title);
 assert.equal(selectPerson({success:true,total:0,leads:[]},'acme.com'),null);
 assert.throws(()=>selectPerson(payload({...officialPerson,lastCompanyWebsite:'https://other.com'}),'acme.com'));
 assert.throws(()=>selectPerson(payload({...officialPerson,lastJobTitle:'Marketing Manager'}),'acme.com','Owner or workshop operations manager'));
 assert.throws(()=>selectPerson(payload({firstname:'Alex',lastname:'Miller'}),'acme.com'),'optional provider fields cannot be invented to establish a match');
 assert.throws(()=>selectPerson({success:true,leads:[{name:'Acme',website:'https://acme.com'}]},'acme.com'),'a company example must never be treated as a person');
});
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
 try{const result=await(await handleContacts(request(),job.env,await job.row())).json();assert.equal(result.contact.status,'error');assert.match(result.contact.message,/unknown outcome/);await clearCooldown(job);await handleContacts(request(0,true),job.env,await job.row());assert.equal(calls,1);}finally{globalThis.fetch=original;}
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

test('authentication failure needs explicit retry, respects cooldown, and trims a corrected API Key',async()=>{
 const original=globalThis.fetch;const job=await setup();let calls=0;let authorization;
 globalThis.fetch=async(_url,options)=>{calls++;authorization=options.headers.Authorization;return calls===1?Response.json({success:false},{status:401}):Response.json({people:[person]});};
 try{
  const rejected=await(await handleContacts(request(),job.env,await job.row())).json();
  assert.equal(rejected.contact.status,'error');assert.equal(rejected.contact.errorCode,'auth_configuration');assert.equal(rejected.contact.retryable,true);assert.match(rejected.contact.message,/API Key, not the API Secret/);assert.equal(rejected.retryAfterMs,30000);
  assert.equal(rejected.contact.authKeyHash,undefined);assert.equal(rejected.contact.authRetryAt,undefined);
  await clearCooldown(job);
  const tooSoon=await handleContacts(request(0,true),job.env,await job.row());assert.equal(tooSoon.status,429);assert.ok((await tooSoon.json()).retryAfterMs>0);assert.equal(calls,1);
  job.env.ICYPEAS_API_KEY='  corrected-key\n';
  await handleContacts(request(),job.env,await job.row());assert.equal(calls,1,'corrected credentials alone do not trigger replay');
  const resumed=await(await handleContacts(request(0,true),job.env,await job.row())).json();
  assert.equal(resumed.contact.status,'working');assert.equal(resumed.contact.person.fullName,'Alex Miller');assert.equal(resumed.contact.errorCode,undefined);assert.equal(resumed.contact.retryable,undefined);assert.equal(authorization,'corrected-key');assert.equal(calls,2);
 }finally{globalThis.fetch=original;}
});
test('legacy cached auth failures are retryable without replaying ambiguous failures',async()=>{
 const legacy={status:'error',message:'Icypeas authentication was rejected. Check the server API key.',phase:'done',lastOperation:'discover',startedAt:123};
 assert.equal(publicContact(legacy).retryable,true);assert.equal(publicContact(legacy).errorCode,'auth_configuration');
 assert.equal(publicContact({...legacy,message:'The provider request has an unknown outcome.'}).retryable,undefined);
 const original=globalThis.fetch;const job=await setup();let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({people:[person]});};
 try{
  const data=JSON.parse((await job.row()).data);data.contacts={0:legacy};await job.env.DB.prepare('UPDATE searches SET data=? WHERE id=?').bind(JSON.stringify(data),job.id).run();
  const cached=await(await handleContacts(request(),job.env,await job.row())).json();assert.equal(cached.contact.retryable,true);assert.equal(calls,0);
  const retried=await(await handleContacts(request(0,true),job.env,await job.row())).json();assert.equal(retried.contact.status,'working');assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});
test('definite auth rejection resumes create or poll without repeating prior paid stages',async()=>{
 const original=globalThis.fetch;
 try {for(const operation of ['create','poll']){
  const job=await setup();const data=JSON.parse((await job.row()).data);const identity={firstName:'Alex',lastName:'Miller',fullName:'Alex Miller',title:'Founder',profileUrl:person.linkedinUrl};
  data.contacts={0:{status:'working',phase:operation==='create'?'person_ready':'poll',person:identity,startedAt:123,...(operation==='poll'?{providerId:'saved-provider-id',polls:4}:{})}};
  await job.env.DB.prepare('UPDATE searches SET data=? WHERE id=?').bind(JSON.stringify(data),job.id).run();
  let calls=[];
  globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});if(calls.length===1)return Response.json({success:false},{status:operation==='create'?403:401});return operation==='create'?Response.json({success:true,item:{_id:'new-provider-id',status:'NONE'}}):Response.json({success:true,items:[{_id:'saved-provider-id',status:'DEBITED',results:{emails:[{email:'alex@acme.com',certainty:'very_sure'}]}}]});};
  const denied=await(await handleContacts(request(),job.env,await job.row())).json();assert.equal(denied.contact.retryable,true);
  const saved=JSON.parse((await job.row()).data).contacts[0];assert.equal(saved.phase,operation==='create'?'person_ready':'poll');if(operation==='poll')assert.equal(saved.polls,4);
  job.env.ICYPEAS_API_KEY='fixed-key';await clearCooldown(job);
  if(operation==='poll')await job.env.DB.prepare('DELETE FROM budgets WHERE key=?').bind('icypeas:readslot:'+Math.floor(Date.now()/3000)).run();
  const resumed=await(await handleContacts(request(0,true),job.env,await job.row())).json();assert.equal(calls.length,2);assert.ok(calls.every(call=>call.url.endsWith(operation==='create'?'email-search':'bulk-single-searchs/read')));
  if(operation==='create'){assert.equal(resumed.contact.status,'working');assert.equal(JSON.parse((await job.row()).data).contacts[0].providerId,'new-provider-id');}
  else {assert.equal(resumed.contact.status,'found');assert.deepEqual(calls[1].body,{id:'saved-provider-id'});}
 }}finally{globalThis.fetch=original;}
});

test('official discovery response is saved privately before a shop-owner email search is prepared',async()=>{
 const original=globalThis.fetch;const job=await setup();let calls=0;
 const data=JSON.parse((await job.row()).data);data.leads[0].roleToContact='Owner or workshop operations manager';await job.env.DB.prepare('UPDATE searches SET data=? WHERE id=?').bind(JSON.stringify(data),job.id).run();
 globalThis.fetch=async(url,options)=>{
  calls++;assert.ok(url.endsWith('find-people'));const body=JSON.parse(options.body);
  assert.deepEqual(body.query.currentCompanyWebsite.include,['acme.com']);assert.equal(body.pagination.size,10);
  for(const title of ['Owner','Business Owner','General Manager','Co-Founder'])assert.ok(body.query.currentJobTitle.include.includes(title));
  return Response.json({success:true,total:1,leads:[{...officialPerson,lastJobTitle:'Business Owner',description:'x'.repeat(100000)}],pagination:{size:3,token:'private-pagination'},apiKey:'must-not-be-retained'});
 };
 try{
  const result=await(await handleContacts(request(),job.env,await job.row())).json();
  assert.equal(calls,1);assert.equal(result.contact.person.title,'Business Owner');assert.equal(result.contact.status,'working');
  assert.equal(result.contact.discoveryPayload,undefined);assert.equal(result.contact.discoveryCapturedAt,undefined);
  const saved=JSON.parse((await job.row()).data).contacts[0];
  assert.equal(saved.phase,'person_ready');assert.equal(saved.discoveryParserVersion,3);assert.ok(saved.discoveryCapturedAt>0);
  assert.equal(saved.discoveryPayload.leads[0].lastCompanyWebsite,'https://www.acme.com');assert.equal(saved.discoveryPayload.apiKey,undefined);assert.equal(saved.discoveryPayload.pagination.token,undefined);
  assert.ok(JSON.stringify(saved.discoveryPayload).length<5000,'provider strings are bounded');
 }finally{globalThis.fetch=original;}
});

test('unsupported responses are retained and local retries cannot repeat discovery or start email search',async()=>{
 const original=globalThis.fetch;const job=await setup();let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({success:true,unexpected:{records:[{name:'Company, not a person'}]}});};
 try{
  const failed=await(await handleContacts(request(),job.env,await job.row())).json();
  assert.equal(failed.contact.errorCode,'people_response');assert.equal(failed.contact.retryable,true);assert.equal(failed.contact.requiresNewLookup,false);assert.equal(calls,1);
  let saved=JSON.parse((await job.row()).data).contacts[0];assert.ok(saved.discoveryPayload);assert.equal(saved.phase,'parse_people');assert.equal(saved.providerId,undefined);
  await handleContacts(request(),job.env,await job.row());
  await handleContacts(request(0,true,true),job.env,await job.row());assert.equal(calls,1,'even allowNewLookup cannot force a paid resubmission when a response is saved');
  saved=JSON.parse((await job.row()).data).contacts[0];assert.equal(saved.errorCode,'people_response');
 }finally{globalThis.fetch=original;}
});

test('saved old-parser failures and interrupted parsing recover locally without a provider call',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Must not contact provider while reparsing');};
 try {for(const status of ['error','working']){
  const job=await setup();
  await seedContact(job,{status,phase:'parse_people',lastOperation:'discover',startedAt:123,errorCode:status==='error'?'people_response':undefined,message:'Icypeas returned an unsupported people response. No email search was started.',discoveryPayload:{success:true,total:1,leads:[officialPerson]}});
  const result=await(await handleContacts(request(0,status==='error'),job.env,await job.row())).json();
  assert.equal(result.contact.status,'working');assert.equal(result.contact.person.fullName,'Alex Miller');assert.equal(result.contact.errorCode,undefined);assert.equal(result.contact.requiresNewLookup,undefined);
  assert.equal(JSON.parse((await job.row()).data).contacts[0].phase,'person_ready');assert.equal(calls,0);
 }}finally{globalThis.fetch=original;}
});

test('legacy discarded responses require explicit credit consent and concurrent retries discover only once',async()=>{
 const original=globalThis.fetch;const job=await setup();let calls=0;
 const legacy={status:'error',phase:'done',lastOperation:'discover',startedAt:123,message:'Icypeas returned an unsupported people response. No email search was started.'};
 globalThis.fetch=async(url)=>{calls++;assert.ok(url.endsWith('find-people'));return Response.json({success:true,total:1,leads:[officialPerson]});};
 try{
  await seedContact(job,legacy);
  const cached=await(await handleContacts(request(),job.env,await job.row())).json();
  assert.equal(cached.contact.errorCode,'people_response');assert.equal(cached.contact.retryable,true);assert.equal(cached.contact.requiresNewLookup,true);assert.match(cached.contact.message,/may use credits/);
  await handleContacts(request(0,true),job.env,await job.row());assert.equal(calls,0,'generic retry never silently incurs a replacement discovery charge');
  const row=await job.row();await Promise.all([handleContacts(request(0,true,true),job.env,row),handleContacts(request(0,true,true),job.env,row)]);
  assert.equal(calls,1);const saved=JSON.parse((await job.row()).data).contacts[0];assert.equal(saved.peopleRecoveryCount,1);assert.equal(saved.phase,'person_ready');assert.ok(saved.discoveryPayload);
  const day=new Date().toISOString().slice(0,10);assert.equal((await job.env.DB.prepare('SELECT count FROM budgets WHERE key=?').bind('icypeas:daily:'+day).first()).count,1,'replacement discovery uses the normal daily budget');
  await seedContact(job,{...legacy,peopleRecoveryCount:1});
  const stopped=await(await handleContacts(request(0,true,true),job.env,await job.row())).json();assert.equal(stopped.contact.retryable,false);assert.equal(calls,1,'a discarded replacement cannot be repeatedly submitted');
 }finally{globalThis.fetch=original;}
});

test('legacy recovery obeys the daily budget and unknown paid create outcomes stay nonretryable',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new DOMException('Timed out','TimeoutError');};
 try{
  const capped=await setup();await seedContact(capped,{status:'error',phase:'done',lastOperation:'discover',startedAt:123,message:'Icypeas returned an unsupported people response. No email search was started.'});
  await capped.env.DB.prepare('INSERT INTO budgets(key,count) VALUES(?,?)').bind('icypeas:daily:'+new Date().toISOString().slice(0,10),30).run();
  assert.equal((await handleContacts(request(0,true,true),capped.env,await capped.row())).status,429);assert.equal(calls,0);
  const ambiguous=await setup();await seedContact(ambiguous,{status:'working',phase:'person_ready',startedAt:123,person:{firstName:'Alex',lastName:'Miller'}});
  const failed=await(await handleContacts(request(),ambiguous.env,await ambiguous.row())).json();assert.equal(failed.contact.retryable,false);assert.match(failed.contact.message,/unknown outcome/);
  await clearCooldown(ambiguous);await handleContacts(request(0,true,true),ambiguous.env,await ambiguous.row());assert.equal(calls,1,'credit consent is never an override for an unknown email-create outcome');
 }finally{globalThis.fetch=original;}
});

const noWebsiteContact=async()=>({status:'not_found',checkedAt:new Date().toISOString(),pagesChecked:2});
const step=async(job,options={})=>{await clearCooldown(job);return (await handleContacts(request(),job.env,await job.row(),{findCompanyContacts:noWebsiteContact,...options})).json();};

test('localized owners and department leaders are scored beyond the first three candidates',()=>{
 for(const title of ['Gérante','Fondatrice','Proprietário','Sócio fundador','Geschäftsführer','Inhaber','President','Managing Director'])assert.equal(selectPerson({leads:[{...officialPerson,lastJobTitle:title}]},'acme.com','Owner').title,title);
 const irrelevant=Array.from({length:8},()=>({...officialPerson,lastJobTitle:'Software Engineer'}));
 assert.equal(selectPerson({leads:[...irrelevant,{...officialPerson,lastJobTitle:'Gerente de operações'}]},'acme.com','Operations Manager').title,'Gerente de operações');
 assert.equal(selectPerson({leads:[{...officialPerson,lastJobTitle:'CEO'},{...officialPerson,firstname:'Dana',lastJobTitle:'Head of Marketing'}]},'acme.com','Marketing Director').firstName,'Dana');
 assert.throws(()=>selectPerson({leads:[{...officialPerson,lastJobTitle:'Assistant to CEO'}]},'acme.com','CEO'));
 assert.throws(()=>selectPerson({leads:[{...officialPerson,lastJobTitle:'Former Founder'}]},'acme.com','Founder'));
 assert.throws(()=>selectPerson({leads:[{...officialPerson,lastJobTitle:'Founder',lastCompanyWebsite:'acme.com.evil.test'}]},'acme.com'));
});

test('an empty role query checks first-party pages then broadens only within the same company',async()=>{
 const original=globalThis.fetch,job=await setup();let calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return Response.json({success:true,leads:calls.length===1?[]:[...Array.from({length:8},()=>({...officialPerson,lastJobTitle:'Engineer'})),{...officialPerson,lastJobTitle:'Gérante'}]});};
 try{
  const first=await step(job);assert.equal(first.contact.status,'working');assert.match(first.contact.message,/contact and team pages/);assert.equal(calls.length,1);
  const website=await step(job);assert.equal(website.contact.status,'working');assert.match(website.contact.message,/Broadening/);assert.equal(calls.length,1,'company HTTP stage does not query Icypeas');
  const broad=await step(job);assert.equal(broad.contact.person.title,'Gérante');assert.equal(calls.length,2);
  assert.equal(calls[0].body.pagination.size,10);assert.ok(calls[0].body.query.currentJobTitle.include.includes('Gérant'));
  assert.deepEqual(calls[1].body,{query:{currentCompanyWebsite:{include:['acme.com']}},pagination:{size:20}});
  const day=new Date().toISOString().slice(0,10);assert.equal((await job.env.DB.prepare('SELECT count FROM budgets WHERE key=?').bind('icypeas:daily:'+day).first()).count,2);
  const saved=JSON.parse((await job.row()).data).contacts[0];assert.equal(saved.discoveryPayload.leads.length,9,'later candidates survive durable snapshot');
 }finally{globalThis.fetch=original;}
});

test('exhausted broad search is a coverage result, cached and never automatically repeated',async()=>{
 const original=globalThis.fetch,job=await setup();let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({success:true,leads:[]});};
 try{
  await step(job);await step(job);const final=await step(job);
  assert.equal(final.contact.status,'not_found');assert.equal(final.contact.retryable,false);assert.match(final.contact.message,/Icypeas is connected/);assert.equal(calls,2);
  await handleContacts(request(0,true,true),job.env,await job.row());assert.equal(calls,2);
 }finally{globalThis.fetch=original;}
});

test('legacy empty results need explicit broader lookup consent and are recovered once',async()=>{
 const original=globalThis.fetch,job=await setup();let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({success:true,leads:[officialPerson]});};
 try{
  await seedContact(job,{status:'not_found',phase:'done',lastOperation:'discover',discoveryParserVersion:2,startedAt:123,message:'No matching current decision maker was found.',discoveryPayload:{success:true,leads:[]}});
  const prior=await(await handleContacts(request(),job.env,await job.row())).json();assert.equal(prior.contact.errorCode,'people_no_match');assert.equal(prior.contact.retryable,true);assert.equal(prior.contact.requiresNewLookup,true);
  await handleContacts(request(0,true),job.env,await job.row());assert.equal(calls,0,'retry alone does not authorize additional discovery');
  const resumed=await(await handleContacts(request(0,true,true),job.env,await job.row())).json();assert.equal(resumed.contact.status,'working');assert.equal(calls,0,'reuse saved response before choosing fallback');
  await step(job);const found=await step(job);assert.equal(found.contact.person.fullName,'Alex Miller');assert.equal(calls,1,'does not repeat original narrow query');
  assert.equal(JSON.parse((await job.row()).data).contacts[0].noMatchRecoveryCount,1);
 }finally{globalThis.fetch=original;}
});

test('broader query respects daily budget and can safely resume next day',async()=>{
 const original=globalThis.fetch,job=await setup();let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({success:true,leads:[officialPerson]});};
 try{
  await seedContact(job,{status:'working',phase:'discover',discoveryMode:'broad',discoveryBudgetReady:false,startedAt:123,websiteChecked:true});
  const day=new Date().toISOString().slice(0,10);await job.env.DB.prepare('INSERT INTO budgets(key,count) VALUES(?,?)').bind('icypeas:daily:'+day,30).run();
  const capped=await handleContacts(request(),job.env,await job.row());assert.equal(capped.status,429);const cap=await capped.json();assert.equal(cap.contact.errorCode,'daily_limit');assert.equal(cap.contact.status,'error');assert.equal(cap.contact.retryable,true);assert.ok(cap.retryAfterMs>0);assert.equal(calls,0);
  await handleContacts(request(0,true,true),job.env,await job.row());assert.equal(calls,0);
  const data=JSON.parse((await job.row()).data);data.contacts[0].budgetRetryAt=Date.now()-1;await job.env.DB.prepare('UPDATE searches SET data=? WHERE id=?').bind(JSON.stringify(data),job.id).run();await job.env.DB.prepare('DELETE FROM budgets WHERE key=?').bind('icypeas:daily:'+day).run();
  const resumed=await(await handleContacts(request(0,true,true),job.env,await job.row())).json();assert.equal(resumed.contact.person.fullName,'Alex Miller');assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});

test('published company inbox must be verified and never impersonates a named decision maker',async()=>{
 const original=globalThis.fetch,job=await setup();let calls=[];
 const website={findCompanyContacts:async()=>({status:'found',email:{email:'hello@acme.com',kind:'company_mailbox',sourceUrl:'https://acme.com/contact',published:true,verified:false},checkedAt:new Date().toISOString(),pagesChecked:2})};
 globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});if(url.endsWith('find-people'))return Response.json({success:true,leads:[]});if(url.endsWith('email-verification'))return Response.json({success:true,item:{_id:'verification-1',status:'NONE'}});return Response.json({success:true,items:[{_id:'verification-1',status:'DEBITED',results:{emails:[{email:'hello@acme.com',certainty:'ultra_sure'}]}}]});};
 try{
  await step(job);const published=await step(job,website);assert.equal(published.contact.status,'working');assert.equal(published.contact.contactKind,'company_mailbox');assert.equal(published.contact.email,undefined);assert.equal(published.contact.pendingEmail,undefined);assert.equal(published.contact.person,undefined);assert.equal(calls.length,1);
  await step(job);assert.equal(calls[1].url,'https://app.icypeas.com/api/email-verification');assert.equal(calls[1].body.email,'hello@acme.com');assert.equal(JSON.parse((await job.row()).data).contacts[0].providerId,'verification-1');
  const verified=await step(job);assert.equal(verified.contact.status,'found');assert.equal(verified.contact.email,'hello@acme.com');assert.equal(verified.contact.contactKind,'company_mailbox');assert.equal(verified.contact.sourceUrl,'https://acme.com/contact');assert.equal(verified.contact.person,undefined);assert.match(verified.contact.message,/not a named person/);
  await step(job);assert.equal(calls.length,3,'verified company inbox is cached');
 }finally{globalThis.fetch=original;}
});

test('first-party named founder skips broader discovery and preserves source evidence',async()=>{
 const original=globalThis.fetch,job=await setup();let calls=[];
 const website={findCompanyContacts:async()=>({status:'found',person:{firstName:'Alex',lastName:'Miller',fullName:'Alex Miller',title:'Founder',profileUrl:officialPerson.profileUrl,sourceUrl:'https://acme.com/team'},checkedAt:new Date().toISOString(),pagesChecked:2})};
 globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return url.endsWith('find-people')?Response.json({success:true,leads:[]}):Response.json({success:true,item:{_id:'named-1',status:'NONE'}});};
 try{
  await step(job);const person=await step(job,website);assert.equal(person.contact.person.fullName,'Alex Miller');assert.equal(person.contact.person.sourceUrl,'https://acme.com/team');assert.equal(person.contact.contactKind,'person');assert.equal(calls.length,1);
  await step(job);assert.equal(calls[1].url,'https://app.icypeas.com/api/email-search');assert.equal(calls[1].body.firstname,'Alex');assert.equal(calls[1].body.lastname,'Miller');assert.equal(calls[1].body.domainOrCompany,'acme.com');
 }finally{globalThis.fetch=original;}
});

test('unrelated website contacts and mismatched verification results are rejected',async()=>{
 const original=globalThis.fetch,job=await setup();let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({success:true,leads:[]});};
 try{
  await step(job);const unsafe=await step(job,{findCompanyContacts:async()=>({status:'found',email:{email:'hello@evil.com',sourceUrl:'https://evil.com/contact',published:true},person:{firstName:'Alex',lastName:'Miller',title:'Founder',profileUrl:officialPerson.profileUrl,sourceUrl:'https://evil.com/team'}})});
  assert.equal(unsafe.contact.email,undefined);assert.equal(unsafe.contact.person,undefined);assert.match(unsafe.contact.message,/Broadening/);assert.equal(calls,1);
  assert.throws(()=>parseEmailResult({items:[{_id:'v1',status:'DEBITED',results:{emails:[{email:'different@acme.com',certainty:'ultra_sure'}]}}]},'v1','acme.com','hello@acme.com'));
 }finally{globalThis.fetch=original;}
});

test('unknown verification outcome remains nonretryable after website fallback',async()=>{
 const original=globalThis.fetch,job=await setup();let calls=0;
 globalThis.fetch=async()=>{calls++;throw new DOMException('Timed out','TimeoutError');};
 try{
  await seedContact(job,{status:'working',phase:'email_ready',contactKind:'company_mailbox',pendingEmail:'hello@acme.com',sourceUrl:'https://acme.com/contact',startedAt:123});
  const failed=await step(job);assert.equal(failed.contact.status,'error');assert.equal(failed.contact.retryable,false);assert.match(failed.contact.message,/unknown outcome/);
  await clearCooldown(job);await handleContacts(request(0,true,true),job.env,await job.row());assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});

test('a definite missing personal email falls back once to a published company inbox',async()=>{
 const original=globalThis.fetch,job=await setup();let calls=[],crawls=0;
 const website={findCompanyContacts:async()=>{crawls++;return {status:'found',email:{email:'hello@acme.com',sourceUrl:'https://acme.com/contact',published:true},person:{firstName:'Alex',lastName:'Miller',title:'Founder',profileUrl:officialPerson.profileUrl,sourceUrl:'https://acme.com/team'}};}};
 globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body});if(url.endsWith('find-people'))return Response.json({success:true,leads:[officialPerson]});if(url.endsWith('email-search'))return Response.json({success:true,item:{_id:'personal-1'}});if(url.endsWith('email-verification'))return Response.json({success:true,item:{_id:'published-1'}});return body.id==='personal-1'?Response.json({items:[{_id:'personal-1',status:'DEBITED_NOT_FOUND'}]}):Response.json({items:[{_id:'published-1',status:'DEBITED',results:{emails:[{email:'hello@acme.com',certainty:'very_sure'}]}}]});};
 try{
  await step(job);await step(job);const missing=await step(job);assert.equal(missing.contact.status,'working');assert.match(missing.contact.message,/published contact details/);
  const published=await step(job,website);assert.equal(published.contact.contactKind,'company_mailbox');assert.equal(published.contact.person,undefined);assert.equal(crawls,1);
  await step(job);await job.env.DB.prepare('DELETE FROM budgets WHERE key=?').bind('icypeas:readslot:'+Math.floor(Date.now()/3000)).run();const verified=await step(job);assert.equal(verified.contact.email,'hello@acme.com');assert.equal(verified.contact.status,'found');assert.equal(calls.filter(c=>c.url.endsWith('email-search')).length,1);
  const saved=JSON.parse((await job.row()).data).contacts[0];assert.equal(saved.previousProviderId,'personal-1');assert.equal(saved.providerId,'published-1');assert.equal(saved.previousPerson.fullName,'Alex Miller');assert.equal(verified.contact.previousProviderId,undefined);
 }finally{globalThis.fetch=original;}
});

test('website returns both person and inbox, so personal NOT_FOUND reuses the saved mailbox without another crawl',async()=>{
 const original=globalThis.fetch,job=await setup();let crawls=0,calls=[];
 const website={findCompanyContacts:async()=>{crawls++;return {status:'found',email:{email:'bookings@mail.acme.com',sourceUrl:'https://acme.com/contact',published:true},person:{firstName:'Alex',lastName:'Miller',title:'Founder',profileUrl:officialPerson.profileUrl,sourceUrl:'https://acme.com/team'}};}};
 globalThis.fetch=async(url,options)=>{calls.push(url);if(url.endsWith('find-people'))return Response.json({success:true,leads:[]});if(url.endsWith('email-search'))return Response.json({success:true,item:{_id:'personal-1'}});if(url.endsWith('email-verification'))return Response.json({success:true,item:{_id:'verification-1'}});return Response.json({items:[{_id:'personal-1',status:'NOT_FOUND'}]});};
 try{
  await step(job);await step(job,website);await step(job);const missing=await step(job);assert.equal(missing.contact.status,'working');assert.equal(missing.contact.contactKind,'company_mailbox');assert.equal(missing.contact.email,undefined);
  await step(job,website);assert.equal(crawls,1);assert.equal(calls.filter(u=>u.endsWith('email-search')).length,1);assert.equal(calls.filter(u=>u.endsWith('email-verification')).length,1);
  assert.equal(JSON.parse((await job.row()).data).contacts[0].pendingEmail,'bookings@mail.acme.com');
 }finally{globalThis.fetch=original;}
});

test('an undeliverable website inbox continues to the bounded broad search without ever verifying it twice',async()=>{
 const original=globalThis.fetch,job=await setup();let calls=[];
 const website={findCompanyContacts:async()=>({status:'found',email:{email:'hello@acme.com',sourceUrl:'https://acme.com/contact',published:true}})};
 globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body});if(url.endsWith('find-people'))return Response.json({success:true,leads:body.query.currentJobTitle?[]:[officialPerson]});if(url.endsWith('email-verification'))return Response.json({success:true,item:{_id:'bad-inbox'}});if(url.endsWith('email-search'))return Response.json({success:true,item:{_id:'named-inbox'}});return Response.json({items:[{_id:body.id,status:'NOT_FOUND'}]});};
 try{
  await step(job);await step(job,website);await step(job);const invalid=await step(job);assert.equal(invalid.contact.status,'working');assert.match(invalid.contact.message,/Broadening/);
  const broad=await step(job);assert.equal(broad.contact.person.fullName,'Alex Miller');await step(job);await job.env.DB.prepare('DELETE FROM budgets WHERE key=?').bind('icypeas:readslot:'+Math.floor(Date.now()/3000)).run();const last=await step(job);assert.equal(last.contact.status,'not_found');
  await step(job);assert.equal(calls.filter(c=>c.url.endsWith('email-verification')).length,1);assert.equal(calls.filter(c=>c.url.endsWith('email-search')).length,1);assert.equal(calls.filter(c=>c.url.endsWith('find-people')).length,2);
 }finally{globalThis.fetch=original;}
});

test('an interrupted or failed website fallback cannot restart a completed personal email search',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('No provider replay is allowed');};
 try{for(const phase of ['website','website_in_progress']){
  const job=await setup();await seedContact(job,{status:'working',phase,startedAt:123,namedLookupFinished:true,previousProviderId:'completed-personal',discoveryMode:'targeted',websiteChecked:phase==='website_in_progress'});
  const final=await step(job,{findCompanyContacts:async()=>{throw new DOMException('Timeout','TimeoutError');}});assert.equal(final.contact.status,'not_found');assert.equal(calls,0);
  await handleContacts(request(0,true,true),job.env,await job.row());assert.equal(calls,0);
 }}finally{globalThis.fetch=original;}
});

test('published-email verification resumes after the daily budget resets without repeating discovery',async()=>{
 const original=globalThis.fetch,job=await setup();let calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return Response.json({success:true,item:{_id:'resumed-verification',status:'NONE'}});};
 try{
  await seedContact(job,{status:'working',phase:'email_ready',contactKind:'company_mailbox',pendingEmail:'hello@acme.com',sourceUrl:'https://acme.com/contact',startedAt:123,websiteChecked:true});
  const day=new Date().toISOString().slice(0,10);await job.env.DB.prepare('INSERT INTO budgets(key,count) VALUES(?,?)').bind('icypeas:daily:'+day,30).run();
  const capped=await handleContacts(request(),job.env,await job.row());assert.equal(capped.status,429);const waiting=await capped.json();assert.equal(waiting.contact.errorCode,'daily_limit');assert.equal(waiting.contact.retryable,true);assert.equal(waiting.contact.requiresNewLookup,true);assert.ok(waiting.retryAfterMs>0);assert.equal(calls.length,0);
  assert.equal(JSON.parse((await job.row()).data).contacts[0].phase,'email_ready');
  await handleContacts(request(0,true,true),job.env,await job.row());assert.equal(calls.length,0,'cannot bypass the saved reset time');
  const data=JSON.parse((await job.row()).data);data.contacts[0].budgetRetryAt=Date.now()-1;await job.env.DB.prepare('UPDATE searches SET data=? WHERE id=?').bind(JSON.stringify(data),job.id).run();await job.env.DB.prepare('DELETE FROM budgets WHERE key=?').bind('icypeas:daily:'+day).run();
  const row=await job.row();await Promise.all([handleContacts(request(0,true,true),job.env,row),handleContacts(request(0,true,true),job.env,row)]);
  assert.equal(calls.length,1,'concurrent retries submit verification once');assert.equal(calls[0].url,'https://app.icypeas.com/api/email-verification');assert.equal(calls[0].body.email,'hello@acme.com');
  const saved=JSON.parse((await job.row()).data).contacts[0];assert.equal(saved.phase,'poll');assert.equal(saved.providerId,'resumed-verification');assert.equal(saved.verificationBudgetReady,true);assert.equal(saved.errorCode,undefined);
 }finally{globalThis.fetch=original;}
});
