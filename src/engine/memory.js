import { addPhrases, available, getPhrases } from "./cloud";

import { owner, readMine, writeMine } from "./vault";

const KEY = "offshore-report:phrases";
const CAP = 4000;

function load() {
  const list = readMine(KEY, []);
  return Array.isArray(list) ? list : [];
}
function save(list) {
  writeMine(KEY, list.slice(-CAP));
}

let used = [];
let adopted = false;

function mine() {
  if (!adopted && owner()) {
    used = load();
    adopted = true;
  }
  return used;
}

const asSet = () => new Set(mine());

let pending = [];
let timer = null;

export async function hydrate() {
  mine();
  if (!available()) return;
  try {
    const remote = await getPhrases();
    const merged = [...new Set(remote.concat(used))];
    if (merged.length !== used.length) {
      used = merged;
      save(used);
    }
  } catch {
    /* not signed in, or no signal: the local copy is enough */
  }
}

function flush() {
  const batch = pending;
  pending = [];
  timer = null;
  if (!batch.length || !available()) return;
  addPhrases(batch).catch(() => {});
}

export function remember(...texts) {
  const fresh = texts.filter((t) => t && !mine().includes(t));
  if (!fresh.length) return;
  used = used.concat(fresh);
  save(used);
  pending = pending.concat(fresh);
  clearTimeout(timer);
  timer = setTimeout(flush, 1500);
}

export function pickFresh(pool, sessionUsed = new Set()) {
  const memory = asSet();
  const never = pool.filter((t) => !sessionUsed.has(t) && !memory.has(t));
  if (never.length) return { pool: never, exhausted: false };
  const notThisDocument = pool.filter((t) => !sessionUsed.has(t));
  if (notThisDocument.length) {
    const byAge = notThisDocument.sort((a, b) => used.indexOf(a) - used.indexOf(b));
    return { pool: byAge, exhausted: true };
  }
  return { pool, exhausted: true };
}

export const seenCount = () => mine().length;

export function forget() {
  mine();
  used = [];
  adopted = true;
  save(used);
}
