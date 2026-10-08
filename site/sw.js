// 课程表 Service Worker · 小克版 r17
// 规则：首页“网络优先”（联网时永远拿最新版，断网才用缓存）。
//       JS/CSS 按“完整网址（含 ?v=版本号）”缓存：版本号变了 = 新网址 = 一定去网络拿，不会拿到旧文件。
//       命中缓存时立即返回，同时在后台向服务器核对一次（ETag，没变只回 304）；
//       万一发版忘了改版本号，下一次打开也会自动换成新文件，不再需要手动清缓存。
const V='xk17-20261008';
const PREFIX='schedule-pwa-';
const CACHE=PREFIX+V;
const CORE=['/','/pwa-v4.js?v='+V,'/manifest.webmanifest','/icons/favicon-v3.svg'];
const OPTIONAL=['/showcase-xk2.css?v='+V,'/showcase-xk2.js?v='+V,'/icons/app-192-v3.png','/icons/app-512-v3.png','/icons/app-maskable-v3.png','/icons/apple-touch-v3.png'];
const KNOWN_PATHS=new Set([...CORE,...OPTIONAL].map(p=>p.split('?')[0]));
const BYPASS=new Set(['/sw.js','/calendar.ics','/robots.txt','/cf29f11a3793b97f423e85d8e6c41c11.txt']);
const NAV_TIMEOUT=4000;
// 复习资料（r12）：同学点了“下载离线包”才建这个缓存；没建就全部走网络。
// 按路径存（不带 ?v=），新版本联网时覆盖旧的；断网时用存下来的。
const STUDY_CACHE='schedule-study';
const isStudy=p=>p==='/study'||p==='/study.html'||p==='/study.css'||p==='/study.js'||p.startsWith('/study-data/')||p.startsWith('/study-img/');
const studyKey=url=>url.pathname==='/study.html'?'/study':url.pathname;

// 缓存键 = 路径 + 查询串（同一路径不同版本是不同条目）。
const keyOf=url=>url.pathname+url.search;

// 写入新版本时，删掉同一路径的其他版本，缓存不会越积越多。
async function putVersion(cache,url,res){
  for(const req of await cache.keys()){
    const old=new URL(req.url);
    if(old.pathname===url.pathname&&old.search!==url.search)await cache.delete(req);
  }
  await cache.put(keyOf(url),res);
}

// cache:'reload' = 跳过浏览器 HTTP 缓存，直接向服务器要。
async function putFresh(cache,path){
  const res=await fetch(new Request(path,{cache:'reload'}));
  if(!res.ok)throw new Error(path+' '+res.status);
  await putVersion(cache,new URL(path,self.location.origin),res);
}

self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await Promise.all(CORE.map(p=>putFresh(cache,p)));
  // 首页是网络优先，新 SW 立即接管是安全的，不用等所有页面关掉。
  await self.skipWaiting();
})()));

self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
})()));

let warming=null;
self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
  if(event.data?.type==='STUDY_OFFLINE'){
    const port=event.ports?.[0];
    event.waitUntil((async()=>{
      try{
        const cache=await caches.open(STUDY_CACHE);
        for(const u of event.data.urls||[]){
          const url=new URL(u,self.location.origin);
          if(url.origin!==self.location.origin)continue;
          const res=await fetch(new Request(url.pathname+url.search,{cache:'reload'}));
          if(!res.ok||res.redirected)throw new Error(url.pathname+' '+res.status);
          await cache.put(studyKey(url),res);
        }
        port?.postMessage({ok:true});
      }catch(e){port?.postMessage({ok:false,error:String(e)});}
    })());
  }
  if(event.data?.type==='STUDY_OFFLINE_OFF'){
    const port=event.ports?.[0];
    event.waitUntil(caches.delete(STUDY_CACHE).then(()=>port?.postMessage({ok:true})));
  }
  if(event.data?.type==='WARM_OPTIONAL'){
    if(!warming)warming=(async()=>{
      const cache=await caches.open(CACHE);
      for(const path of OPTIONAL){if(!await cache.match(path)){try{await putFresh(cache,path);}catch(_){}}}
    })().finally(()=>warming=null);
    event.waitUntil(warming);
  }
});

async function shell(network){
  const cache=await caches.open(CACHE);
  // 联网：等网络（最多 4 秒）。超时或断网：用缓存兜底。
  const timeout=new Promise(resolve=>setTimeout(resolve,NAV_TIMEOUT,null));
  try{
    const res=await Promise.race([network,timeout]);
    if(res&&res.ok)return res;
  }catch(_){}
  const hit=await cache.match('/');
  if(hit)return hit;
  try{return await network;}catch(_){}
  return new Response('暂时离线，请联网后再打开一次课程表。',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
}

// 后台核对：向服务器确认这个文件有没有变（没变只回 304，几乎不耗流量）。
async function revalidate(url){
  try{
    const res=await fetch(new Request(keyOf(url),{cache:'no-cache'}));
    if(res.ok)await putVersion(await caches.open(CACHE),url,res);
  }catch(_){}
}

// 复习资料：联网时拿网络（顺便更新离线包），断网或超时用离线包。
async function studyFetch(request,url){
  const has=await caches.has(STUDY_CACHE);
  if(!has)return fetch(request);
  const cache=await caches.open(STUDY_CACHE);
  const network=fetch(request).then(async res=>{
    // 存缓存失败（比如手机空间满了）不影响这次正常显示（r16）
    if(res.ok&&!res.redirected&&res.type==='basic'){try{await cache.put(studyKey(url),res.clone());}catch(_){}}
    return res;
  });
  network.catch(()=>{});
  try{
    const res=await Promise.race([network,new Promise(r=>setTimeout(r,NAV_TIMEOUT,null))]);
    if(res&&res.ok)return res;
  }catch(_){}
  const hit=await cache.match(studyKey(url));
  if(hit)return hit;
  return network;
}

self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||BYPASS.has(url.pathname))return;
  if(isStudy(url.pathname)){event.respondWith(studyFetch(request,url));return;}
  if(request.mode==='navigate'&&(url.pathname==='/'||url.pathname==='/index.html')){
    const network=(async()=>{
      const res=await fetch(request,{cache:'no-store'});
      if(res.ok)await (await caches.open(CACHE)).put('/',res.clone());
      return res;
    })();
    event.waitUntil(network.then(()=>{},()=>{}));
    event.respondWith(shell(network));return;
  }
  if(KNOWN_PATHS.has(url.pathname)){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE),hit=await cache.match(keyOf(url));
      if(hit){event.waitUntil(revalidate(url));return hit;}
      try{
        const res=await fetch(new Request(keyOf(url),{cache:'reload'}));
        if(res.ok)await putVersion(cache,url,res.clone());
        return res;
      }catch(_){
        // 断网且没有这个版本：退而求其次，用同一路径的任意旧版本。
        for(const req of await cache.keys())if(new URL(req.url).pathname===url.pathname)return cache.match(req);
        return Response.error();
      }
    })());
  }
});
