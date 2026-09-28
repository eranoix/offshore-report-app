import crypto from "node:crypto";

export const URL_BASE = () => (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

export function session(req) {
  const raw = (req.headers.cookie || "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("offshore_report_session="));
  if (!raw) return null;
  const token = raw.slice("offshore_report_session=".length);
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const given = Buffer.from(mac, "utf8");
  const want = Buffer.from(expected, "utf8");
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString());
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

export async function db(path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${URL_BASE()}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE(),
      authorization: `Bearer ${SERVICE()}`,
      "content-type": "application/json",
      ...(prefer ? { prefer } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

export const isId = (v) =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function countRows(path) {
  const res = await fetch(`${URL_BASE()}/rest/v1/${path}`, {
    method: "HEAD",
    headers: {
      apikey: SERVICE(),
      authorization: `Bearer ${SERVICE()}`,
      prefer: "count=exact",
      range: "0-0",
    },
  });
  if (!res.ok) throw new Error(`supabase ${res.status}`);
  const total = Number(String(res.headers.get("content-range") || "").split("/")[1]);
  return Number.isFinite(total) ? total : null;
}

export function requireSession(req, res) {
  const who = session(req);
  if (!who) {
    res.status(401).json({ error: "not signed in" });
    return null;
  }
  return who;
}

const FOUNDER = "admin@northwind.example";

export const admins = () => {
  const named = String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([FOUNDER, ...named])];
};

export const isAdmin = (who) => admins().includes(String(who?.email || "").toLowerCase());

export async function storage(path, { method = "GET", body, contentType, replace = false } = {}) {
  const res = await fetch(`${URL_BASE()}/storage/v1/object/${path}`, {
    method,
    headers: {
      apikey: SERVICE(),
      authorization: `Bearer ${SERVICE()}`,
      ...(contentType ? { "content-type": contentType } : {}),
      ...(replace ? { "x-upsert": "true" } : {}),
    },
    ...(body ? { body } : {}),
  });
  if (!res.ok) throw new Error(`storage ${res.status}: ${(await res.text()).slice(0, 180)}`);
  return res;
}
