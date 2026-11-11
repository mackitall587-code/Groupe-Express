const V='18.7.0',CACHE='gx-v'+V;
const SHELL=['/','/styles.css?v='+V,'/splash.css?v='+V,'/splash.js','/app.js?v='+V,'/manifest.webmanifest','/offline.html','/assets/groupe-express-logo-mark.png','/icons/icon-192.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x.startsWith('gx-v')&&x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/'))return;
  if(r.mode==='navigate'){e.respondWith(fetch(r).then(x=>{caches.open(CACHE).then(c=>c.put('/',x.clone()));return x}).catch(async()=>(await caches.match('/'))||caches.match('/offline.html')));return}
  e.respondWith(caches.match(r).then(c=>c||fetch(r).then(x=>{if(x.ok&&/\.(png|jpg|svg|css|js)$/.test(u.pathname)){const y=x.clone();caches.open(CACHE).then(k=>k.put(r,y))}return x})));
});

self.addEventListener('push',event=>{let data={title:'GROUPE EXPRESS',body:'Une nouveauté est disponible.',url:'/#/'};try{data={...data,...event.data.json()}}catch{}event.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:'/icons/icon-192.png',badge:'/icons/icon-192.png',image:data.image||undefined,tag:data.tag||'groupe-express',data:{url:data.url||'/#/'}}));});
self.addEventListener('notificationclick',event=>{event.notification.close();const url=event.notification.data?.url||'/#/';event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const c of list){if('focus'in c){c.navigate(url);return c.focus()}}return clients.openWindow(url)}));});
