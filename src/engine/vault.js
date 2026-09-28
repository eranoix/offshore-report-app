const OWNER = "offshore-report:owner";

const MINE = ["trip-feedback:doc", "trip-feedback:work", "trip-feedback:profile", "caap:state", "offshore-report:phrases",
  "rotation:plan", "rotation:certs"];

let who = "";

export const owner = () => who;

export const keyFor = (base) => (who ? `${base}@${who}` : "");

function wipe() {
  try {
    const drop = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (MINE.includes(key) || MINE.some((base) => key.startsWith(`${base}@`))) drop.push(key);
    }
    drop.forEach((key) => localStorage.removeItem(key));
  } catch {
    /* no storage: nothing to clear */
  }
}

export function claim(id) {
  const next = String(id || "");
  let last = "";
  try {
    last = localStorage.getItem(OWNER) || "";
  } catch {
    last = "";
  }
  if (last !== next) {
    wipe();
    try {
      localStorage.setItem(OWNER, next);
    } catch {
      /* no storage */
    }
  }
  who = next;
  return who;
}

export function release() {
  wipe();
  try {
    localStorage.removeItem(OWNER);
  } catch {
    /* no storage */
  }
  try {
    sessionStorage.clear();
  } catch {
    /* no storage */
  }
  try {
    if (typeof caches !== "undefined" && caches.keys) {
      caches.keys().then((names) =>
        names.forEach((name) =>
          caches.open(name).then((box) =>
            box.keys().then((reqs) =>
              reqs.forEach((req) => {
                if (/\/api\/|\/caap|\/trip-feedback|\/library|\/account/.test(req.url)) box.delete(req);
              }),
            ),
          ),
        ),
      );
    }
  } catch {
    /* no cache storage: nothing held */
  }
  who = "";
}

const SETTINGS = ["offshore-report:sidebar", "caap:zoom"];

export function readSetting(key, fallback = "") {
  if (!SETTINGS.includes(key)) throw new Error(`${key} is not a setting — use readMine`);
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeSetting(key, value) {
  if (!SETTINGS.includes(key)) throw new Error(`${key} is not a setting — use writeMine`);
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* no storage: it still holds for this visit */
  }
}

export function readMine(base, fallback) {
  const key = keyFor(base);
  if (!key) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeMine(base, value) {
  const key = keyFor(base);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* no storage: it still works for this session */
  }
}
