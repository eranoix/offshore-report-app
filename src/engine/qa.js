export const asQA = (list = []) => {
  const said = (Array.isArray(list) ? list : []).map((qa) => ({ q: qa?.q || "", a: qa?.a || "" }));
  while (said.length && !said[said.length - 1].q && !said[said.length - 1].a) said.pop();
  return said.map((qa, i) => `Q${i + 1}: ${qa.q}\nA${i + 1}: ${qa.a}`).join("\n\n").trim();
};

export function fromQA(text, least = 4) {
  const said = String(text || "");
  const label = /(^|[\s])([QA])\s*(\d*)\s*[:.)-]\s*/gi;
  const marks = [];
  let hit = label.exec(said);
  while (hit) {
    marks.push({ at: hit.index + hit[1].length, end: hit.index + hit[0].length, side: hit[2].toLowerCase() });
    hit = label.exec(said);
  }
  const out = [];
  if (!marks.length) {
    if (said.trim()) out.push({ q: said.trim().replace(/\s+/g, " "), a: "" });
  } else {
    if (said.slice(0, marks[0].at).trim()) out.push({ q: said.slice(0, marks[0].at).trim(), a: "" });
    marks.forEach((m, n) => {
      const body = said.slice(m.end, n + 1 < marks.length ? marks[n + 1].at : undefined).trim().replace(/\s+/g, " ");
      if (m.side === "q") out.push({ q: body, a: "" });
      else if (out.length) out[out.length - 1].a = body;
      else out.push({ q: "", a: body });
    });
  }
  while (out.length < least) out.push({ q: "", a: "" });
  return out;
}
