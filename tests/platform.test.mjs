import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {api,normalizeInput,publicPage} from '../server/research.mjs';
import {detectPlatform,platformMatchesRequirements,shopifyDependency} from '../server/platform.mjs';
const req=(path,body={})=>new Request('https://clientflock.test'+path,{method:'POST',headers:{origin:'https://clientflock.test','content-type':'application/json'},body:JSON.stringify(body)});
function database(){const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_overrated_lady_deathstrike.sql',import.meta.url),'utf8'));return {prepare(q){return {bind(...values){return {first:async()=>sql.prepare(q).get(...values),run:async()=>sql.prepare(q).run(...values)}}}}};}
const qualified={version:1,status:'pending',requiredPlatforms:[]};
const requirement={type:'platform',name:'Shopify',required:true,reason:'The product is a Shopify app.',evidence:{url:null,quote:'We sell a Shopify booking app for workshops.'}};
const profile={offer:'Shopify booking app',languageCode:'en',requirements:[requirement]};
const provider=output=>Response.json({status:'completed',output:[{type:'web_search_call',action:{sources:[{url:'https://product.example',title:'Product'}]}},{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}]});
const leads=()=>['alpha','bravo','charlie'].map(name=>({name,website:'https://'+name+'.example',sourceUrl:'https://'+name+'.example',sourceTitle:name,contactUrl:'https://'+name+'.example',roleToContact:'Owner'}));
async function jobAt(env,stage,data){const job=await(await api(req('/api/search',{website:'product.example'}),env)).json();await env.DB.prepare("UPDATE searches SET stage=?,data=?,response_id=NULL WHERE id=?").bind(stage,JSON.stringify({qualification:qualified,...data}),job.id).run();return job;}
const advance=async(env,job)=>(await api(req('/api/search/'+job.id+'/advance'),env)).json();
function pageMock(pages){return async url=>{const u=String(url);if(u.startsWith('https://cloudflare-dns.com/'))return Response.json({Answer:[{type:1,data:'93.184.216.34'}]});const page=pages[new URL(u).hostname];if(page===undefined)throw Error('Unexpected network request: '+u);return page===null?new Response('Unavailable',{status:503}):new Response(page,{headers:{'content-type':'text/html'}});};}
const store=(name='alpha')=>'<html><script>var Shopify={}; Shopify.shop = "'+name+'.myshopify.com"; Shopify.checkoutToken="do-not-expose";</script><p>We now offer weekend pottery workshops with two afternoon sessions.</p></html>';

test('Shopify proof uses executable storefront signals and never exposes script secrets',()=>{
 const proof=detectPlatform(store(),'https://alpha.example','2026-10-24T10:00:00Z');assert.equal(proof.status,'verified');assert.equal(proof.name,'Shopify');assert.equal(proof.url,'https://alpha.example');assert.match(proof.evidence[0],/alpha\.myshopify\.com/);assert.doesNotMatch(JSON.stringify(proof),/do-not-expose|checkoutToken/);
 for(const html of ['<script src="https://cdn.shopify.com/shopifycloud/storefront/assets/shop.js"></script>','<link rel="stylesheet" href="//cdn.shopify.com/s/files/1/123/theme.css">','<link href="https://alpha.myshopify.com/" rel="canonical">'])assert.equal(detectPlatform(html,'https://alpha.example').status,'verified');
});
test('mentions, links, copied code and fake CDN hosts are not Shopify proof',()=>{
 for(const html of ['<p>We sell Shopify services.</p>','<a href="https://cdn.shopify.com/s/files/1/123/theme.js">Example script</a>','<pre><script>Shopify.shop="alpha.myshopify.com"</script></pre>','<!-- <script>Shopify.shop="alpha.myshopify.com"</script> -->','<script type="application/ld+json">{"example":"Shopify.shop = \'alpha.myshopify.com\'"}</script>','<script src="https://cdn.shopify.com.evil.example/shopifycloud/theme.js"></script>','<img src="https://cdn.shopify.com/s/files/1/123/article-photo.jpg">']){const proof=detectPlatform(html,'https://generic.example');assert.equal(proof.status,'unknown');assert.equal(proof.name,null);assert.deepEqual(proof.evidence,[]);}
 assert.equal(platformMatchesRequirements({requirements:[requirement]},{name:null,status:'unknown'}),false);assert.equal(platformMatchesRequirements({requirements:[]},{name:null,status:'unknown'}),true);
});
test('publicPage preserves its text API and inspects raw HTML with final redirected URL',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async url=>{const u=String(url);if(u.startsWith('https://cloudflare-dns.com/'))return Response.json({Answer:[{type:1,data:'93.184.216.34'}]});if(u==='https://alpha.example/')return new Response(null,{status:302,headers:{location:'https://www.alpha.example/shop'}});return new Response(store(),{headers:{'content-type':'text/html'}});};
 try{const text=await publicPage('https://alpha.example/');assert.equal(typeof text,'string');assert.match(text,/weekend pottery workshops/);assert.doesNotMatch(text,/Shopify\.shop/);const page=await publicPage('https://alpha.example/',{details:true});assert.equal(page.url,'https://www.alpha.example/shop');assert.equal(page.platform.url,page.url);assert.equal(page.platform.status,'verified');assert.equal(page.text,text);}finally{globalThis.fetch=original;}
});
test('publicPage still rejects private DNS before inspecting any HTML',async()=>{
 const original=globalThis.fetch;let pageReads=0;globalThis.fetch=async url=>{if(String(url).startsWith('https://cloudflare-dns.com/'))return Response.json({Answer:[{type:1,data:'127.0.0.1'}]});pageReads++;return new Response(store());};try{await assert.rejects(()=>publicPage('https://alpha.example',{details:true}),/not a public website/);assert.equal(pageReads,0);}finally{globalThis.fetch=original;}
});
test('an explicit Shopify app description becomes a mandatory prospect prerequisite',async()=>{
 const original=globalThis.fetch,env={DB:database(),OPENAI_API_KEY:'test'},description='We sell a Shopify booking app for workshops.';let payload;
 globalThis.fetch=async(_url,options)=>{if(options?.method==='POST'){payload=JSON.parse(options.body);return Response.json({id:'next_response',status:'in_progress'});}return provider({profile:{offer:'Shopify booking app',languageCode:'en',languageEvidence:{sourceUrl:null,quote:description},requirements:[]}});};
 try{const job=await(await api(req('/api/search',{mode:'description',offering:description}),env)).json();await env.DB.prepare("UPDATE searches SET response_id='resp_fixture' WHERE id=?").bind(job.id).run();const result=await advance(env,job);assert.equal(result.stage,1);assert.equal(result.data.understanding.profile.requirements[0].name,'Shopify');assert.equal(result.data.understanding.profile.requirements[0].evidence.url,null);assert.deepEqual(result.data.qualification.requiredPlatforms,['Shopify']);await env.DB.prepare('UPDATE searches SET stage=3,response_id=NULL WHERE id=?').bind(job.id).run();await advance(env,job);assert.match(payload.input,/Every prospect must already use Shopify/);assert.match(payload.input,/All customer segments, priority lists and individual discoveries must satisfy this requirement/);}finally{globalThis.fetch=original;}
});
test('using Shopify as a seller or optional integration creates no mandatory buyer constraint',async()=>{
 const original=globalThis.fetch;
 try{for(const offer of ['Our shop uses Shopify to sell handmade ceramics.','Scheduling software with optional Shopify and WooCommerce integrations.','Shopify app development services from an independent agency.']){const env={DB:database(),OPENAI_API_KEY:'test'};globalThis.fetch=async()=>provider({profile:{offer,languageCode:'en',requirements:[]}});const job=await(await api(req('/api/search',{mode:'description',offering:offer}),env)).json();await env.DB.prepare("UPDATE searches SET response_id='resp_fixture' WHERE id=?").bind(job.id).run();const result=await advance(env,job);assert.equal(result.stage,1);assert.deepEqual(result.data.understanding.profile.requirements,[]);}}finally{globalThis.fetch=original;}
});
test('an invented requirement quote cannot silently establish Shopify eligibility rules',async()=>{
 const original=globalThis.fetch,env={DB:database(),OPENAI_API_KEY:'test'};globalThis.fetch=async url=>{if(String(url).startsWith('https://api.openai.com/'))return provider({profile:{offer:'Shopify booking app',requirements:[{...requirement,evidence:{url:'https://product.example',quote:'Our Shopify booking app requires an existing store.'}}]}});return pageMock({'product.example':'<p>We build simple websites for small businesses.</p>'})(url);};
 try{const job=await jobAt(env,0,{});await env.DB.prepare("UPDATE searches SET response_id='resp_fixture' WHERE id=?").bind(job.id).run();const result=await advance(env,job);assert.equal(result.stage,0);assert.equal(result.status,'working');assert.equal(result.data.repairs[0],1);assert.match(result.data.repairNote,/platform requirement could not be verified/);assert.equal(result.data.understanding,undefined);}finally{globalThis.fetch=original;}
});
test('required Shopify candidates without verified HTML are rejected and discovery restarts',async()=>{
 const original=globalThis.fetch;
 try{for(const rejectedPage of ['<p>Book our treatments online.</p>',null]){const env={DB:database(),OPENAI_API_KEY:'test'};globalThis.fetch=pageMock({'alpha.example':store(),'bravo.example':rejectedPage});const result=await advance(env,await jobAt(env,5,{understanding:{profile},discovery:{leads:leads()}}));assert.equal(result.stage,4);assert.equal(result.status,'working');assert.deepEqual(result.data.rejectedDomains,['https://bravo.example']);assert.equal(result.data.rejectedProspects[0].platform.status,rejectedPage===null?'unavailable':'unknown');assert.equal(result.data.verified,undefined);assert.notEqual(result.data.qualification.status,'verified');}}finally{globalThis.fetch=original;}
});
test('three current Shopify storefront proofs qualify candidates before drafting',async()=>{
 const original=globalThis.fetch,env={DB:database(),OPENAI_API_KEY:'test'};globalThis.fetch=pageMock(Object.fromEntries(['alpha','bravo','charlie'].map(name=>[name+'.example',store(name)])));
 try{const result=await advance(env,await jobAt(env,5,{understanding:{profile},discovery:{leads:leads()}}));assert.equal(result.stage,6);assert.equal(result.data.qualification.status,'verified');assert.deepEqual(result.data.qualification.requiredPlatforms,['Shopify']);for(const lead of result.data.verified){assert.equal(lead.platform.name,'Shopify');assert.equal(lead.platform.status,'verified');assert.equal(lead.websiteCheck.status,'checked');assert.equal(lead.platform.url,lead.websiteCheck.url);assert.ok(lead.platform.checkedAt);assert.equal(lead.sourceText,undefined);}}finally{globalThis.fetch=original;}
});
test('generic businesses keep unknown platform status without an unsupported negative claim',async()=>{
 const original=globalThis.fetch,env={DB:database(),OPENAI_API_KEY:'test'};globalThis.fetch=pageMock(Object.fromEntries(['alpha','bravo','charlie'].map(name=>[name+'.example','<p>We are opening a new workshop this autumn.</p>'])));
 try{const result=await advance(env,await jobAt(env,5,{understanding:{profile:{offer:'Website design',requirements:[]}},discovery:{leads:leads()}}));assert.equal(result.stage,6);assert.equal(result.data.qualification.status,'verified');for(const lead of result.data.verified){assert.equal(lead.platform.status,'unknown');assert.equal(lead.platform.name,null);assert.deepEqual(lead.platform.evidence,[]);}}finally{globalThis.fetch=original;}
});
test('legacy results are withheld and requalification restarts without paid calls',async()=>{
 const original=globalThis.fetch,env={DB:database(),OPENAI_API_KEY:'test'};let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Unexpected provider call');};
 try{const job=await jobAt(env,8,{});await env.DB.prepare("UPDATE searches SET status='complete',data=? WHERE id=?").bind(JSON.stringify({understanding:{profile},leads:leads(),verified:leads(),discovery:{leads:leads()},contacts:{0:{status:'found',email:'old@alpha.example'}}}),job.id).run();const get=await(await api(new Request('https://clientflock.test/api/search/'+job.id),env)).json();assert.equal(get.data.qualification.status,'requalification-required');assert.equal(get.data.leads,undefined);assert.equal(get.data.verified,undefined);assert.equal(get.data.discovery.leads,undefined);assert.equal((await api(req('/api/search/'+job.id+'/contacts',{leadIndex:0}),env)).status,409);const resumed=await(await api(req('/api/search/'+job.id+'/requalify'),env)).json();assert.equal(resumed.id,job.id);assert.equal(resumed.stage,0);assert.equal(resumed.status,'working');assert.equal(resumed.data.qualification.version,1);assert.equal(resumed.data.contacts,undefined);assert.equal(calls,0);}finally{globalThis.fetch=original;}
});
test('v2 domain cache is not returned for a new platform-qualified search',async()=>{
 const env={DB:database(),OPENAI_API_KEY:'test'},input=normalizeInput({website:'cached.example'}),key=createHash('sha256').update('v2-site-language:'+JSON.stringify(input)).digest('hex'),id=crypto.randomUUID(),now=Date.now();
 await env.DB.prepare("INSERT INTO searches(id,cache_key,input,created_at,updated_at,expires_at,status,stage,data) VALUES(?,?,?,?,?,?,'complete',8,?)").bind(id,key,JSON.stringify(input),now,now,now+86400000,JSON.stringify({leads:leads()})).run();const result=await(await api(req('/api/search',{website:'cached.example'}),env)).json();assert.notEqual(result.id,id);assert.equal(result.data.qualification.version,1);assert.equal(result.cached,false);
});

