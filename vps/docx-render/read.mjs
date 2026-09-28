import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";

const run = promisify(execFile);

const PAGES = 24;
const OCR_MS = 240_000;

const head = (bytes, n) => Buffer.from(bytes.subarray(0, n)).toString("hex").toUpperCase();

export function shapeOf(bytes, name = "") {
  const magic = head(bytes, 8);
  const ext = String(name).toLowerCase().split(".").pop();
  if (magic.startsWith("25504446")) return "pdf";
  if (magic.startsWith("89504E47")) return "image";
  if (magic.startsWith("FFD8FF")) return "image";
  if (magic.startsWith("D0CF11E0")) return ext === "xls" ? "sheet-old" : "word-old";
  if (magic.startsWith("504B")) return "zip";
  return "unknown";
}

const tidy = (t) =>
  String(t || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

function wordliness(text) {
  const toks = String(text).split(/\s+/).filter(Boolean);
  if (toks.length < 15) return 0;
  const words = toks.filter((t) => /^[A-Za-z][A-Za-z'-]{2,}$/.test(t.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "")));
  return words.length / toks.length;
}
const READABLE = 0.4;

async function readPicture(file) {
  let best = "";
  let score = 0;
  for (const mode of ["1", "6"]) {
    let text = "";
    try {
      ({ stdout: text } = await run("tesseract", [file, "-", "--psm", mode], {
        timeout: OCR_MS,
        maxBuffer: 16 * 1024 * 1024,
      }));
    } catch {
      continue;
    }
    const s = wordliness(text);
    if (s > score) {
      score = s;
      best = text;
    }
    if (score >= 0.7) break;
  }
  return score >= READABLE ? best : "";
}

async function readPictures(files) {
  let out = "";
  for (const file of files) out += `${await readPicture(file)}\n`;
  return out;
}

async function fromPdf(dir, file) {
  let layer = "";
  try {
    ({ stdout: layer } = await run("pdftotext", ["-q", file, "-"], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }));
  } catch {
    /* no text layer, or a PDF the text reader dislikes: draw it instead */
  }
  const written = layer.replace(/\s/g, "").length >= 200 ? wordliness(layer) : 0;
  if (written >= 0.7) return layer;

  await run("pdftoppm", ["-r", "200", "-gray", "-png", "-f", "1", "-l", String(PAGES), file, join(dir, "pg")], {
    timeout: OCR_MS,
  });
  const shots = (await readdir(dir)).filter((f) => f.startsWith("pg-") && f.endsWith(".png")).sort();
  const drawn = await readPictures(shots.map((f) => join(dir, f)));
  return wordliness(drawn) >= written ? drawn : layer;
}

async function fromOldWord(dir, file) {
  try {
    const { stdout } = await run("antiword", ["-w", "0", file], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
    if (stdout.trim().length > 40) return stdout;
  } catch {
    /* fall through */
  }
  await run(
    "soffice",
    [`-env:UserInstallation=file://${join(dir, "p")}`, "--headless", "--norestore",
     "--convert-to", "txt:Text (encoded):UTF8", "--outdir", dir, file],
    { timeout: 120_000 },
  );
  const txt = (await readdir(dir)).find((f) => f.endsWith(".txt"));
  return txt ? await readFile(join(dir, txt), "utf8") : "";
}

const entities = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");

function fromSheet(zip) {
  const shared = zip["xl/sharedStrings.xml"];
  const lines = [];
  if (shared) {
    for (const cell of strFromU8(shared).split("</si>")) {
      const text = entities([...cell.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]).join(""));
      if (text.trim()) lines.push(text.trim());
    }
  }
  for (const [name, part] of Object.entries(zip)) {
    if (!/^xl\/worksheets\/.*\.xml$/.test(name)) continue;
    const nums = [...strFromU8(part).matchAll(/<c[^>]*(?!t="s")[^>]*><v>([\d.]+)<\/v><\/c>/g)].map((m) => m[1]);
    if (nums.length) lines.push(nums.join(" "));
  }
  return lines.join("\n");
}

async function fromWordPictures(dir, zip) {
  const media = Object.keys(zip).filter((n) => /^word\/media\/.*\.(png|jpe?g)$/i.test(n)).slice(0, PAGES);
  if (!media.length) return "";
  const files = [];
  for (const [i, name] of media.entries()) {
    const file = join(dir, `m${i}.${name.split(".").pop()}`);
    await writeFile(file, Buffer.from(zip[name]));
    files.push(file);
  }
  return readPictures(files);
}

function fromWord(zip) {
  const part = zip["word/document.xml"];
  if (!part) return "";
  const xml = strFromU8(part).replace(/<w:tab[^>]*\/>/g, "\t").replace(/<\/w:p>/g, "\n");
  return entities(xml.replace(/<[^>]+>/g, ""));
}

export async function wordsOf(bytes, name = "") {
  const shape = shapeOf(bytes, name);
  if (shape === "unknown") return "";
  const dir = await mkdtemp(join(tmpdir(), "read-"));
  try {
    const file = join(dir, "f");
    await writeFile(file, bytes);
    if (shape === "pdf") return tidy(await fromPdf(dir, file));
    if (shape === "image") return tidy(await readPictures([file]));
    if (shape === "word-old" || shape === "sheet-old") return tidy(await fromOldWord(dir, file));
    if (shape === "zip") {
      const zip = unzipSync(new Uint8Array(bytes));
      if (zip["xl/workbook.xml"]) return tidy(fromSheet(zip));
      const words = fromWord(zip);
      if (words.replace(/\s/g, "").length >= 40) return tidy(words);
      return tidy(await fromWordPictures(dir, zip));
    }
    return "";
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
