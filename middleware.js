import { next } from "@vercel/edge";

export const config = {
  matcher: ["/((?!login.html|favicon.ico|favicon.svg|icon-.*\\.png|manifest.webmanifest).*)"],
};

const OPEN = new Set(["/api/login", "/api/logout", "/login", "/sw.js"]);

const BY_TICKET = new Set(["doc", "saved"]);

const b64urlToBytes = (s) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

async function ticketSays(ticket, secret) {
  if (!ticket || !ticket.includes(".")) return null;
  const [body, mac] = String(ticket).split(".");
  if (!body || !mac) return null;
  try {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "HMAC", key, b64urlToBytes(mac), new TextEncoder().encode(body),
    );
    if (!ok) return null;
    const said = JSON.parse(new TextDecoder().decode(b64urlToBytes(body)));
    return typeof said.exp === "number" && said.exp > Date.now() ? said : null;
  } catch {
    return null;
  }
}

async function valid(cookie, secret) {
  if (!cookie || !cookie.includes(".")) return false;
  const [payload, sig] = cookie.split(".");
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlToBytes(sig),
      new TextEncoder().encode(payload),
    );
    if (!ok) return false;
    const data = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)));
    return typeof data.exp === "number" && data.exp > Date.now();
  } catch {
    return false;
  }
}

export default async function middleware(request) {
  const { pathname, searchParams } = new URL(request.url);
  if (OPEN.has(pathname)) return next();

  const secret = process.env.AUTH_SECRET;
  if (!secret) return new Response("AUTH_SECRET is not set", { status: 500 });

  if (pathname === "/api/render" && BY_TICKET.has(searchParams.get("t") || "")) {
    const said = await ticketSays(searchParams.get("tk"), secret);
    if (said && said.job === searchParams.get("t")) return next();
    return new Response(JSON.stringify({ error: "no ticket" }), {
      status: 401, headers: { "content-type": "application/json" },
    });
  }

  if (pathname === "/api/documents" && searchParams.get("t") === "ics" && searchParams.get("k")) return next();

  if (pathname === "/api/dav" || pathname === "/.well-known/caldav") return next();

  const cookie = (request.headers.get("cookie") || "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("offshore_report_session="))
    ?.slice("offshore_report_session=".length);
  if (await valid(cookie, secret)) return next();

  if (pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "not signed in" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  const url = new URL("/login", request.url);
  url.searchParams.set("next", pathname);
  return Response.redirect(url, 302);
}
