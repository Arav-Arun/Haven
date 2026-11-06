// Haven's service worker: the app shell offline, and Android's "Share to Haven".
// It never touches cross-origin traffic (RPCs, Bee, our API), and it never sees keys or decrypted files except the
// ones the user shares into the app, which it hands straight to the page through IndexedDB.
const VERSION = "1";
const SHELL = `haven-shell-${VERSION}`;
const ASSETS = `haven-assets-${VERSION}`;
const PAGES = ["/", "/drive/", "/rooms/", "/shared/", "/groups/", "/settings/", "/onboarding/", "/try/", "/l/", "/public/"];
const FILES = ["/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/anon-rpc-iframe.html", "/anon-rpc-iframe.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll([...PAGES, ...FILES]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// ---- Share target: files shared from another app land in IndexedDB, then the drive opens to pick a folder ----

function openInbox() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("haven-inbox", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files", { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function receiveShare(request) {
  const form = await request.formData();
  const files = form.getAll("files").filter((f) => f instanceof File && f.size > 0);
  const db = await openInbox();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    const store = tx.objectStore("files");
    for (const f of files) store.add({ name: f.name, type: f.type, blob: f, at: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return Response.redirect(`/drive/?shared=${files.length}`, 303);
}

// ---- Fetch ----

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.method === "POST" && url.pathname === "/share-target/") {
    event.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== "GET") return;

  // Pages: network first so a new deploy shows at once; the cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && PAGES.includes(url.pathname)) caches.open(SHELL).then((c) => c.put(url.pathname, res.clone()));
          return res;
        })
        .catch(async () => (await caches.match(url.pathname)) ?? (await caches.match("/drive/")) ?? Response.error()),
    );
    return;
  }

  // Built assets have content hashes in their names, so a cached copy is always right.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) caches.open(ASSETS).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
  }
});
