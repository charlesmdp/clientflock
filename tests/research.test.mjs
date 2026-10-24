import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {api,normalizeInput,validateEmail,wordCount} from '../server/research.mjs';
function db(){const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_overrated_lady_deathstrike.sql',import.meta.url),'utf8'));return {prepare(q){return {bind(...v){return {first:async()=>sql.prepare(q).get(...v),run:async()=>sql.prepare(q).run(...v)}}}}}}
const req=(path,body)=>new Request('https://clientflock.test'+path,{method:'POST',headers:{origin:'https://clientflock.test','content-type':'application/json'},body:JSON.stringify(body)});
test('equivalent domain URLs canonicalize, unsafe inputs rejected',()=>{for(const website of ['reddit.com','https://www.reddit.com/a?b=1','http://reddit.com'])assert.equal(normalizeInput({website}).value,'https://reddit.com');for(const website of ['http://127.0.0.1','https://user:pass@reddit.com','https://reddit.com:81','https://foo.internal','file:///etc/passwd'])assert.throws(()=>normalizeInput({website}));});
test('same public domain joins the same persisted search',async()=>{const env={DB:db(),OPENAI_API_KEY:'test'};const a=await(await api(req('/api/search',{website:'reddit.com'}),env)).json();const b=await(await api(req('/api/search',{website:'https://www.reddit.com/x'}),env)).json();assert.equal(a.id,b.id);assert.equal(b.joined,true);});
test('completed cache returned without provider calls',async()=>{const env={DB:db(),OPENAI_API_KEY:'test'};const a=await(await api(req('/api/search',{website:'reddit.com'}),env)).json();await env.DB.prepare("UPDATE searches SET status='complete', stage=7 WHERE id=?").bind(a.id).run();const b=await(await api(req('/api/search',{website:'reddit.com'}),env)).json();assert.equal(b.cached,true);assert.equal(a.id,b.id);});
test('descriptions do not enter the shared cache',async()=>{const env={DB:db(),OPENAI_API_KEY:'test'};const input={mode:'description',offering:'We design hotel websites in France'};const a=await(await api(req('/api/search',input),env)).json(),b=await(await api(req('/api/search',input),env)).json();assert.notEqual(a.id,b.id);});
test('cross-origin starts fail and missing setup is explicit',async()=>{const env={DB:db(),OPENAI_API_KEY:'test'};const r=new Request('https://clientflock.test/api/search',{method:'POST',headers:{origin:'https://evil.test','content-type':'application/json'},body:'{}'});assert.equal((await api(r,env)).status,403);assert.equal((await api(req('/api/search',{}),{})).status,503);});
test('email contract rejects forbidden subjects and closings',()=>{validateEmail({subject:'your new studio',email:'You opened a studio yesterday. Would a quick chat help?'});assert.throws(()=>validateEmail({subject:'Hello there',email:'Hi?'}));assert.throws(()=>validateEmail({subject:'hello',email:'Let me know.'}));});
test('concurrent advances launch one provider job and web search avoids JSON mode',async()=>{
 const original=globalThis.fetch,env={DB:db(),OPENAI_API_KEY:'test'};let calls=0,payload;
 globalThis.fetch=async(_url,options)=>{calls++;payload=JSON.parse(options.body);return Response.json({id:'resp_test',status:'in_progress'})};
 try{const job=await(await api(req('/api/search',{website:'calendly.com'}),env)).json();await Promise.all([api(req('/api/search/'+job.id+'/advance',{}),env),api(req('/api/search/'+job.id+'/advance',{}),env)]);assert.equal(calls,1);assert.equal(payload.tool_choice,'required');assert.equal(payload.text,undefined);assert.equal(payload.background,true);
 globalThis.fetch=async()=>Response.json({status:'completed',output:[{type:'web_search_call',action:{sources:[{url:'https://calendly.com',title:'Calendly'}]}},{type:'message',content:[{type:'output_text',text:JSON.stringify({profile:{name:'Calendly',offer:'Scheduling software'},sources:[]})}]}]});
 const result=await(await api(req('/api/search/'+job.id+'/advance',{}),env)).json();assert.equal(result.stage,1);assert.equal(result.data.understanding.citations[0].url,'https://calendly.com');
 }finally{globalThis.fetch=original}
});
test('retry preserves rejected-company evidence and restarts discovery',async()=>{const env={DB:db(),OPENAI_API_KEY:'test'};const a=await(await api(req('/api/search',{website:'calendly.com'}),env)).json();const data={discovery:{leads:[{name:'Blocked Firm',website:'https://blocked.example'}]}};await env.DB.prepare("UPDATE searches SET stage=5,status='failed',error=?,data=? WHERE id=?").bind('Source could not be checked for Blocked Firm.',JSON.stringify(data),a.id).run();const resumed=await(await api(req('/api/search/'+a.id+'/retry',{}),env)).json();assert.equal(resumed.stage,4);assert.equal(resumed.status,'working');assert.deepEqual(resumed.data.rejectedDomains,['https://blocked.example']);assert.match(resumed.data.repairNote,/Blocked Firm/);});

const providerResult=output=>Response.json({status:'completed',output:[{type:'web_search_call',action:{sources:[{url:'https://example.com',title:'A checked research source'}]}},{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}]});
async function waitingJob(env,input,stage=0,data={}){
 const job=await(await api(req('/api/search',input),env)).json();
 await env.DB.prepare("UPDATE searches SET stage=?,data=?,response_id='resp_fixture' WHERE id=?").bind(stage,JSON.stringify(data),job.id).run();return job;
}
const advanceJob=async(env,job)=>(await api(req('/api/search/'+job.id+'/advance',{}),env)).json();
const enProfile={understanding:{profile:{name:'Example',offer:'Booking software for French hotels',audience:'Hotels in France',language:'English',languageCode:'en'}}};
const outlines=[['Vision','Target audience','Value proposition','90-day goals'],['Market size','Main competitors','Opportunities','Risks'],['Your ideal customer','Priority lists to build','Where to start','How to win your first customers']];
function documentOutput(stage,{code='en',headings=outlines[stage-1]}={}){
 const target=[250,300,600][stage-1],headerWords=headings.reduce((n,h)=>n+h.split(/\s+/).length+1,0),paragraphs=headings.map(h=>'## '+h);
 let remaining=target-headerWords;
 const document=paragraphs.map((h,i)=>{const count=Math.floor(remaining/(4-i));remaining-=count;return h+'\n\n'+Array.from({length:count},(_,j)=>['Customers','need','clear','booking','information','and','simple','online','tools'][j%9]).join(' ');}).join('\n\n');
 return {languageCode:code,document,presentation:{title:['Your mission','Your market','Your best-fit customers'][stage-1],subtitle:'A clear view of the booking problem and who experiences it.',highlights:[{label:'Offer',text:'A booking tool for independent hotels.'},{label:'Buyer',text:'Owners who manage guest bookings themselves.'},{label:'Starting point',text:'Hotels introducing a new bookable experience.'}]},...(stage===3?{priorityList:'Independent hotels introducing new bookable experiences.'}:{}),sources:[]};
}
test('an English business website stays English despite a French domain and market',async()=>{
 const original=globalThis.fetch,env={DB:db(),OPENAI_API_KEY:'test'},quote='We help independent hotels manage bookings and welcome their guests.';let payload,pageReads=0;
 globalThis.fetch=async(url,options)=>{
  const u=String(url);if(u.startsWith('https://cloudflare-dns.com/'))return Response.json({Answer:[{type:1,data:'93.184.216.34'}]});
  if(u==='https://bookingexample.fr/'){pageReads++;return new Response('<html lang="en"><h1>'+quote+'</h1><p>Our customers work throughout France.</p></html>',{headers:{'content-type':'text/html'}});}
  if(options?.method==='POST'){payload=JSON.parse(options.body);return Response.json({id:'resp_mission',status:'in_progress'});}
  return providerResult({profile:{name:'Example',offer:'Booking tools for hotels',audience:'Hotels in France',language:'English',languageCode:'en',languageEvidence:{sourceUrl:'https://bookingexample.fr/',quote}},sources:[]});
 };
 try{
  const job=await waitingJob(env,{website:'bookingexample.fr'}),result=await advanceJob(env,job);
  assert.equal(result.stage,1);assert.equal(result.data.understanding.profile.languageCode,'en');assert.equal(result.data.understanding.profile.languageDetection,'verified-content');assert.equal(pageReads,1);
  await advanceJob(env,job);assert.match(payload.input,/Resolved report language: English \(en\)/);assert.match(payload.input,/## Target audience/);assert.doesNotMatch(payload.input,/Headings exactly:.*Public cible/);assert.match(payload.input,/presentation metadata is separate/i);assert.doesNotMatch(payload.instructions,/Write in the language of the business's market/);
 }finally{globalThis.fetch=original;}
});
test('a description controls report language independently of the target country',async()=>{
 const original=globalThis.fetch,env={DB:db(),OPENAI_API_KEY:'test'},description='Nous créons des sites internet pour les hôtels indépendants aux États-Unis.';let payload;
 globalThis.fetch=async(_url,options)=>{if(options?.method==='POST'){payload=JSON.parse(options.body);return Response.json({id:'resp_fr',status:'in_progress'});}return providerResult({profile:{name:'Studio',offer:'Création de sites internet',audience:'Hôtels aux États-Unis',language:'French',languageCode:'fr',languageEvidence:{sourceUrl:null,quote:description}},sources:[]});};
 try{const job=await waitingJob(env,{mode:'description',offering:description}),result=await advanceJob(env,job);assert.equal(result.data.understanding.profile.languageCode,'fr');assert.equal(result.data.understanding.profile.languageEvidence.sourceUrl,null);await advanceJob(env,job);assert.match(payload.input,/Resolved report language: French \(fr\)/);assert.match(payload.input,/## Public cible/);assert.match(payload.input,/## Objectifs à 90 jours/);}finally{globalThis.fetch=original;}
});
test('missing, unrelated and uncheckable language evidence fall back to English',async()=>{
 const original=globalThis.fetch;
 try{for(const evidence of [null,{sourceUrl:'https://thirdparty.example/',quote:'Nous aidons les entreprises à trouver de nouveaux clients.'},{sourceUrl:'https://languageexample.fr/',quote:'Nous aidons les entreprises à trouver de nouveaux clients.'}]){
  const env={DB:db(),OPENAI_API_KEY:'test'};let thirdPartyReads=0;
  globalThis.fetch=async(url)=>{const u=String(url);if(u.startsWith('https://api.openai.com/'))return providerResult({profile:{name:'Example',offer:'A business service',language:'French',languageCode:'fr',languageEvidence:evidence}});if(u.startsWith('https://thirdparty.example/'))thirdPartyReads++;return Response.json({Answer:[]});};
  const result=await advanceJob(env,await waitingJob(env,{website:'languageexample.fr'}));assert.equal(result.stage,1);assert.equal(result.data.understanding.profile.languageCode,'en');assert.equal(result.data.understanding.profile.languageEvidence,null);assert.equal(result.data.understanding.profile.languageDetection,'english-fallback');assert.equal(thirdPartyReads,0);
 }}finally{globalThis.fetch=original;}
});
test('a fabricated language quote is not accepted even on a first-party page',async()=>{
 const original=globalThis.fetch,env={DB:db(),OPENAI_API_KEY:'test'};
 globalThis.fetch=async(url)=>{const u=String(url);if(u.startsWith('https://api.openai.com/'))return providerResult({profile:{name:'Example',offer:'Business services',languageCode:'fr',languageEvidence:{sourceUrl:'https://languageexample.fr/',quote:'Ce passage inventé ne figure pas sur la page.'}}});if(u.startsWith('https://cloudflare-dns.com/'))return Response.json({Answer:[{type:1,data:'93.184.216.34'}]});return new Response('<h1>Practical tools for independent businesses.</h1>',{headers:{'content-type':'text/html'}});};
 try{const result=await advanceJob(env,await waitingJob(env,{website:'languageexample.fr'}));assert.equal(result.data.understanding.profile.languageCode,'en');assert.equal(result.data.understanding.profile.languageDetection,'english-fallback');}finally{globalThis.fetch=original;}
});
test('all three documents retain full Markdown and structured presentation metadata',async()=>{
 const original=globalThis.fetch;
 try{for(const stage of [1,2,3]){const env={DB:db(),OPENAI_API_KEY:'test'},output=documentOutput(stage);globalThis.fetch=async()=>providerResult(output);const result=await advanceJob(env,await waitingJob(env,{website:'documents.example'},stage,enProfile)),saved=result.data[['','mission','market','idealClients'][stage]];assert.equal(result.stage,stage+1);assert.equal(saved.document,output.document);assert.deepEqual(saved.presentation,output.presentation);assert.equal(saved.languageCode,'en');if(stage===3)assert.equal(saved.priorityList,output.priorityList);}}finally{globalThis.fetch=original;}
});
test('French output and French headings are repaired for an English website',async()=>{
 const original=globalThis.fetch;
 try{for(const output of [documentOutput(1,{code:'fr'}),documentOutput(1,{headings:['Vision','Public cible','Promesse de valeur','Objectifs à 90 jours']})]){
  const env={DB:db(),OPENAI_API_KEY:'test'};globalThis.fetch=async()=>providerResult(output);const result=await advanceJob(env,await waitingJob(env,{website:'documents.example'},1,enProfile));assert.equal(result.stage,1);assert.equal(result.status,'working');assert.equal(result.data.repairs[1],1);assert.match(result.data.repairNote,/language did not match en|English headings/);assert.equal(result.data.mission,undefined);
 }}finally{globalThis.fetch=original;}
});
test('incomplete presentation is repaired and never replaces the full document',async()=>{
 const original=globalThis.fetch,env={DB:db(),OPENAI_API_KEY:'test'},output=documentOutput(2);output.presentation.highlights=[{label:'Market',text:'One incomplete summary.'}];globalThis.fetch=async()=>providerResult(output);
 try{const result=await advanceJob(env,await waitingJob(env,{website:'documents.example'},2,enProfile));assert.equal(result.stage,2);assert.equal(result.data.repairs[2],1);assert.match(result.data.repairNote,/presentation did not/);assert.equal(result.data.market,undefined);}finally{globalThis.fetch=original;}
});
test('display snippets cannot silently switch back to market language',async()=>{
 const original=globalThis.fetch,env={DB:db(),OPENAI_API_KEY:'test'};let payload;globalThis.fetch=async(_url,options)=>{if(options?.method==='POST'){payload=JSON.parse(options.body);return Response.json({id:'resp_discovery',status:'in_progress'});}return providerResult({languageCode:'fr',leads:[]});};
 try{const job=await waitingJob(env,{website:'documents.example'},4,enProfile),result=await advanceJob(env,job);assert.equal(result.stage,4);assert.equal(result.data.repairs[4],1);assert.match(result.data.repairNote,/language did not match en/);await advanceJob(env,job);assert.match(payload.input,/roleToContact, whyNow, whatToSell, benefit/);assert.match(payload.input,/Keep proper company\/person names, URLs and exact evidence quotes unchanged/);}finally{globalThis.fetch=original;}
});
test('the old domain cache cannot serve earlier French-hardcoded research',async()=>{
 const env={DB:db(),OPENAI_API_KEY:'test'},input=normalizeInput({website:'cached.example'}),oldKey=createHash('sha256').update('v1:'+JSON.stringify(input)).digest('hex'),oldId=crypto.randomUUID(),now=Date.now();
 await env.DB.prepare("INSERT INTO searches(id,cache_key,input,created_at,updated_at,expires_at,status,stage,data) VALUES(?,?,?,?,?,?, 'complete',8,?)").bind(oldId,oldKey,JSON.stringify(input),now,now,now+86400000,JSON.stringify({mission:{document:'## Public cible\nUn ancien résultat.'}})).run();
 const result=await(await api(req('/api/search',{website:'cached.example'}),env)).json();assert.notEqual(result.id,oldId);assert.equal(result.status,'working');assert.equal(result.cached,false);assert.equal(result.data.mission,undefined);
});
test('normal Chinese prose satisfies document word limits without artificial spaces',async()=>{
 const original=globalThis.fetch,env={DB:db(),OPENAI_API_KEY:'test'},sentence='我们帮助独立酒店管理在线预订，让客人轻松选择房间。',document=['愿景','目标客户','价值主张','九十天目标'].map((h,i)=>'## '+h+'\n\n'+sentence.repeat(i<2?5:4)).join('\n\n');
 const output={languageCode:'zh',document,presentation:{title:'业务使命',subtitle:'帮助独立酒店简化在线预订。',highlights:[{label:'客户',text:'独立酒店的经营者。'},{label:'价值',text:'让客人轻松选择房间。'},{label:'目标',text:'先验证一个清晰的预订流程。'}]},sources:[]};
 assert.ok(wordCount(document)>=200&&wordCount(document)<=300);globalThis.fetch=async()=>providerResult(output);
 try{const result=await advanceJob(env,await waitingJob(env,{website:'documents.example'},1,{understanding:{profile:{offer:'酒店预订软件',languageCode:'zh'}}}));assert.equal(result.stage,2);assert.equal(result.data.mission.document,document);validateEmail({subject:'新的预约页面',email:'你们刚推出了周末课程。可以看看页面草图吗？'});assert.throws(()=>validateEmail({subject:'新的预约页面',email:'一。二。三。四。五。六。七？'}));}finally{globalThis.fetch=original;}
});
test('a Thai description supplies language evidence without spaces between words',async()=>{
 const original=globalThis.fetch,env={DB:db(),OPENAI_API_KEY:'test'},description='เราช่วยโรงแรมขนาดเล็กจัดการการจองออนไลน์';globalThis.fetch=async()=>providerResult({profile:{name:'Example',offer:description,languageCode:'th',languageEvidence:{sourceUrl:null,quote:description}}});
 try{const result=await advanceJob(env,await waitingJob(env,{mode:'description',offering:description}));assert.equal(result.stage,1);assert.equal(result.data.understanding.profile.languageCode,'th');assert.equal(result.data.understanding.profile.languageDetection,'verified-content');}finally{globalThis.fetch=original;}
});
