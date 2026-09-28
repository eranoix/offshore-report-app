import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "fflate";

const FORMS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "forms");
const PARA = /<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
const TBL = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
const ROW = /<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g;
const CELL = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g;
const idOf = (p) => (p.match(/w14:paraId="([0-9A-Fa-f]+)"/) || [])[1] || "";
const said = (p) =>
  [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("").replace(/&amp;/g, "&");
const flat = (t) => t.replace(/\s+/g, " ").trim();

function tablesOf(xml) {
  return [...xml.matchAll(TBL)].map((t) => {
    if (t[0].slice(6).includes("<w:tbl>")) throw new Error("a table inside a table — this reading cannot do that");
    return [...t[0].matchAll(ROW)].map((r) =>
      [...r[0].matchAll(CELL)].map((c) => {
        const paras = [...c[0].matchAll(PARA)].map((p) => ({ id: idOf(p[0]), text: said(p[0]) }));
        return { text: flat(paras.map((p) => p.text).join(" ")), ids: paras.map((p) => p.id).filter(Boolean) };
      }));
  });
}

function rightOf(tables, label, nth = 0) {
  let seen = 0;
  for (const table of tables) {
    for (const row of table) {
      for (let i = 0; i < row.length; i += 1) {
        if (flat(row[i].text).toLowerCase() !== label.toLowerCase()) continue;
        if (seen++ !== nth) continue;
        return row[i + 1] || null;
      }
    }
  }
  return null;
}

const LINES = {
  witness: ["WITNESS", "POSITION & SITE", "NAME FOR WHOM TESTIMONY IS FOR", "RELATIONSHIP WITH CANDIDATE"],
  observation: ["ASSESSOR", "POSITION & SITE", "NAME OF CANDIDATE OBSERVED", "RELATIONSHIP WITH CANDIDATE"],
  knowledge: ["ASSESSOR", "POSITION & SITE", "CANDIDATE QUESTIONED", "RELATIONSHIP WITH CANDIDATE"],
  feedback: ["ASSESSOR", "POSITION & SITE", "CANDIDATE", "RELATIONSHIP WITH CANDIDATE"],
};
const SLOTS = ["signer", "position", "candidate", "bond"];

const out = {};
const short = [];
for (const kind of ["witness", "observation", "knowledge", "feedback", "trip"]) {
  const zip = unzipSync(new Uint8Array(readFileSync(join(FORMS, `${kind}.docx`))));
  const xml = strFromU8(zip["word/document.xml"]);
  const paras = [...xml.matchAll(PARA)].map((m) => ({ id: idOf(m[0]), text: said(m[0]) }));
  const anchors = {};
  const missing = [];

  if (LINES[kind]) {
    const order = LINES[kind]
      .map((label, i) => ({ label, slot: SLOTS[i] }))
      .sort((a, b) => b.label.length - a.label.length);
    const taken = new Set();
    for (const { label, slot } of order) {
      const want = new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`, "i");
      const found = paras.find((p) => p.id && !taken.has(p.id) && want.test(p.text));
      if (found) { anchors[slot] = found.id; taken.add(found.id); }
      else missing.push(slot);
    }
  }

  if (kind === "witness") {
    const refs = paras.filter((p) => /^\s*WT00\s*$/.test(p.text) && p.id);
    if (refs.length) anchors.ref = refs.map((p) => p.id);
    else missing.push("ref");
  }

  if (kind === "knowledge") {
    for (let n = 1; n <= 4; n += 1) {
      const at = paras.findIndex((p) => new RegExp(`^\\s*Q${n}:`).test(p.text));
      if (at < 0) { missing.push(`q${n}`); continue; }
      anchors[`q${n}`] = paras[at].id;
      const answer = paras.slice(at + 1, at + 7).find((p) => /^\s*A:?\s*$/.test(p.text));
      if (answer) anchors[`a${n}`] = answer.id;
      else missing.push(`a${n}`);
    }
  }

  if (kind === "feedback") {
    const split = paras.find((p) => /comments in relation to the CAAP scheme/i.test(p.text));
    if (split) anchors.split = split.id;
    else missing.push("split");
    const met = paras.find((p) => /can confirm he\/she/i.test(p.text));
    const notYet = paras.find((p) => /not yet\s*$|not\s+yet\b/i.test(p.text) && p !== met);
    if (met) anchors.met = met.id;
    else missing.push("met");
    if (notYet) anchors.notYet = notYet.id;
    else missing.push("notYet");
  }

  if (kind === "trip") {
    const tables = tablesOf(xml);
    const put = (slot, cell) => {
      if (cell && cell.ids.length) anchors[slot] = cell.ids[0];
      else missing.push(slot);
    };

    put("assesseeName", rightOf(tables, "Assessee Name"));
    put("assesseeRole", rightOf(tables, "Position/Job Title", 0));
    put("worksite", rightOf(tables, "Worksite/Vessel"));
    put("assessorName", rightOf(tables, "Assessor Name"));
    put("assessorRole", rightOf(tables, "Position/Job Title", 1));
    put("tripDates", rightOf(tables, "Date of Assessment from/To"));
    put("workscope", rightOf(tables, "Workscope"));

    const HEAD = ["Criteria", "1", "2", "3", "4", "5", "Comments"];
    const grid = tables.find((t) =>
      t[0] && t[0].length === HEAD.length && t[0].every((c, i) => flat(c.text) === HEAD[i]));
    if (!grid) missing.push("the criteria grid");
    else {
      const rows = grid.slice(1);
      if (rows.length !== 12) missing.push(`the grid has ${rows.length} criteria, not 12`);
      rows.forEach((row, i) => {
        const n = i + 1;
        for (let col = 1; col <= 5; col += 1) put(`score${n}_${col}`, row[col]);
        put(`note${n}`, row[6]);
      });
    }

    const boxUnder = (heading) => {
      const table = tables.find((t) => t[0] && t[0].length === 1 && flat(t[0][0].text) === heading);
      return table && table[1] ? table[1][0] : null;
    };
    for (const [slot, heading] of [["assessorSaid", "Assessor Comments"], ["assesseeSaid", "Assessee Comments"]]) {
      const box = boxUnder(heading);
      if (box && box.ids.length) anchors[slot] = box.ids;
      else missing.push(slot);
    }

    const onshore = tables.find((t) => t[0] && t[0].length === 1 && flat(t[0][0].text) === "Onshore Crewing Department");
    if (!onshore) missing.push("the onshore block");
    else {
      put("onshoreDate", rightOf([onshore], "Date Received"));
      put("onshoreName", rightOf([onshore], "Crewing Department Name"));
    }
  }

  out[kind] = anchors;
  const n = Object.keys(anchors).length;
  console.log(`${kind.padEnd(12)} ${n} anchor(s)${missing.length ? `  MISSING: ${missing.join(" ")}` : ""}`);
  for (const [slot, id] of Object.entries(anchors)) {
    const ids = Array.isArray(id) ? id : [id];
    const text = paras.find((p) => p.id === ids[0])?.text.trim().slice(0, 52) || "";
    console.log(`   ${slot.padEnd(12)} ${ids.join(" ")}  ${JSON.stringify(text)}`);
  }
  if (missing.length) short.push(`${kind}: ${missing.join(" ")}`);
}

if (short.length) {
  console.error(`\nNOTHING WRITTEN — ${short.length} form(s) are short of anchors:`);
  for (const line of short) console.error(`  ${line}`);
  process.exit(1);
}

writeFileSync(
  join(FORMS, "anchors.js"),
  `/* Generated by scripts/anchors.mjs from the blank forms. Do not edit.
   Where each value goes, named by the paragraph's own w14:paraId rather than
   by the label printed on it — so the wording can be changed without the
   filling losing its place. Regenerate whenever a form changes. */\nexport const ANCHORS = ${JSON.stringify(out, null, 1)};\n`,
);
console.log("\n-> src/forms/anchors.js");
