import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {api,publicPage} from '../server/research.mjs';

const req=(path,body={})=>new Request('https://clientflock.test'+path,{method:'POST',headers:{origin:'https://clientflock.test','content-type':'application/json'},body:JSON.stringify(body)});
function database(){const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_overrated_lady_deathstrike.sql',import.meta.url),'utf8'));return {prepare(q){return {bind(...v){return {first:async()=>sql.prepare(q).get(...v),run:async()=>sql.prepare(q).run(...v)}}}}};}
const lead=name=>({name,website:'https://'+name+'.example',sourceUrl:'https://'+name+'.example/',roleToContact:'Owner',whyNow:'New workshops',whatToSell:'Booking software',benefit:'Simpler bookings'});
const profile={offer:'Booking software',languageCode:'en',requirements:[]};
const provider=leads=>Response.json({status:'completed',output:[{type:'web_search_call',action:{sources:[{url:'https://source.example/',title:'Source'}]}},{type:'message',content:[{type:'output_text',text:JSON.stringify({languageCode:'en',leads})}]}]});
async function jobAt(env,data={},stage=4){const job=await(await api(req('/api/search',{website:'product.example'}),env)).json();await env.DB.prepare("UPDATE searches SET stage=?,data=?,response_id='resp_fixture' WHERE id=?").bind(stage,JSON.stringify({qualification:{version:1,status:'pending',requiredPlatforms:[]},understanding:{profile},...data}),job.id).run();return job;}
const advance=async(env,job)=>(await api(req('/api/search/'+job.id+'/advance'),env)).json();
const store=name=>'<script>Shopify.shop="'+name+'.myshopify.com"</script><p>We offer weekend pottery workshops and personal classes in our new studio.</p>';
function network(providerLeads,reads=[]){return async(url,options)=>{const u=String(url);if(u.startsWith('https://api.openai.com/'))return provider(providerLeads);if(u.startsWith('https://cloudflare-dns.com/'))return Response.json({Answer:[{type:1,data:'93.184.216.34'}]});reads.push(new URL(u).hostname);return new Response(store(new URL(u).hostname.split('.')[0]),{headers:{'content-type':'text/html'}});};}

test('two discovered prospects survive verification and only the missing company is researched',async()=>{
 const original=fetch,env={DB:database(),OPENAI_API_KEY:'test'},reads=[];
 try{
  globalThis.fetch=network([lead('alpha'),lead('bravo')],reads);
  const job=await jobAt(env),partial=await advance(env,job);assert.equal(partial.stage,5);assert.equal(partial.data.discovery.leads.length,2);
  const checked=await advance(env,job);assert.equal(checked.stage,4);assert.equal(checked.status,'working');assert.equal(checked.data.discoveryProgress.verified,2);assert.equal(checked.data.qualification.status,'pending');assert.equal(checked.data.verified[0].sourceText,undefined);
  let payload;globalThis.fetch=async(url,options)=>{if(options?.method==='POST'){payload=JSON.parse(options.body);return Response.json({id:'resp_second',status:'in_progress'});}return network([lead('charlie')],reads)(url,options);};
  await advance(env,job);assert.match(payload.input,/research only the missing matches/i);assert.match(payload.input,/next relevant priority lists/i);
  await advance(env,job);const complete=await advance(env,job);assert.equal(complete.stage,6);assert.equal(complete.data.verified.length,3);assert.equal(complete.data.qualification.status,'verified');
  assert.deepEqual(reads.sort(),['alpha.example','bravo.example','charlie.example']);
 }finally{globalThis.fetch=original;}
});

test('extra, duplicated and malformed candidates do not discard usable companies',async()=>{
 const original=fetch,env={DB:database(),OPENAI_API_KEY:'test'};
 try{globalThis.fetch=network([lead('alpha'),{...lead('alpha'),website:'http://www.alpha.example/other'},null,{name:'Bad',website:'http://127.0.0.1'},lead('bravo'),lead('charlie'),lead('delta'),lead('rejected')]);const result=await advance(env,await jobAt(env,{rejectedDomains:['https://rejected.example']}));assert.equal(result.stage,5);assert.deepEqual(result.data.discovery.leads.map(x=>x.name),['alpha','bravo','charlie','delta']);const final=await advance(env,{id:result.id});assert.equal(final.stage,6);assert.equal(final.data.verified.length,3);}finally{globalThis.fetch=original;}
});

test('a failed Shopify candidate does not discard or recrawl the two verified companies',async()=>{
 const original=fetch,env={DB:database(),OPENAI_API_KEY:'test'},reads=[];
 try{
  globalThis.fetch=async(url,options)=>{if(new URL(url).hostname==='bravo.example')return new Response('<p>A non-Shopify business.</p>',{headers:{'content-type':'text/html'}});return network([],reads)(url,options);};
  const job=await jobAt(env,{understanding:{profile:{...profile,requirements:[{type:'platform',name:'Shopify',required:true}]}},discovery:{leads:['alpha','bravo','charlie'].map(lead)}},5),result=await advance(env,job);
  assert.equal(result.stage,4);assert.deepEqual(result.data.verified.map(x=>x.name),['alpha','charlie']);assert.deepEqual(result.data.rejectedDomains,['https://bravo.example']);assert.equal(result.data.qualification.status,'pending');assert.equal(result.data.discoveryProgress.verified,2);
  globalThis.fetch=network([lead('delta')],reads);await env.DB.prepare("UPDATE searches SET response_id='resp_fill' WHERE id=?").bind(job.id).run();await advance(env,job);const final=await advance(env,job);assert.equal(final.stage,6);assert.deepEqual(final.data.verified.map(x=>x.name),['alpha','charlie','delta']);assert.deepEqual(reads.sort(),['alpha.example','charlie.example','delta.example']);
 }finally{globalThis.fetch=original;}
});

test('empty discovery is bounded and manual continuation keeps the documents and budget',async()=>{
 const original=fetch,env={DB:database(),OPENAI_API_KEY:'test'};
 try{
  globalThis.fetch=network([]);const job=await jobAt(env,{discoveryRounds:3,mission:{document:'Saved mission'},market:{document:'Saved market'},idealClients:{document:'Saved customers'}}),paused=await advance(env,job);
  assert.equal(paused.status,'failed');assert.match(paused.error,/verified 0 of 3/);assert.doesNotMatch(paused.error,/refine your business/);
  const resumed=await(await api(req('/api/search/'+job.id+'/retry'),env)).json();assert.equal(resumed.status,'working');assert.equal(resumed.data.discoveryRounds,0);assert.equal(resumed.data.mission.document,'Saved mission');
  await env.DB.prepare("UPDATE searches SET status='failed',attempts=24 WHERE id=?").bind(job.id).run();assert.equal((await api(req('/api/search/'+job.id+'/retry'),env)).status,405);
 }finally{globalThis.fetch=original;}
});

test('old three-distinct paused searches can continue without rewriting their documents',async()=>{
 const env={DB:database(),OPENAI_API_KEY:'test'},job=await jobAt(env,{repairs:{4:2},mission:{document:'Mission already written'}});
 await env.DB.prepare("UPDATE searches SET status='failed',error=?,attempts=7 WHERE id=?").bind('We could not establish three distinct prospects. Please refine your business description.',job.id).run();
 const resumed=await(await api(req('/api/search/'+job.id+'/retry'),env)).json();assert.equal(resumed.status,'working');assert.equal(resumed.stage,4);assert.equal(resumed.data.mission.document,'Mission already written');assert.equal(resumed.data.discoveryRounds,0);
});

test('caller cancellation stops page checks before any DNS or page request',async()=>{
 const original=fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Unexpected fetch');};
 try{const controller=new AbortController();controller.abort();await assert.rejects(()=>publicPage('https://alpha.example',{signal:controller.signal}),{name:'AbortError'});assert.equal(calls,0);}finally{globalThis.fetch=original;}
});

test('prospect websites are checked concurrently, with at most three checks active',async()=>{
 const original=fetch,env={DB:database(),OPENAI_API_KEY:'test'};let active=0,peak=0;
 globalThis.fetch=async(url)=>{if(String(url).startsWith('https://cloudflare-dns.com/'))return Response.json({Answer:[{type:1,data:'93.184.216.34'}]});active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,10));active--;return new Response(store('shop'),{headers:{'content-type':'text/html'}});};
 try{const result=await advance(env,await jobAt(env,{discovery:{leads:['alpha','bravo','charlie','delta'].map(lead)}},5));assert.equal(result.stage,6);assert.equal(peak,3);}finally{globalThis.fetch=original;}
});

