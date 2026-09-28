import { unzipSync, strFromU8 } from "fflate";

export const SHEET = "SEATAX DAYS";

export const COLUMNS = [
  "Day Left UK",
  "Day Return UK",
  "Days Out",
  "Days In",
  "Total Days",
  "Half Days",
  "Running Days In UK",
  "YES / NO",
  "FAIL DATE",
  "FORREIGN PORT OF CALL DATE",
  "DAYS IN HAND",
];

export const COMPUTED = ["C", "D", "E", "F", "G", "H", "I", "K"];

const LETTERS = "ABCDEFGHIJK".split("");
const un = (s) =>
  String(s)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const CELL = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
const at = (attrs, name) => (attrs.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1] || "";

const nameOf = (attrs) => {
  const ref = at(attrs, "r");
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  return m ? { ref, col: m[1], row: Number(m[2]) } : { ref, col: "", row: 0 };
};

function said(inner, strings) {
  const kind = inner.type;
  if (kind === "s") {
    const v = (inner.body.match(/<v>([^<]*)<\/v>/) || [])[1];
    return strings[Number(v)] ?? "";
  }
  if (kind === "inlineStr") {
    return [...inner.body.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => un(m[1])).join("");
  }
  return un((inner.body.match(/<v>([^<]*)<\/v>/) || [])[1] || "");
}

function stringsOf(zip) {
  const part = zip["xl/sharedStrings.xml"];
  if (!part) return [];
  const xml = strFromU8(part);
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => un(t[1])).join(""),
  );
}

export function sheetsOf(zip) {
  const book = zip["xl/workbook.xml"];
  const rels = zip["xl/_rels/workbook.xml.rels"];
  if (!book || !rels) return {};
  const where = {};
  for (const m of strFromU8(rels).matchAll(/<Relationship\b([^>]*)\/>/g)) {
    where[at(m[1], "Id")] = at(m[1], "Target").replace(/^\/?xl\//, "").replace(/^\//, "");
  }
  const out = {};
  for (const m of strFromU8(book).matchAll(/<sheet\b([^>]*?)\/>/g)) {
    const id = at(m[1], "r:id") || at(m[1], "id");
    const part = where[id];
    if (part) out[un(at(m[1], "name"))] = `xl/${part}`;
  }
  return out;
}

function cellsOf(xml, strings) {
  const out = new Map();
  for (const m of xml.matchAll(CELL)) {
    const attrs = m[1];
    const body = m[2] || "";
    const { ref, col, row } = nameOf(attrs);
    if (!col) continue;
    out.set(ref, {
      ref,
      col,
      row,
      formula: /<f\b/.test(body),
      holds: /<v>|<is\b/.test(body),
      text: said({ type: at(attrs, "t"), body }, strings),
    });
  }
  return out;
}

export function headingsOf(bytes) {
  const zip = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const part = sheetsOf(zip)[SHEET];
  if (!part || !zip[part]) return [];
  const cells = cellsOf(strFromU8(zip[part]), stringsOf(zip));
  return LETTERS.map((c) => cells.get(`${c}1`)?.text.trim() || "");
}

export function whyRefuse(bytes) {
  let zip;
  try {
    zip = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  } catch {
    return [{ code: "shape", cell: "", why: "that file is not a workbook at all" }];
  }
  const part = sheetsOf(zip)[SHEET];
  if (!part || !zip[part]) {
    return [{
      code: "sheet",
      cell: "",
      why: `the sheet called “${SHEET}” is not in this workbook any more, and every day counted is on it`,
    }];
  }

  const strings = stringsOf(zip);
  const cells = cellsOf(strFromU8(zip[part]), strings);
  const out = [];

  LETTERS.forEach((col, i) => {
    const want = COLUMNS[i];
    const got = cells.get(`${col}1`)?.text.trim() || "";
    if (got === want) return;
    out.push({
      code: "heading",
      cell: `${col}1`,
      why: got
        ? `${col}1, the heading over the ${col} column, should say “${want}” and says “${got}” — the columns are known by their names`
        : `${col}1 is empty, and it is the heading “${want}” — the columns are known by their names`,
    });
  });

  for (const cell of cells.values()) {
    if (cell.row < 2) continue;
    if (!COMPUTED.includes(cell.col)) continue;
    if (cell.formula || !cell.holds) continue;
    const heading = COLUMNS[LETTERS.indexOf(cell.col)] || cell.col;
    out.push({
      code: "typed",
      cell: cell.ref,
      why: `${cell.ref} has “${String(cell.text).slice(0, 24)}” typed into it, and ${cell.ref} is where “${heading}” works itself out`
        + " — typed over, it is that answer for ever, and nothing would say so",
    });
  }

  return out;
}