test('explicit localized app dependencies are recognized without relying on country',()=>{for(const offer of ['Application de réservation pour Shopify','Aplicativo de reservas para Shopify','Shopify booking app'])assert.ok(shopifyDependency(offer));assert.equal(shopifyDependency('Notre boutique utilise Shopify pour vendre des plantes.'),null);});

test('a generic model offer cannot discard an explicit Shopify app dependency on the product site',async()=>{
 const original=globalThis.fetch,env={DB:database(),OPENAI_API_KEY:'test'};globalThis.fetch=async url=>{if(String(url).startsWith('https://api.openai.com/'))return provider({profile:{offer:'Appointment booking software',languageCode:'en',requirements:[]}});return pageMock({'product.example':'<h1>The Shopify booking app for appointments and workshops.</h1>'})(url);};
 try{const job=await jobAt(env,0,{});await env.DB.prepare("UPDATE searches SET response_id='resp_fixture' WHERE id=?").bind(job.id).run();const result=await advance(env,job);assert.equal(result.stage,1);assert.deepEqual(result.data.qualification.requiredPlatforms,['Shopify']);assert.match(result.data.understanding.profile.requirements[0].evidence.quote,/Shopify booking app/);}finally{globalThis.fetch=original;}
});

async function legacyCachedJob(env,input,version='v2-site-language'){
 const normalized=input.mode==='description'?normalizeInput(input):normalizeInput({website:input.website}),id=crypto.randomUUID(),now=Date.now(),key=createHash('sha256').update(version+':'+JSON.stringify(normalized)+(normalized.mode==='description'?':'+id:'')).digest('hex');
 await env.DB.prepare("INSERT INTO searches(id,cache_key,input,created_at,updated_at,expires_at,status,stage,data,attempts) VALUES(?,?,?,?,?,?,'complete',8,?,12)").bind(id,key,JSON.stringify(normalized),now,now,now+86400000,JSON.stringify({leads:leads()})).run();return {id,key,input:normalized};
}
const todayJobBudget=env=>env.DB.prepare('SELECT count FROM budgets WHERE key=?').bind('jobs:'+new Date().toISOString().slice(0,10)).first();
test('requalifying a legacy website promotes its cache key and resubmission joins the same job',async()=>{
 const env={DB:database(),OPENAI_API_KEY:'test'},old=await legacyCachedJob(env,{website:'cache-migration.example'});
 const restarted=await(await api(req('/api/search/'+old.id+'/requalify'),env)).json();assert.equal(restarted.id,old.id);assert.equal(restarted.stage,0);
 const repeated=await(await api(req('/api/search',{website:'https://www.cache-migration.example/offer'}),env)).json();assert.equal(repeated.id,old.id);assert.equal(repeated.joined,true);assert.equal((await todayJobBudget(env)).count,1);
 const row=await env.DB.prepare('SELECT * FROM searches WHERE id=?').bind(old.id).first();assert.notEqual(row.cache_key,old.key);assert.equal(row.cache_key,createHash('sha256').update('v3-platform-fit:'+JSON.stringify(old.input)).digest('hex'));
});
test('legacy requalification reuses an existing live v3 job without consuming another start budget',async()=>{
 const env={DB:database(),OPENAI_API_KEY:'test'},old=await legacyCachedJob(env,{website:'already-running.example'}),current=await(await api(req('/api/search',{website:'already-running.example'}),env)).json();
 const joined=await(await api(req('/api/search/'+old.id+'/requalify'),env)).json();assert.equal(joined.id,current.id);assert.notEqual(joined.id,old.id);assert.equal(joined.joined,true);assert.equal((await todayJobBudget(env)).count,1);
 const untouched=await env.DB.prepare('SELECT * FROM searches WHERE id=?').bind(old.id).first();assert.equal(untouched.cache_key,old.key);assert.equal(untouched.attempts,12);
});
test('concurrent legacy migrations reserve one canonical key and one start budget',async()=>{
 const env={DB:database(),OPENAI_API_KEY:'test'},first=await legacyCachedJob(env,{website:'racing.example'},'v1'),second=await legacyCachedJob(env,{website:'racing.example'});
 const results=await Promise.all([first,second].map(job=>api(req('/api/search/'+job.id+'/requalify'),env)));assert.equal(results.filter(r=>r.status===202).length,1);assert.ok(results.every(r=>[200,202,409].includes(r.status)));
 const canonical=await(await api(req('/api/search',{website:'racing.example'}),env)).json();assert.ok([first.id,second.id].includes(canonical.id));assert.equal(canonical.stage,0);assert.equal((await todayJobBudget(env)).count,1);
});
test('requalification preserves active leases and rolls back a denied budget reservation',async()=>{
 const env={DB:database(),OPENAI_API_KEY:'test',DAILY_SEARCH_LIMIT:1},old=await legacyCachedJob(env,{website:'guarded.example'});
 await env.DB.prepare("UPDATE searches SET status='working',lease='active',lease_until=? WHERE id=?").bind(Date.now()+90000,old.id).run();assert.equal((await api(req('/api/search/'+old.id+'/requalify'),env)).status,409);assert.equal(await todayJobBudget(env),undefined);
 await env.DB.prepare("UPDATE searches SET status='complete',lease=NULL,lease_until=0 WHERE id=?").bind(old.id).run();await env.DB.prepare('INSERT INTO budgets(key,count) VALUES(?,1)').bind('jobs:'+new Date().toISOString().slice(0,10)).run();
 const denied=await api(req('/api/search/'+old.id+'/requalify'),env);assert.equal(denied.status,400);assert.match((await denied.json()).error,/limit has been reached/);
 const restored=await env.DB.prepare('SELECT * FROM searches WHERE id=?').bind(old.id).first();assert.equal(restored.cache_key,old.key);assert.equal(restored.lease,null);assert.equal(restored.attempts,12);assert.equal(restored.status,'complete');assert.equal(JSON.parse(restored.data).qualification,undefined);
});
test('requalifying a description retains its private key and never shares a later identical description',async()=>{
 const env={DB:database(),OPENAI_API_KEY:'test'},input={mode:'description',offering:'We build websites for independent hotels.'},old=await legacyCachedJob(env,input);
 const restarted=await(await api(req('/api/search/'+old.id+'/requalify'),env)).json();assert.equal(restarted.id,old.id);assert.equal((await env.DB.prepare('SELECT cache_key FROM searches WHERE id=?').bind(old.id).first()).cache_key,old.key);
 const separate=await(await api(req('/api/search',input),env)).json();assert.notEqual(separate.id,old.id);
});
