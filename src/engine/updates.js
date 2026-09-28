import { registerSW } from "virtual:pwa-register";

export function watchForUpdates() {
  try {
    registerSW({ immediate: true, onNeedRefresh: () => { loadItNow(); } });
  } catch {
    /* No service worker (a copy run from a folder, or a browser without it): nothing to watch. */
  }
}

export async function loadItNow() {
  const reload = () => window.location.reload();
  if (!("serviceWorker" in navigator)) return reload();
  let reg = null;
  try {
    reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return reload();
    if (!reg.waiting && !reg.installing) {
      await Promise.race([reg.update().catch(() => {}), hold(4000)]);
    }
    const coming = reg.installing;
    if (coming && !reg.waiting) {
      await Promise.race([
        new Promise((done) => coming.addEventListener("statechange", () => {
          if (coming.state !== "installing") done();
        })),
        hold(4000),
      ]);
    }
    const waiting = reg.waiting;
    if (!waiting) return reload();
    navigator.serviceWorker.addEventListener("controllerchange", reload, { once: true });
    waiting.postMessage({ type: "SKIP_WAITING" });
  } catch {
    return reload();
  }
  setTimeout(async () => {
    try { await reg.unregister(); } catch { /* it is going anyway */ }
    reload();
  }, 3000);
  return undefined;
}

const hold = (ms) => new Promise((r) => setTimeout(r, ms));
