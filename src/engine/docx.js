import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { ANCHORS } from "../forms/anchors";
import { heldAbout, heldForm } from "./forms";

import witnessForm from "../forms/witness.docx?url";
import observationForm from "../forms/observation.docx?url";
import knowledgeForm from "../forms/knowledge.docx?url";
import feedbackForm from "../forms/feedback.docx?url";
import tripForm from "../forms/trip.docx?url";
import { KEYS } from "./generator";

const FILES = {
  trip: tripForm,
  witness: witnessForm,
  observation: observationForm,
  knowledge: knowledgeForm,
  feedback: feedbackForm,
};

const cache = new Map();

async function template(kind) {
  if (cache.has(kind)) return cache.get(kind);
  const mine = heldForm(kind);
  if (mine?.bytes?.length) {
    cache.set(kind, mine.bytes);
    return mine.bytes;
  }
  if (!FILES[kind]) throw new Error(`no template for ${kind}`);
  const res = await fetch(FILES[kind]);
  if (!res.ok) throw new Error(`no template for ${kind}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  cache.set(kind, bytes);
  return bytes;
}

export const anchorsFor = (kind) => heldAbout(kind)?.anchors || ANCHORS[kind] || {};

const escape = (t) =>
  String(t ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const run = (text, { bold = false, look = "" } = {}) =>
  `<w:r><w:rPr>${boldly(look, bold)}</w:rPr><w:t xml:space="preserve">${escape(text)}</w:t></w:r>`;

function boldly(look, bold) {
  if (!bold || /<w:b\s*\/>|<w:b\s+[^>]*\/>/.test(look)) return look;
  let at = 0;
  for (const m of look.matchAll(/<w:rStyle\b[^>]*\/>|<w:rFonts\b[^>]*\/>/g)) at = Math.max(at, m.index + m[0].length);
  return `${look.slice(0, at)}<w:b/>${look.slice(at)}`;
}

function paraById(xml, id) {
  if (!id) return null;
  const at = xml.indexOf(`w14:paraId="${id}"`);
  if (at < 0) return null;
  const open = xml.lastIndexOf("<w:p ", at);
  if (open < 0) return null;
  const close = xml.indexOf("</w:p>", at);
  return close < 0 ? null : xml.slice(open, close + 6);
}

function intoLine(xml, para, value) {
  {
    const dots = /…+/.exec(para);
    let filled;
    if (dots) {
      const keep = Math.max(6, dots[0].length - Math.ceil(String(value).length * 1.6));
      filled = para.replace(dots[0], `${escape(value)} ${"…".repeat(keep)}`);
    } else {
      const pieces = [...para.matchAll(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g)];
      let after = -1;
      let seen = "";
      for (const piece of pieces) {
        seen += (piece[0].match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
          .map((t) => t.replace(/<[^>]+>/g, ""))
          .join("");
        if (seen.includes(":")) {
          after = piece.index + piece[0].length;
          break;
        }
      }
      if (after < 0) after = para.lastIndexOf("</w:p>");
      const gap = /\s$/.test(seen) ? " " : "  ";
      filled = `${para.slice(0, after)}${run(`${gap}${value}`)}${para.slice(after)}`;
    }
    return xml.replace(para, filled);
  }
}

export function intoCell(xml, id, value) {
  const said = String(value ?? "");
  if (!id || !said) return xml;
  const para = paraById(xml, id);
  if (!para) return xml;
  const at = xml.indexOf(para);
  return `${xml.slice(0, at)}${emptied(para)}${runs(said, lookOf(para))}</w:p>${xml.slice(at + para.length)}`;
}

function lookOf(para) {
  const pPr = (para.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [""])[0];
  return (pPr.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [""])[0]
    .replace(/^<w:rPr>/, "")
    .replace(/<\/w:rPr>$/, "");
}

const emptied = (para) => para.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, "").replace(/<\/w:p>$/, "");

function cellAround(xml, at) {
  const open = xml.lastIndexOf("<w:tc>", at);
  const shut = xml.indexOf("</w:tc>", at);
  if (open < 0 || shut < 0) return null;
  if (xml.slice(open, at).includes("</w:tc>")) return null;
  return `${open}:${shut}`;
}

function parasIn(xml, cell) {
  const [open, shut] = cell.split(":").map(Number);
  return (xml.slice(open, shut).match(/<w:p[ >\/]/g) || []).length;
}

export function intoCells(xml, ids, text) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  const body = String(text || "").trim();
  if (!list.length || !body) return xml;
  const lines = body.split(/\n{2,}/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return xml;

  const edits = [];
  const dropped = new Map();
  let model = null;
  list.forEach((id, i) => {
    const para = paraById(xml, id);
    if (!para) return;
    const at = xml.indexOf(para);
    model = { para, at };
    if (i < lines.length) {
      edits.push([at, at + para.length, `${emptied(para)}${runs(lines[i], lookOf(para))}</w:p>`]);
      return;
    }
    const edit = [at, at + para.length, ""];
    edits.push(edit);
    const cell = cellAround(xml, at);
    if (cell) dropped.set(cell, [...(dropped.get(cell) || []), { edit, para }]);
  });
  for (const [cell, gone] of dropped) {
    if (gone.length < parasIn(xml, cell)) continue;
    const keep = gone[gone.length - 1];
    keep.edit[2] = `${emptied(keep.para)}</w:p>`;
  }

  const spare = lines.slice(list.length);
  if (spare.length && model) {
    const tail = model.at + model.para.length;
    edits.push([tail, tail, spare
      .map((line) => `${emptied(model.para)}${runs(line, lookOf(model.para))}</w:p>`)
      .join("")]);
  }

  let out = xml;
  edits
    .sort((a, b) => b[0] - a[0])
    .forEach(([open, close, piece]) => {
      out = out.slice(0, open) + piece + out.slice(close);
    });
  return out;
}

export const tickScore = (xml, anchors, row, score) =>
  score >= 1 && score <= 5 ? intoCell(xml, anchors[`score${row}_${score}`], "x") : xml;

function onLine(xml, label, value) {
  if (!value) return xml;
  const plain = label.replace(/&amp;/g, "&").toUpperCase();
  const paras = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)];
  for (const match of paras) {
    const words = (match[0].match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
      .map((t) => t.replace(/<[^>]+>/g, ""))
      .join("")
      .replace(/&amp;/g, "&")
      .toUpperCase();
    if (!new RegExp(`${plain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`).test(words)) continue;
    return intoLine(xml, match[0], value);
  }
  return xml;
}

function onAnchor(xml, id, value) {
  if (!value) return xml;
  const para = paraById(xml, id);
  return para ? intoLine(xml, para, value) : xml;
}

function intoBox(xml, text, { from = 0, take = 0 } = {}) {
  const body = String(text || "").trim();
  if (!body) return xml;
  const boxes = [...xml.matchAll(/<w:p\b[^>]*>(?:(?!<\/w:p>)[\s\S])*?<w:pBdr>[\s\S]*?<\/w:pPr><\/w:p>/g)].map(
    (m) => ({ text: m[0], at: m.index }),
  );
  if (!boxes.length) return xml;
  const mine = take ? boxes.slice(from, from + take) : boxes.slice(from);
  if (!mine.length) return xml;

  const lines = body.split(/\n{2,}/).map((para) => para.trim()).filter(Boolean);
  const APART = 120;
  const written = (box, line, last) =>
    box.text
      .replace("</w:pBdr>", `</w:pBdr>${last ? "" : `<w:spacing w:after="${APART}"/>`}`)
      .replace("</w:pPr></w:p>", `</w:pPr>${runs(line)}</w:p>`);

  const edits = [];
  mine.forEach((box, i) => {
    if (i < lines.length && lines[i])
      edits.push([box.at, box.at + box.text.length, written(box, lines[i], i === lines.length - 1)]);
    else if (i >= lines.length) edits.push([box.at, box.at + box.text.length, ""]);
  });

  const spare = lines.slice(mine.length);
  if (spare.length) {
    const model = mine[mine.length - 1];
    const tail = model.at + model.text.length;
    edits.push([
      tail,
      tail,
      spare.map((line, n) => written(model, line, n === spare.length - 1)).join(""),
    ]);
  }

  let out = xml;
  edits
    .sort((a, b) => b[0] - a[0])
    .forEach(([open, close, piece]) => {
      out = out.slice(0, open) + piece + out.slice(close);
    });
  return out;
}

function runs(line, look = "") {
  return String(line)
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((bit) =>
      bit.startsWith("**") && bit.endsWith("**")
        ? run(bit.slice(2, -2), { bold: true, look })
        : run(bit, { look }),
    )
    .join("");
}

function slotsBefore(xml, label) {
  return boxesUpTo(xml, xml.indexOf(label));
}

function slotsBeforePara(xml, id) {
  return boxesUpTo(xml, xml.indexOf(`w14:paraId="${id}"`));
}

function boxesUpTo(xml, at) {
  if (at < 0) return 0;
  let n = 0;
  const box = /<w:p\b(?:(?!<\/w:p>)[\s\S])*?<w:pBdr>[\s\S]*?<\/w:pPr><\/w:p>/g;
  let found;
  while ((found = box.exec(xml))) {
    if (found.index > at) break;
    n += 1;
  }
  return n;
}

function afterLabel(xml, label, value) {
  if (!value) return xml;
  const at = xml.indexOf(`>${label}`);
  if (at < 0) return xml;
  const end = xml.indexOf("</w:p>", at);
  if (end < 0) return xml;
  return `${xml.slice(0, end)}${run(` ${value}`)}${xml.slice(end)}`;
}

function afterPara(xml, id, value) {
  if (!value || !id) return xml;
  const at = xml.indexOf(`w14:paraId="${id}"`);
  if (at < 0) return xml;
  const end = xml.indexOf("</w:p>", at);
  if (end < 0) return xml;
  return `${xml.slice(0, end)}${run(` ${value}`)}${xml.slice(end)}`;
}

function tick(xml, met, anchors = {}) {
  const id = met ? anchors.met : anchors.notYet;
  const at = id
    ? xml.indexOf(`w14:paraId="${id}"`)
    : met
      ? xml.indexOf("can confirm he/she")
      : xml.indexOf("not yet met");
  if (at < 0) return xml;
  const para = xml.lastIndexOf("<w:p ", at);
  if (para < 0) return xml;
  const body = xml.indexOf(">", xml.indexOf("<w:pPr>", para));
  const close = xml.indexOf("</w:pPr>", para);
  if (body < 0 || close < 0) return xml;
  return `${xml.slice(0, close + 8)}${run("X ", { bold: true })}${xml.slice(close + 8)}`;
}

const STAMP = new Date(Date.UTC(2013, 4, 30));
function pack(zip, xml) {
  zip["word/document.xml"] = strToU8(xml);
  const stamped = {};
  for (const [name, data] of Object.entries(zip)) stamped[name] = [data, { mtime: STAMP }];
  return zipSync(stamped, { level: 6 });
}

export function withoutGuidance(xml) {
  let start = -1;
  for (const one of xml.matchAll(/<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
    const said = [...one[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("").trim();
    if (!/^GUIDANCE NOTES\b/i.test(said)) continue;
    start = one.index;
    break;
  }
  if (start < 0) return xml;
  const end = xml.lastIndexOf("<w:sectPr");
  if (end <= start) return xml;
  return `${xml.slice(0, start)}${xml.slice(end)}`;
}

export function tighten(xml) {
  const box = /<w:p\b[^>]*>(?:(?!<\/w:p>)[\s\S])*?<w:pBdr>(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g;
  const ends = [];
  let found = box.exec(xml);
  while (found) {
    ends.push(found.index + found[0].length);
    found = box.exec(xml);
  }
  if (!ends.length) return xml;
  const tail = /^\s*(?:<w:p\b[^>]*\/>|<w:p\b[^>]*>(?:(?!<w:t[ >])(?!<\/w:p>)[\s\S])*?<\/w:p>)/;
  const cuts = [];
  for (const [n, at] of ends.entries()) {
    if (n + 1 < ends.length && xml.slice(at, ends[n + 1]).trim().length < 20) continue;
    let from = at;
    let kept = 0;
    for (;;) {
      const next = xml.slice(from).match(tail);
      if (!next || /<w:pBdr>/.test(next[0])) break;
      if (kept) cuts.push([from, from + next[0].length]);
      kept += 1;
      from += next[0].length;
    }
  }
  let out = xml;
  for (const [open, close] of cuts.sort((a, b) => b[0] - a[0])) out = out.slice(0, open) + out.slice(close);
  return out;
}

export const SHEET = { witness: 1230, observation: 875, knowledge: 1230, feedback: 860 };

const sheetsFor = (areas) => 1 + Math.floor(Math.max(0, areas - 8) / 8);
const ALONE = 560;
const PER_AREA = 70;
const MOST = 1150;
export const askFor = (kind, areas) => {
  const sheet = SHEET[kind] || 1000;
  const wanted = Math.min(MOST, ALONE + PER_AREA * Math.max(0, areas - 1), sheet * sheetsFor(areas));
  if (wanted <= sheet) return wanted;
  const sheets = Math.floor(wanted / sheet);
  const over = wanted - sheets * sheet;
  return over < sheet * 0.55 ? sheets * sheet : wanted;
};

export function withoutUnasked(xml, used) {
  const para = /<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  const all = [...xml.matchAll(para)];
  const said = (p) => [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("").trim();
  const spans = [];
  for (let i = 0; i < all.length; i += 1) {
    const numbered = said(all[i][0]).match(/^Q(\d+):?$/);
    if (!numbered || Number(numbered[1]) <= used) continue;
    let end = i;
    for (let k = i + 1; k < all.length && k <= i + 6; k += 1) {
      const text = said(all[k][0]);
      if (/^A:?$/.test(text)) { end = k; break; }
      if (text) break;
    }
    spans.push([i, end]);
  }
  if (!spans.length) return xml;
  let out = xml;
  spans.reverse().forEach(([from, to]) => {
    const open = all[from].index;
    const close = all[to].index + all[to][0].length;
    out = out.slice(0, open) + out.slice(close);
  });
  return out;
}

export function trimTail(xml) {
  const end = xml.lastIndexOf("<w:sectPr");
  if (end < 0) return xml;
  const para = /<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  const body = xml.slice(0, end);
  const all = [...body.matchAll(para)];
  let cut = end;
  for (let i = all.length - 1; i >= 0; i -= 1) {
    const one = all[i];
    if (/<w:t[ >]/.test(one[0])) break;
    if (xml.slice(one.index + one[0].length, cut).replace(/\s/g, "")) break;
    cut = one.index;
  }
  return cut >= end ? xml : `${xml.slice(0, cut)}${xml.slice(end)}`;
}

const shortDate = (iso) => {
  const [y, m, d] = String(iso || "").split("-");
  return y && m && d ? `${d}/${m}/${y.slice(2)}` : "";
};

function fillTrip(xml, doc, content, anchors) {
  const said = (slot, value) => { xml = intoCell(xml, anchors[slot], value); };
  said("assesseeName", doc.crew || "");
  said("assesseeRole", doc.position || "");
  said("worksite", doc.vessel || "");
  said("assessorName", doc.supervisor || "");
  said("assessorRole", doc.supervisorPosition || "");
  said("tripDates", doc.start && doc.end ? `${shortDate(doc.start)} – ${shortDate(doc.end)}` : "");
  said("workscope", doc.workScope || "");

  KEYS.forEach((key, i) => {
    const row = i + 1;
    const mark = content.criteria?.[key];
    if (!mark) return;
    xml = tickScore(xml, anchors, row, mark.score);
    xml = intoCell(xml, anchors[`note${row}`], mark.comment || "");
  });
  if (anchors.note12) xml = intoCell(xml, anchors.note12, "N/A");

  if (content.text) xml = intoCells(xml, anchors.assessorSaid, content.text);
  if (content.own) xml = intoCells(xml, anchors.assesseeSaid, content.own);
  return trimTail(xml);
}

export async function fillForm(kind, doc, content = {}) {
  const zip = unzipSync(await template(kind));
  let xml = strFromU8(zip["word/document.xml"]);
  const anchors = anchorsFor(kind);
  xml = withoutGuidance(xml);

  if (kind === "trip") return pack(zip, fillTrip(xml, doc, content, anchors));

  if (doc.ref) {
    const boxes = anchors.ref || [];
    if (boxes.length) {
      for (const id of boxes) {
        const para = paraById(xml, id);
        if (para) xml = xml.replace(para, para.replace(/>WT00</g, `>${escape(doc.ref)}<`));
      }
    } else xml = xml.split(">WT00<").join(`>${escape(doc.ref)}<`);
  }

  const who = kind === "witness" ? doc.witness : doc.assessor;
  const role = kind === "witness" ? doc.witnessPosition : doc.assessorPosition;
  const bond = kind === "witness" ? doc.witnessRelationship : doc.assessorRelationship;
  const site = [role, doc.site].filter(Boolean).join(" — ");

  const named = {
    witness: ["WITNESS", "POSITION &amp; SITE", "NAME FOR WHOM TESTIMONY IS FOR", "RELATIONSHIP WITH CANDIDATE"],
    observation: ["ASSESSOR", "POSITION &amp; SITE", "NAME OF CANDIDATE OBSERVED", "RELATIONSHIP WITH CANDIDATE"],
    knowledge: ["ASSESSOR", "POSITION &amp; SITE", "CANDIDATE QUESTIONED", "RELATIONSHIP WITH CANDIDATE"],
    feedback: ["ASSESSOR", "POSITION &amp; SITE", "CANDIDATE", "RELATIONSHIP WITH CANDIDATE"],
  }[kind];
  const SLOTS = ["signer", "position", "candidate", "bond"];
  [...named.keys()]
    .sort((a, b) => named[b].length - named[a].length)
    .forEach((i) => {
      const value = [who, site, doc.candidate, bond][i];
      const id = anchors[SLOTS[i]];
      xml = id ? onAnchor(xml, id, value) : onLine(xml, named[i], value);
    });

  if (kind === "knowledge") {
    const asked = content.questions || [];
    asked.forEach((qa, i) => {
      const q = anchors[`q${i + 1}`];
      const a = anchors[`a${i + 1}`];
      if (q) xml = afterPara(xml, q, qa.q);
      else xml = afterLabel(xml, `Q${i + 1}:`, qa.q);
      if (!qa.a) return;
      if (a) { xml = afterPara(xml, a, qa.a); return; }
      const at = xml.indexOf(`Q${i + 1}:`);
      if (at < 0) return;
      const next = xml.indexOf(">A:", at);
      if (next < 0) return;
      const end = xml.indexOf("</w:p>", next);
      xml = `${xml.slice(0, end)}${run(` ${qa.a}`)}${xml.slice(end)}`;
    });
    xml = withoutUnasked(xml, asked.filter((qa) => String(qa?.q || "").trim()).length);
  } else if (kind === "feedback") {
    const split = anchors.split
      ? slotsBeforePara(xml, anchors.split)
      : slotsBefore(xml, "comments in relation to the CAAP scheme");
    xml = intoBox(xml, content.own, { from: split });
    xml = intoBox(xml, content.text, { from: 0, take: split });
    xml = tick(xml, doc.outcome === "met", anchors);
  } else {
    xml = intoBox(xml, content.text);
  }

  xml = tighten(xml);
  xml = trimTail(xml);

  return pack(zip, xml);
}

export const CODES = {
  trip: "NW-CAP-001",
  witness: "NW-CAP-001",
  observation: "NW-CAP-001",
  knowledge: "NW-CAP-001",
  feedback: "NW-CAP-001",
};

export const formName = (kind, doc) =>
  `${CODES[kind]} ${(kind === "trip" ? doc.crew : doc.candidate) || "candidate"}.docx`;
