const CACHE_NAME="academy-world-3.0.0";
const CORE=[
  "./","./index.html","./styles.css","./app.js","./bundled-course.js",
  "./manifest.webmanifest","./offline.html","./version.json",
  "./icons/icon-192.png","./icons/icon-512.png",
  "./courses/SOLIDWORKS_DESIGN_LAB_2025.json"
];
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  if(url.origin!==location.origin)return;
  event.respondWith(
    fetch(event.request).then(r=>{
      if(r.ok){const copy=r.clone();caches.open(CACHE_NAME).then(c=>c.put(event.request,copy)).catch(()=>{});}
      return r;
    }).catch(async()=>{
      const hit=await caches.match(event.request);
      if(hit)return hit;
      if(event.request.mode==="navigate")return caches.match("./offline.html");
      return new Response("Recurso no disponible sin conexión.",{status:503,headers:{"Content-Type":"text/plain; charset=utf-8"}});
    })
  );
});
self.addEventListener("message",event=>{if(event.data?.type==="SKIP_WAITING")self.skipWaiting();});
