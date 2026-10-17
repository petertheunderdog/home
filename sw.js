/* 앱 화면 파일을 폰에 저장해 두고 바로 열리게 해요. 가계부 데이터(API)는 저장하지 않아요. */
const CACHE = 'gb-shell-v12';
const SHELL = ['./', 'index.html', 'app.css?v=7', 'app.js?v=12', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon-64.png', 'logo-256.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const url = new URL(req.url);
  const isShell = req.mode === 'navigate' || /\.(js|css|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/');
  if (isShell) {
    // 화면 파일은 인터넷에서 새로 받아오고(최대 4초), 안 되면 저장본을 써요 → 업데이트가 바로 반영돼요
    e.respondWith(caches.open(CACHE).then((c) => {
      const net = fetch(req, { cache: 'no-store' }).then((res) => { if (res.ok) c.put(req, res.clone()); return res; });
      const timeout = new Promise((r) => setTimeout(r, 4000));
      return Promise.race([net, timeout.then(() => c.match(req, { ignoreSearch: req.mode === 'navigate' }))])
        .then((res) => res || net)
        .catch(() => c.match(req, { ignoreSearch: req.mode === 'navigate' }));
    }));
    return;
  }
  // 사진·아이콘은 저장본을 먼저 보여주고 뒤에서 새로 받아요
  e.respondWith(caches.open(CACHE).then((c) => c.match(req).then((hit) => {
    const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  })));
});
