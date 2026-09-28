import { readSetting, writeSetting } from "./vault";
import { PACKED, PACKED_AT } from "../forms/published";
import { FORM_KINDS, isSheet } from "./formkinds";

const KEPT = "forms:held";
const KINDS = FORM_KINDS.filter((k) => !isSheet(k));

let held = null;
let asked = null;

const read = () => {
  if (held) return held;
  try {
    held = JSON.parse(readSetting(KEPT, "") || "{}");
  } catch {
    held = {};
  }
  return held;
};
const write = () => {
  try {
    writeSetting(KEPT, JSON.stringify(held));
  } catch {
    /* No room, or no storage at all: it still works for this session, and the
       form compiled into the page is still there underneath. */
  }
};

const toText = (bytes) => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
};
const fromText = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export const packedAt = () => (__OFFLINE__ ? PACKED_AT : "");
export const packedForms = () => (__OFFLINE__ ? Object.keys(PACKED) : []);

export function heldForm(kind) {
  if (__OFFLINE__) {
    const packed = PACKED[kind];
    if (!packed?.bytes) return null;
    try {
      return { ...packed, bytes: fromText(packed.bytes) };
    } catch {
      return null;
    }
  }
  const one = read()[kind];
  if (!one?.bytes) return null;
  try {
    return { ...one, bytes: fromText(one.bytes) };
  } catch {
    return null;
  }
}

export const heldAbout = (kind) => {
  const one = __OFFLINE__ ? PACKED[kind] : read()[kind];
  return one ? { version: one.version, anchors: one.anchors || {}, blanks: one.blanks || {}, wording: one.wording || {} } : null;
};

export async function catchUp() {
  if (__OFFLINE__) return false;
  if (asked) return asked;
  asked = (async () => {
    let said;
    try {
      const res = await fetch("/api/render?t=manifest", { cache: "no-store" });
      if (!res.ok) return false;
      said = (await res.json()).forms || {};
    } catch {
      return false;
    }
    read();
    let moved = false;
    for (const kind of KINDS) {
      const now = said[kind];
      if (!now?.sha256) continue;
      if (held[kind]?.sha256 === now.sha256) continue;
      try {
        const res = await fetch(`/api/render?t=bytes&kind=${kind}&v=${now.version}`, { cache: "no-store" });
        if (!res.ok) continue;
        const bytes = new Uint8Array(await res.arrayBuffer());
        held[kind] = {
          version: now.version,
          sha256: now.sha256,
          anchors: now.anchors || {},
          blanks: now.blanks || {},
          wording: now.wording || {},
          bytes: toText(bytes),
        };
        moved = true;
      } catch {
        /* Leave what is held: half a form is worse than an old one. */
      }
    }
    if (moved) write();
    return moved;
  })();
  return asked;
}

export async function catchUpAgain() {
  asked = null;
  return catchUp();
}

export function forgetForms() {
  held = {};
  asked = null;
  write();
}
