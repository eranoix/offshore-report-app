import { readMine, writeMine } from "./vault";
import { inOrder } from "./order";

const KEY = "caap:people";
const same = (a, b) => key(a) === key(b);
const key = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

const read = () => {
  const got = readMine(KEY, []);
  return Array.isArray(got) ? got : [];
};

export function everyone() {
  return inOrder(read().filter((p) => p && p.name), (p) => p.name);
}

export const knownAs = (name) => (name ? read().find((p) => same(p.name, name)) || null : null);

export function positions(extra = []) {
  const seen = new Map();
  for (const p of read()) {
    if (!p.position) continue;
    const k = key(p.position);
    seen.set(k, { text: p.position, used: (seen.get(k)?.used || 0) + (p.used || 1) });
  }
  const out = [...seen.values()].map((x) => x.text);
  for (const r of extra) if (!out.some((x) => same(x, r))) out.push(r);
  return inOrder(out);
}

export function sites() {
  const seen = new Map();
  for (const p of read()) {
    if (!p.site) continue;
    const k = key(p.site);
    seen.set(k, { text: p.site, used: (seen.get(k)?.used || 0) + (p.used || 1) });
  }
  return inOrder([...seen.values()].map((x) => x.text));
}

export function remember({ name, position, bond, site } = {}) {
  const clean = String(name || "").trim();
  if (clean.length < 2) return;
  const all = read();
  const at = all.findIndex((p) => same(p.name, clean));
  const was = at >= 0 ? all[at] : { name: clean, used: 0 };
  const now = {
    ...was,
    name: clean,
    position: position || was.position || "",
    bond: bond || was.bond || "",
    site: site || was.site || "",
    used: (was.used || 0) + 1,
    at: Date.now(),
  };
  if (at >= 0) all[at] = now;
  else all.push(now);
  try {
    writeMine(KEY, all.slice(-200));
  } catch {
    /* no storage: the names simply are not remembered between sessions */
  }
}

export function forget(name) {
  try {
    writeMine(KEY, read().filter((p) => !same(p.name, name)));
  } catch {
    /* nothing to do */
  }
}
