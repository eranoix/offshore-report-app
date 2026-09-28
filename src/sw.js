import { cleanupOutdatedCaches, PrecacheController, PrecacheRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

const precache = new PrecacheController();
precache.addToCacheList(self.__WB_MANIFEST);
registerRoute(new PrecacheRoute(precache));
cleanupOutdatedCaches();

const stock = (event) => precache.install(event);
async function short() {
  const cache = await caches.open(precache.strategy.cacheName);
  const have = new Set((await cache.keys()).map((r) => r.url));
  return [...precache.getURLsToCacheKeys().values()].some((key) => !have.has(key));
}

self.addEventListener("install", (event) => event.waitUntil(stock(event).catch(() => {})));
self.addEventListener("activate", (event) => event.waitUntil(precache.activate(event)));

const held = precache.createHandlerBoundToURL("index.html");
const PAGES = "pages";
const PATIENCE = 4000;

registerRoute(
  new NavigationRoute(
    async ({ request, event }) => {
      try {
        const got = await Promise.race([
          fetch(request),
          new Promise((none, slow) => setTimeout(() => slow(new Error("slow")), PATIENCE)),
        ]);
        if (got.type === "opaqueredirect" || !got.ok) return got;
        event.waitUntil((async () => {
          await (await caches.open(PAGES)).put(request, got.clone());
          if (await short()) await stock(event).catch(() => {});
        })());
        return got;
      } catch {
        return (await caches.match(request, { cacheName: PAGES })) || held({ request, event });
      }
    },
    {
      denylist: [/^\/api\//, /^\/login/],
    },
  ),
);

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
