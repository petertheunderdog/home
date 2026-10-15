/* 앱 화면 파일을 폰에 저장해 두고 바로 열리게 해요. 가계부 데이터(API)는 저장하지 않아요. */
const CACHE = 'gb-shell-v7';
const SHELL = ['./', 'index.html', 'app.css?v=3', 'app.js?v=7', 'manifest.webmanifest',
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
  // 저장본을 먼저 보여주고, 뒤에서 새 버전을 받아 다음에 쓰게 해요
  e.respondWith(caches.open(CACHE).then((c) => c.match(req, { ignoreSearch: req.mode === 'navigate' }).then((hit) => {
    const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  })));
});
