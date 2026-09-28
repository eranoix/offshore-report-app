import crypto from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { extractText, getDocumentProxy } from "unpdf";
import { db, storage, requireSession, isAdmin, isId } from "./_supabase.js";
import { PRINTED, PRINTED_RUN, PRINTED_WORDS, flatten } from "./_printed.js";
import { ask, engineReady } from "./_engine.js";

const BUCKET = "offshore-report-library";
const CHUNK = 1200;
const TEXT_CAP = 200_000;

const entities = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");

function fromWord(bytes) {
  const part = unzipSync(new Uint8Array(bytes))["word/document.xml"];
  if (!part) return "";
  const xml = strFromU8(part)
    .replace(/<w:tab[^>]*\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n");
  return entities(xml.replace(/<[^>]+>/g, "")).replace(/\n{3,}/g, "\n\n").trim();
}

async function fromPdf(bytes) {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return String(text || "").replace(/\n{3,}/g, "\n\n").trim();
}

const THIN = 200;

async function readHarder(bytes, name) {
  if (!engineReady()) return "";
  try {
    const out = await ask(bytes, { where: "read", headers: { "x-name": String(name || "").slice(0, 200) }, timeout: 300_000 });
    if (out.status !== 200) return "";
    return String(JSON.parse(out.body.toString("utf8")).text || "");
  } catch {
    return "";
  }
}

export async function readWords(bytes, kind, name) {
  const ext = String(name || "").toLowerCase();
  let words = "";
  try {
    if (/^text\/|json|csv|markdown/.test(kind)) return bytes.toString("utf8");
    if (kind === "application/pdf" || ext.endsWith(".pdf")) words = await fromPdf(bytes);
    else if (/wordprocessingml|ms-word/.test(kind) || ext.endsWith(".docx") || ext.endsWith(".docm"))
      words = fromWord(bytes);
  } catch {
    /* a file we cannot open is not a failed upload */
  }
  if (words.replace(/\s/g, "").length >= THIN && wordliness(words) >= 0.5) return words;
  const harder = await readHarder(bytes, name);
  if (!harder) return words;
  if (!words.trim()) return harder;
  return wordliness(harder) >= wordliness(words) ? harder : words;
}

function wordliness(line) {
  const toks = String(line).split(/\s+/).filter(Boolean);
  if (!toks.length) return 1;
  const words = toks.filter((t) => /^[A-Za-z][A-Za-z'-]{2,}$/.test(t.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "")));
  return words.length / toks.length;
}

function markdown(raw) {
  const seen = new Set();
  const lines = [];
  for (const line of String(raw).split(/\r?\n/)) {
    const t = line.split(/\s+/).filter(Boolean).join(" ");
    if (t.length < 3 || /^[-_=.·•\s]+$/.test(t) || /^(page \d+ of \d+|\d+)$/i.test(t)) continue;
    if (PRINTED.has(t)) continue;
    const flat = flatten(t);
    const words = flat ? flat.split(" ") : [];
    if (words.length >= 4 && PRINTED_RUN.includes(flat)) continue;
    if (words.length && words.length < 4 && words.every((w) => PRINTED_WORDS.has(w))) continue;
    if (words.length >= 5 && wordliness(t) < 0.4) continue;
    if (t.length < 60 && seen.has(t)) continue;
    seen.add(t);
    lines.push(t === t.toUpperCase() && t.length < 80 ? `\n## ${t}` : t);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function passages(text) {
  const out = [];
  let buf = "";
  for (const line of markdown(text).split("\n")) {
    if (buf.length + line.length + 1 > CHUNK && buf) {
      out.push(buf.trim());
      buf = "";
    }
    buf += line + "\n";
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter((p) => p.length > 140).slice(0, 80);
}

async function index(userId, docId, text) {
  const rows = passages(text).map((t, ord) => ({ user_id: userId, doc_id: docId, ord, text: t }));
  if (!rows.length) return 0;
  try {
    await db("offshore_report_library_chunks", { method: "POST", body: rows, prefer: "return=minimal" });
    return rows.length;
  } catch {
    return 0;
  }
}
const LIMIT = 4 * 1024 * 1024;

const safe = (name) =>
  String(name || "document")
    .replace(/[^\w.\- ]+/g, "_")
    .slice(-90)
    .trim() || "document";

export default async function handler(req, res) {
  const who = requireSession(req, res);
  if (!who) return;
  const admin = isAdmin(who);

  try {
    if (req.method === "GET" && req.query?.text) {
      const [row] = await db(
        `offshore_report_library?id=eq.${req.query.text}&select=user_id,name,kind,text_content`,
      );
      if (!row) return res.status(404).json({ error: "no such document" });
      if (row.user_id !== who.sub && !admin)
        return res.status(403).json({ error: "that document is not yours" });
      res.setHeader("cache-control", "private, no-store");
      return res.status(200).json({
        name: row.name,
        kind: row.kind,
        text: (row.text_content || "").slice(0, 20000),
        read: Boolean(row.text_content),
      });
    }

    if (req.method === "GET" && req.query?.file) {
      const [row] = await db(
        `offshore_report_library?id=eq.${req.query.file}&select=user_id,name,kind,path`,
      );
      if (!row) return res.status(404).json({ error: "no such document" });
      if (row.user_id !== who.sub && !admin)
        return res.status(403).json({ error: "that document is not yours" });
      const file = await storage(`${BUCKET}/${encodeURI(row.path)}`);
      const inline = req.query?.inline === "1";
      res.setHeader("content-type", row.kind || "application/octet-stream");
      res.setHeader(
        "content-disposition",
        `${inline ? "inline" : "attachment"}; filename="${row.name.replace(/"/g, "")}"`,
      );
      res.setHeader("cache-control", "private, no-store");
      return res.status(200).send(Buffer.from(await file.arrayBuffer()));
    }

    if (req.method === "GET") {
      const mine = req.query?.mine === "1";
      const everything = admin && !mine;
      const scope = everything ? "" : `user_id=eq.${who.sub}&`;
      const rows = await db(
        `offshore_report_library?${scope}select=id,user_id,user_email,name,kind,size,campaign,notes,created_at,shared,` +
          `offshore_report_library_chunks(count)&order=created_at.desc&limit=1000`,
      );
      return res.status(200).json({
        admin,
        showing: everything ? "everyone" : "mine",
        documents: (rows || []).map(({ offshore_report_library_chunks: cut, ...r }) => ({
          ...r,
          own: r.user_id === who.sub,
          passages: Array.isArray(cut) ? Number(cut[0]?.count || 0) : 0,
        })),
      });
    }

    if (req.method === "POST") {
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
      if (!bytes.length) return res.status(400).json({ error: "the file came through empty" });
      if (bytes.length > LIMIT)
        return res.status(413).json({ error: "that file is over 4 MB — send a smaller one" });

      const name = safe(req.query?.name);
      const kind = String(req.query?.kind || "application/octet-stream").slice(0, 120);
      const path = `${who.sub}/${crypto.randomUUID()}-${name}`;
      await storage(`${BUCKET}/${encodeURI(path)}`, {
        method: "POST",
        body: bytes,
        contentType: kind,
      });

      const words = (await readWords(bytes, kind, name)).slice(0, TEXT_CAP);
      const saved = await db("offshore_report_library", {
        method: "POST",
        prefer: "return=representation",
        body: {
          user_id: who.sub,
          user_email: who.email || null,
          name,
          kind,
          size: bytes.length,
          path,
          campaign: String(req.query?.campaign || "").slice(0, 60) || null,
          notes: String(req.query?.notes || "").slice(0, 600) || null,
          text_content: words || null,
        },
      });
      const row = Array.isArray(saved) ? saved[0] : saved;
      const passagesIndexed = words && row?.id ? await index(who.sub, row.id, words) : 0;
      return res.status(200).json({ document: row, passages: passagesIndexed });
    }

    if (req.method === "PATCH") {
      if (!admin) return res.status(403).json({ error: "only the site's administrator can share a document" });
      const id = String(req.query?.id || "");
      if (!isId(id)) return res.status(400).json({ error: "which document?" });
      const shared = req.query?.shared === "1";
      const [row] = await db(`offshore_report_library?id=eq.${id}&select=id`);
      if (!row) return res.status(404).json({ error: "no such document" });
      await db(`offshore_report_library?id=eq.${id}`, { method: "PATCH", body: { shared }, prefer: "return=minimal" });
      return res.status(200).json({ id, shared });
    }

    if (req.method === "DELETE") {
      const id = req.query?.id;
      if (!id) return res.status(400).json({ error: "no id" });
      if (!admin)
        return res.status(403).json({
          error: "a document that has been handed over can only be removed by whoever runs the site",
        });
      const [row] = await db(`offshore_report_library?id=eq.${id}&select=id,user_id,path`);
      if (!row) return res.status(404).json({ error: "no such document" });
      await storage(`${BUCKET}/${encodeURI(row.path)}`, { method: "DELETE" }).catch(() => {});
      await db(`offshore_report_library?id=eq.${id}`, { method: "DELETE" });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "GET, POST or DELETE" });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
