import {api} from '../server/research.mjs';
import {deliverDailyDrafts} from '../server/mailbox.mjs';
import centered from '../content/index.html';
export default {
 async scheduled(controller,env,ctx){ctx.waitUntil(deliverDailyDrafts(env));},
 async fetch(request,env){const result=await api(request,env);if(result)return result;const url=new URL(request.url),path=url.pathname;if(path==='/split.html'){url.pathname='/';return Response.redirect(url.href,308);}if(path==='/'||path==='/index.html')return new Response(centered,{headers:{'Content-Type':'text/html; charset=utf-8'}});return env.ASSETS.fetch(request);}
};
