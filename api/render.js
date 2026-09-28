import { requireSession } from "./_supabase.js";
import { ask, engineReady } from "./_engine.js";
import { bytesOf, draftOf, extOf, holdDraft, isSheet, keep, live, manifest, typeOf, versions } from "./_templates.js";
import { editorSays, signedForEditor, ticketFor, ticketSays } from "./_ticket.js";

export const config = { api: { bodyParser: false } };

const LIMIT = 8 * 1024 * 1024;

async function saved(req, kind) {
  const body = JSON.parse((await raw(req, LIMIT))?.toString() || "{}");
  const token = body.token || String(req.headers.authorization || "").replace(/^Bearer /, "");
  const said = editorSays(token);
  if (!said) return { error: 1, message: "that was not signed by the document server" };
  const payload = said.payload || said;
  const status = Number(payload.status ?? body.status);
  if (status !== 2 && status !== 6) return { error: 0 };
  const from = payload.url || body.url;
  if (!from) return { error: 1, message: "it said it had saved but sent nowhere to fetch it" };
  const got = await fetch(from);
  if (!got.ok) return { error: 1, message: `the saved file could not be fetched (${got.status})` };
  const bytes = Buffer.from(await got.arrayBuffer());
  if (bytes.length < 5 || bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    return { error: 1, message: `what came back is not a ${isSheet(kind) ? "workbook" : "Word document"}` };
  await holdDraft(kind, bytes);
  return { error: 0 };
}

async function raw(req, limit) {
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) return null;
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

export default async function handler(req, res) {
  const asked = String(req.query?.t || "");
  if (asked === "doc" || asked === "saved") {
    const said = ticketSays(req.query?.tk);
    if (!said || said.job !== asked) return res.status(401).json({ error: "no ticket" });
    try {
      if (asked === "doc") {
        const got = await bytesOf(said.kind);
        if (!got) return res.status(404).json({ error: "no such form" });
        res.setHeader("content-type", typeOf(said.kind));
        res.setHeader("cache-control", "no-store");
        return res.status(200).send(got.bytes);
      }
      return res.status(200).json(await saved(req, said.kind));
    } catch (e) {
      return res.status(200).json({ error: 1, message: String(e.message).slice(0, 120) });
    }
  }

  const who = requireSession(req, res);
  if (!who) return;

  const t = String(req.query?.t || "");
  if (t) {
    try {
      if (req.method === "GET" && t === "manifest") return res.status(200).json({ forms: await manifest() });
      if (req.method === "GET" && t === "versions")
        return res.status(200).json({ versions: await versions(req.query.kind) });
      if (req.method === "GET" && t === "bytes") {
        const got = await bytesOf(req.query.kind, req.query.v);
        if (!got) return res.status(404).json({ error: "no such form" });
        res.setHeader("content-type", typeOf(req.query.kind));
        res.setHeader("cache-control", "private, max-age=3600");
        res.setHeader("etag", `"${got.sha256}"`);
        return res.status(200).send(got.bytes);
      }
      if (req.method === "POST" && t === "map") {
        if (!engineReady()) return res.status(500).json({ error: "the server cannot draw documents yet" });
        const bytes = await raw(req, LIMIT);
        if (bytes === null) return res.status(413).json({ error: "that document is too big" });
        if (!bytes?.length) return res.status(400).json({ error: "no document" });
        const out = await ask(bytes, {
          where: "map",
          headers: { "x-labels": String(req.headers["x-labels"] || "[]") },
          timeout: 120_000,
        });
        if (out.status !== 200) {
          const mine = out.status >= 400 && out.status < 500;
          return res.status(mine ? 400 : 502).json({
            error: mine ? "that form could not be read" : `could not be mapped (${out.status})`,
          });
        }
        res.setHeader("content-type", "application/json");
        return res.status(200).send(out.body);
      }
      if (req.method === "POST" && t === "publish") {
        const bytes = await raw(req, LIMIT);
        if (bytes === null) return res.status(413).json({ error: "that document is too big" });
        let extra = {};
        try {
          extra = JSON.parse(String(req.headers["x-form"] || "{}"));
        } catch {
          return res.status(400).json({ error: "the form details are not readable" });
        }
        const row = await keep(who, req.query.kind, bytes, extra);
        return res.status(200).json({ version: row.version, id: row.id });
      }
      if (req.method === "PATCH" && t === "live")
        return res.status(200).json(await live(who, req.query.kind, req.query.v));

      if (req.method === "GET" && t === "editor") {
        const kind = String(req.query.kind || "");
        const at = String(process.env.ONLYOFFICE_URL || "");
        if (!at) return res.status(503).json({ error: "no document server is set up" });
        const got = await manifest();
        const now = got?.[kind];
        if (!now) return res.status(404).json({ error: "no such form" });
        const site = `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
        const config = {
          document: {
            fileType: extOf(kind),
            key: `${kind}-${now.version}-${String(now.sha256 || "").slice(0, 12)}`,
            title: `${kind}.${extOf(kind)}`,
            url: `${site}/api/render?t=doc&tk=${encodeURIComponent(ticketFor(kind, "doc", who.email))}`,
            permissions: { edit: true, download: true, print: true },
          },
          documentType: isSheet(kind) ? "cell" : "word",
          editorConfig: {
            mode: "edit",
            lang: "en",
            callbackUrl: `${site}/api/render?t=saved&tk=${encodeURIComponent(ticketFor(kind, "saved", who.email))}`,
            user: { id: String(who.sub || who.email), name: String(who.email || "you") },
            customization: {
              autosave: true,
              forcesave: true,
              compactHeader: false,
              help: false,
              features: { featuresTips: false },
              featuresTips: false,
              hideNotes: true,
              uiTheme: "theme-dark",
            },
          },
        };
        const up = await fetch(`${at}/healthcheck`, { signal: AbortSignal.timeout(4000) })
          .then((r) => r.ok)
          .catch(() => false);
        return res.status(200).json({ at, up, config, token: signedForEditor(config) });
      }

      if (req.method === "POST" && t === "now") {
        const at = String(process.env.ONLYOFFICE_URL || "");
        const kind = String(req.query.kind || "");
        if (!at) return res.status(503).json({ error: "no document server is set up" });
        const got = await manifest();
        const now = got?.[kind];
        if (!now) return res.status(404).json({ error: "no such form" });
        const body = {
          c: "forcesave",
          key: `${kind}-${now.version}-${String(now.sha256 || "").slice(0, 12)}`,
        };
        const said = await fetch(`${at}/coauthoring/CommandService.ashx`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${signedForEditor({ payload: body })}`,
          },
          body: JSON.stringify({ ...body, token: signedForEditor(body) }),
        }).then((r) => r.json()).catch((e) => ({ error: 9, message: e.message }));
        const code = Number(said?.error ?? 9);
        if (code !== 0 && code !== 4)
          return res.status(502).json({ error: `the document server would not save it (${code})` });
        return res.status(200).json({ saved: code === 0 });
      }

      if (req.method === "GET" && t === "draft") {
        const got = await draftOf(req.query.kind);
        if (!got) return res.status(404).json({ error: "nothing has been edited yet" });
        res.setHeader("content-type", typeOf(req.query.kind));
        res.setHeader("cache-control", "no-store");
        return res.status(200).send(got);
      }
      return res.status(400).json({ error: "no such request" });
    } catch (e) {
      const mine = /admin|no such/.test(e.message);
      return res.status(mine ? 403 : 500).json({ error: e.message.slice(0, 160) });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "use POST" });
  if (!engineReady()) return res.status(500).json({ error: "the server cannot draw documents yet" });

  const bytes = await raw(req, LIMIT);
  if (bytes === null) return res.status(413).json({ error: "that document is too big to draw" });
  if (!bytes.length) return res.status(400).json({ error: "no document" });

  try {
    const out = await ask(bytes);
    if (out.status !== 200 || !String(out.type || "").includes("pdf")) {
      const mine = out.status >= 400 && out.status < 500;
      return res.status(mine ? out.status : 502).json({
        error: mine ? "that is not a Word document" : `could not be drawn (${out.status})`,
      });
    }
    res.setHeader("content-type", "application/pdf");
    res.setHeader("cache-control", "private, no-store");
    return res.status(200).send(out.body);
  } catch (e) {
    return res.status(502).json({ error: `could not be drawn: ${e.message}` });
  }
}
