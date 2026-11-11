/* Offline-Cache: enthält ausschließlich die App-Dateien, niemals Dokumente.
   Bei Änderungen VERSION erhöhen. */
const VERSION = "nf-ablage-v8";
const FILES = [
  "./", "index.html", "app.css", "js/app.js", "js/crypto.js", "js/db.js", "js/sync.js", "js/config.js", "manifest.webmanifest",
  "assets/fonts/Inter-Regular.ttf", "assets/fonts/Inter-Medium.ttf",
  "assets/fonts/Playfair-Regular.ttf", "assets/fonts/Playfair-Medium.ttf",
  "assets/img/NF_Monogramm_champagner.svg", "assets/img/NF_Wortbildmarke_quer_gruen.svg",
  "assets/icons/icon.svg", "assets/icons/icon-192.png", "assets/icons/favicon-32.png", "assets/icons/apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
/* Netz zuerst (damit Sicherheitsupdates sofort ankommen), offline aus dem Cache. */
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(res => {
    if (res.ok && res.type === "basic") {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
    }
    return res;
  }).catch(async () => (await caches.match(e.request, { ignoreSearch: true })) || caches.match("index.html")));
});
