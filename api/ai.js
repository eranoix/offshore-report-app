import https from "node:https";
import { db, session } from "./_supabase.js";

const MAX_TOKENS = 8000;
const SYSTEM_CHARS = 12_000;
const MESSAGE_CHARS = 24_000;
const PASSAGES = 8;
const CONTEXT_CHARS = 7000;

function terms(hint = {}) {
  const words = Object.values(hint)
    .filter((v) => typeof v === "string")
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && w.length < 24 && !STOP.has(w));
  return [...new Set(words)].slice(0, 24).join(" | ");
}
const STOP = new Set(["the","and","for","with","that","this","from","their","them","has","had","was","were","are","its","his","her","who","which","into","out","over","per","any","all","one","two"]);

async function fromLibrary(req, hint, facts = false) {
  const who = session(req);
  if (!who?.sub) return "";
  const q = terms(hint);
  if (!q) return "";
  try {
    const rows = await db("rpc/offshore_report_library_context", {
      method: "POST",
      body: { uid: who.sub, terms: q, n: PASSAGES },
    });
    if (!Array.isArray(rows) || !rows.length) return "";
    let out = "";
    for (const r of rows) {
      const piece = `\n--- from ${r.doc}\n${String(r.passage || "").trim()}\n`;
      if (out.length + piece.length > CONTEXT_CHARS) break;
      out += piece;
    }
    if (!out) return "";
    return facts
      ? `THE RECORDS — this person's own completed paperwork. Everything you write
must come from here. Every task, system, tool, place, condition and action you
state as fact has to appear in these records; you may reword freely, join two
records into one sentence, or say it more plainly, but you may not add a fact
that is not here, and you may not soften that rule to fill space. Where the
records do not cover something, say less rather than invent. Do not copy a
name, a vessel or a date out of them: those come from the form.
${out}`
      : `Reference material — real paperwork from this person's own library, most of
it the same forms you are filling in. Follow the way these documents word
things: the vocabulary, the level of detail, the tone a reader in this company
expects. Ignore the printed parts of the form — the headings, the block capitals,
the confirmation wording — and follow only how the statement itself is written.
Do NOT take facts from them: no name, vessel, date, incident or person mentioned
here belongs in what you write. The facts come only from the form.
${out}`;
  } catch {
    return "";
  }
}

function callUpstream(payload) {
  const url = new URL(process.env.AI_UPSTREAM || "https://203.0.113.10:9443/v1/messages");
  const body = JSON.stringify(payload);
  const options = {
    method: "POST",
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname,
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
      "x-api-key": process.env.AI_KEY,
      "anthropic-version": "2023-06-01",
    },
    ...(process.env.AI_CA
      ? { ca: process.env.AI_CA }
      : { rejectUnauthorized: false, servername: url.hostname }),
    timeout: 60_000,
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("timeout", () => req.destroy(new Error("upstream timed out")));
    req.on("error", reject);
    req.end(body);
  });
}

export default async function handler(req, res) {
  if (req.method === "HEAD" || req.method === "OPTIONS") {
    res.setHeader("allow", "POST, HEAD");
    return res.status(204).end();
  }
  if (req.method !== "POST") return res.status(405).json({ error: "use POST" });
  if (!process.env.AI_KEY) return res.status(500).json({ error: "the server has no AI key" });

  const input = req.body || {};

  if (input.want === "passages") {
    const who = session(req);
    if (!who?.sub) return res.status(401).json({ error: "not signed in" });
    const q = terms(input.context || {});
    if (!q) return res.status(200).json({ passages: [] });
    try {
      const rows = await db("rpc/offshore_report_library_context", {
        method: "POST",
        body: { uid: who.sub, terms: q, n: Math.min(Number(input.n) || 10, 20) },
      });
      return res.status(200).json({
        passages: (Array.isArray(rows) ? rows : []).map((r) => ({
          doc: r.doc,
          text: String(r.passage || "").trim().slice(0, 2400),
        })),
      });
    } catch {
      return res.status(200).json({ passages: [] });
    }
  }

  const library = input.context ? await fromLibrary(req, input.context, input.use === "facts") : "";
  const messages = (Array.isArray(input.messages) ? input.messages : [])
    .slice(0, 4)
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || "").slice(0, MESSAGE_CHARS),
    }));
  if (!messages.length) return res.status(400).json({ error: "no messages" });

  const payload = {
    model: process.env.AI_MODEL || "claude-sonnet-4-6",
    max_tokens: Math.min(Number(input.max_tokens) || 400, MAX_TOKENS),
    temperature: typeof input.temperature === "number" ? input.temperature : 0.85,
    system: [String(input.system || "").slice(0, SYSTEM_CHARS), library].filter(Boolean).join("\n\n"),
    messages,
  };

  try {
    const upstream = await callUpstream(payload);
    res.status(upstream.status).setHeader("content-type", "application/json");
    return res.send(upstream.body);
  } catch (e) {
    return res.status(502).json({ error: `upstream unreachable: ${e.message}` });
  }
}