test('an expired shared deadline preserves unattempted companies and still reaches the bounded pause',async()=>{
 const originalFetch=fetch,originalTimeout=AbortSignal.timeout,env={DB:database(),OPENAI_API_KEY:'test'};let pageCalls=0;
 AbortSignal.timeout=ms=>ms===60000?AbortSignal.abort():originalTimeout(ms);
 globalThis.fetch=async(url)=>{if(String(url).startsWith('https://api.openai.com/'))return provider([]);pageCalls++;throw Error('A canceled check must not start');};
 try{
  const job=await jobAt(env,{discoveryRounds:3,discovery:{leads:['alpha','bravo','charlie','delta'].map(lead)}},5);
  const deferred=await advance(env,job);assert.equal(deferred.stage,4);assert.equal(deferred.status,'working');assert.equal(deferred.data.discovery.leads.length,4);assert.deepEqual(deferred.data.rejectedDomains,[]);assert.equal(pageCalls,0);
  await env.DB.prepare("UPDATE searches SET response_id='resp_last_round' WHERE id=?").bind(job.id).run();await advance(env,job);const paused=await advance(env,job);
  assert.equal(paused.status,'failed');assert.equal(paused.data.discoveryRounds,4);assert.equal(paused.data.discovery.leads.length,4);assert.deepEqual(paused.data.rejectedDomains,[]);assert.equal(pageCalls,0);
 }finally{globalThis.fetch=originalFetch;AbortSignal.timeout=originalTimeout;}
});

test('in-flight shared cancellation defers interrupted candidates instead of rejecting them',async()=>{
 const originalFetch=fetch,originalTimeout=AbortSignal.timeout,env={DB:database(),OPENAI_API_KEY:'test'},controller=new AbortController(),pages=[];
 AbortSignal.timeout=ms=>ms===60000?controller.signal:originalTimeout(ms);
 globalThis.fetch=async(url,options)=>{
  options.signal?.throwIfAborted();
  if(String(url).startsWith('https://cloudflare-dns.com/'))return Response.json({Answer:[{type:1,data:'93.184.216.34'}]});
  pages.push(new URL(url).hostname);controller.abort();throw controller.signal.reason;
 };
 try{
  const result=await advance(env,await jobAt(env,{discovery:{leads:['alpha','bravo','charlie','delta'].map(lead)}},5));
  assert.equal(result.stage,4);assert.equal(result.data.discoveryProgress.verified,0);assert.deepEqual(result.data.discovery.leads.map(x=>x.name),['alpha','bravo','charlie','delta']);assert.deepEqual(result.data.rejectedDomains,[]);assert.deepEqual(pages,['alpha.example']);
 }finally{globalThis.fetch=originalFetch;AbortSignal.timeout=originalTimeout;}
});
