import crypto from "node:crypto";

const GOOD_FOR = 30 * 60 * 1000;

const sign = (body, secret) => crypto.createHmac("sha256", secret).update(body).digest("base64url");

export function ticketFor(kind, job, who = "") {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return "";
  const body = Buffer.from(JSON.stringify({
    kind, job, by: who, exp: Date.now() + GOOD_FOR,
  })).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function ticketSays(ticket, secret = process.env.AUTH_SECRET) {
  if (!secret || !ticket || !ticket.includes(".")) return null;
  const [body, mac] = String(ticket).split(".");
  if (!body || !mac) return null;
  const want = Buffer.from(sign(body, secret), "utf8");
  const given = Buffer.from(mac, "utf8");
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
  try {
    const said = JSON.parse(Buffer.from(body, "base64url").toString());
    return said.exp > Date.now() ? said : null;
  } catch {
    return null;
  }
}

export function signedForEditor(config) {
  const secret = process.env.ONLYOFFICE_JWT;
  if (!secret) return null;
  const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(config)).toString("base64url");
  const mac = crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${mac}`;
}

export function editorSays(token, secret = process.env.ONLYOFFICE_JWT) {
  if (!secret || !token) return null;
  const [head, body, mac] = String(token).split(".");
  if (!head || !body || !mac) return null;
  const want = Buffer.from(
    crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url"), "utf8",
  );
  const given = Buffer.from(mac, "utf8");
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
}

export function feedFor(user, doc, code) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return "";
  const body = Buffer.from(JSON.stringify({ u: user, d: doc, n: code, job: "ics" })).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function feedSays(key, secret = process.env.AUTH_SECRET) {
  if (!secret || !key || !String(key).includes(".")) return null;
  const [body, mac] = String(key).split(".");
  const want = Buffer.from(sign(body, secret), "utf8");
  const given = Buffer.from(mac || "", "utf8");
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
  try {
    const said = JSON.parse(Buffer.from(body, "base64url").toString());
    return said.job === "ics" && said.u && said.d && said.n ? said : null;
  } catch {
    return null;
  }
}

export function davFor(user, doc, code) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return "";
  const body = Buffer.from(JSON.stringify({ u: user, d: doc, n: code, job: "dav" })).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function davSays(key, secret = process.env.AUTH_SECRET) {
  if (!secret || !key || !String(key).includes(".")) return null;
  const [body, mac] = String(key).split(".");
  const want = Buffer.from(sign(body, secret), "utf8");
  const given = Buffer.from(mac || "", "utf8");
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
  try {
    const said = JSON.parse(Buffer.from(body, "base64url").toString());
    return said.job === "dav" && said.u && said.d && said.n ? said : null;
  } catch {
    return null;
  }
}
