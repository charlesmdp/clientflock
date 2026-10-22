import {api} from '../server/research.mjs';
import centered from '../content/index.html';
import split from '../content/split.html';
export default {async fetch(request,env){const result=await api(request,env);if(result)return result;const path=new URL(request.url).pathname;if(path==='/'||path==='/index.html'||path==='/split.html')return new Response(path==='/split.html'?split:centered,{headers:{'Content-Type':'text/html; charset=utf-8'}});return env.ASSETS.fetch(request);}};
