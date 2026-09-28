import crypto from "node:crypto";
import { db, isId, requireSession } from "./_supabase.js";
import { davFor, feedFor, feedSays } from "./_ticket.js";
import { icsOf } from "../src/engine/ics.js";
import { profileOf } from "../src/engine/caldav.js";
import { DAV_HOST } from "./dav.js";

export default async function handler(req, res) {
  if (req.method === "GET" && req.query?.t === "ics") {
    const said = feedSays(req.query?.k);
    if (!said || !isId(said.d)) return res.status(404).send("No such calendar.");
    try {
      const [row] = await db(`offshore_report_documents?id=eq.${said.d}&user_id=eq.${said.u}&kind=eq.rotation&select=data`) || [];
      if (!row?.data || row.data.feed !== said.n) return res.status(404).send("No such calendar.");
      const [tick] = await db(`offshore_report_documents?user_id=eq.${said.u}&kind=eq.certificates&select=data&order=updated_at.desc&limit=1`) || [];
      const today = new Date().toISOString().slice(0, 10);
      const body = icsOf(row.data, {
        today, certificates: tick?.data?.certificates || [],
        name: `Rotation${row.data.who ? ` — ${row.data.who}` : ""}`,
      });
      res.setHeader("content-type", "text/calendar; charset=utf-8");
      res.setHeader("content-disposition", 'inline; filename="rotation.ics"');
      res.setHeader("cache-control", "private, no-store");
      return res.status(200).send(body);
    } catch {
      return res.status(502).send("The calendar could not be read just now.");
    }
  }

  const who = requireSession(req, res);
  if (!who) return;

  if (req.method === "GET" && req.query?.t === "cal") {
    let url;
    try { url = new URL(String(req.query?.u || "").replace(/^webcal:/i, "https:")); } catch { url = null; }
    const CAL_HOSTS = /^(calendar\.google\.com|outlook\.office365\.com|outlook\.live\.com|p\d+-caldav\.icloud\.com|p\d+-calendars?\.icloud\.com)$/i;
    if (!url || url.protocol !== "https:" || !CAL_HOSTS.test(url.hostname)) {
      return res.status(400).json({ error: "that is not a Google, Outlook or iCloud calendar address" });
    }
    try {
      const got = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000), headers: { accept: "text/calendar" } });
      if (!got.ok) return res.status(502).json({ error: `the calendar answered ${got.status} — check the address is the secret iCal one` });
      const text = await got.text();
      if (!text.includes("BEGIN:VCALENDAR")) return res.status(502).json({ error: "that address did not give a calendar" });
      if (text.length > 6_000_000) return res.status(413).json({ error: "that calendar is too big to read" });
      res.setHeader("content-type", "text/calendar; charset=utf-8");
      res.setHeader("cache-control", "private, no-store");
      return res.status(200).send(text);
    } catch (e) {
      return res.status(502).json({ error: `could not reach it: ${String(e.message).slice(0, 80)}` });
    }
  }

  if (req.method === "POST" && req.query?.t === "feed") {
    const id = req.body?.id;
    if (!isId(id)) return res.status(400).json({ error: "save the plan to your account first" });
    try {
      const [row] = await db(`offshore_report_documents?id=eq.${id}&user_id=eq.${who.sub}&kind=eq.rotation&select=id,data`) || [];
      if (!row) return res.status(404).json({ error: "no such plan" });
      let code = row.data?.feed;
      if (!code || req.body?.stop) {
        code = crypto.randomBytes(9).toString("base64url");
        await db(`offshore_report_documents?id=eq.${id}&user_id=eq.${who.sub}`, {
          method: "PATCH", body: { data: { ...row.data, feed: code }, updated_at: new Date().toISOString() },
        });
      }
      const site = `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
      return res.status(200).json({ url: `${site}/api/documents?t=ics&k=${encodeURIComponent(feedFor(who.sub, id, code))}`, code });
    } catch (e) {
      return res.status(500).json({ error: String(e.message).slice(0, 120) });
    }
  }

  if ((req.method === "POST" && req.query?.t === "dav") || (req.method === "GET" && req.query?.t === "profile")) {
    const id = req.body?.id || req.query?.id;
    if (!isId(id)) return res.status(400).json({ error: "save the plan to your account first" });
    try {
      const [row] = await db(`offshore_report_documents?id=eq.${id}&user_id=eq.${who.sub}&kind=eq.rotation&select=id,data`) || [];
      if (!row) return res.status(404).json({ error: "no such plan" });
      if (req.method === "POST" && req.body?.stop) {
        const { dav, ...rest } = row.data || {};
        await db(`offshore_report_documents?id=eq.${id}&user_id=eq.${who.sub}`, {
          method: "PATCH", body: { data: rest, updated_at: new Date().toISOString() },
        });
        return res.status(200).json({ stopped: true });
      }
      let code = row.data?.dav;
      if (!code) {
        code = crypto.randomBytes(9).toString("base64url");
        await db(`offshore_report_documents?id=eq.${id}&user_id=eq.${who.sub}`, {
          method: "PATCH", body: { data: { ...row.data, dav: code }, updated_at: new Date().toISOString() },
        });
      }
      const host = DAV_HOST;
      const key = davFor(who.sub, id, code);
      if (req.method === "GET") {
        res.setHeader("content-type", "application/x-apple-aspen-config");
        res.setHeader("content-disposition", 'attachment; filename="offshore-report-calendar.mobileconfig"');
        res.setHeader("cache-control", "private, no-store");
        return res.status(200).send(profileOf({ host, email: who.email, key, doc: id }));
      }
      return res.status(200).json({ server: `https://${host}/dav/`, host, user: who.email || "", password: key, code });
    } catch (e) {
      return res.status(500).json({ error: String(e.message).slice(0, 120) });
    }
  }

  try {
    if (req.method === "GET") {
      const kind = String(req.query?.kind || "trip").slice(0, 20);
      const only = kind === "every" ? "" : `kind=eq.${encodeURIComponent(kind)}&`;
      const rows = await db(
        `offshore_report_documents?user_id=eq.${who.sub}&${only}` +
          `select=id,crew,vessel,trip_end,preset,kind,updated_at&order=updated_at.desc&limit=200`,
      );
      return res.status(200).json({ documents: rows || [] });
    }

    if (req.method === "POST") {
      const doc = req.body?.data;
      if (!doc) return res.status(400).json({ error: "no document" });
      const row = {
        user_id: who.sub,
        crew: String(doc.crew || "").slice(0, 120),
        vessel: String(doc.vessel || "").slice(0, 120),
        trip_end: req.body?.trip_end || null,
        preset: String(doc.preset || req.body?.preset || "good").slice(0, 20),
        kind: String(req.body?.kind || "trip").slice(0, 20),
        data: doc,
        updated_at: new Date().toISOString(),
      };
      const id = req.body?.id;
      if (id && !isId(id)) return res.status(400).json({ error: "that is not a document id" });
      const base = req.body?.base;
      if (id && row.kind === "rotation") {
        const [was] = await db(`offshore_report_documents?id=eq.${id}&user_id=eq.${who.sub}&select=data,updated_at`) || [];
        const { feed, dav, ...rest } = doc;
        row.data = { ...rest, ...(was?.data?.feed ? { feed: was.data.feed } : {}), ...(was?.data?.dav ? { dav: was.data.dav } : {}) };
        if (base && was && was.updated_at !== base) return res.status(409).json({ error: "changed elsewhere", document: { id, ...was } });
      }
      const saved = id
        ? await db(`offshore_report_documents?id=eq.${id}&user_id=eq.${who.sub}${base ? `&updated_at=eq.${encodeURIComponent(base)}` : ""}`, {
            method: "PATCH", body: row, prefer: "return=representation",
          })
        : await db("offshore_report_documents", { method: "POST", body: row, prefer: "return=representation" });
      if (id && base && !saved?.length) {
        const [now] = await db(`offshore_report_documents?id=eq.${id}&user_id=eq.${who.sub}&select=data,updated_at`) || [];
        return res.status(409).json({ error: "changed elsewhere", document: { id, ...now } });
      }
      return res.status(200).json({ document: Array.isArray(saved) ? saved[0] : saved });
    }

    if (req.method === "DELETE") {
      const id = req.query?.id;
      if (!isId(id)) return res.status(400).json({ error: "that is not a document id" });
      await db(`offshore_report_documents?id=eq.${id}&user_id=eq.${who.sub}`, { method: "DELETE" });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "GET, POST or DELETE" });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
