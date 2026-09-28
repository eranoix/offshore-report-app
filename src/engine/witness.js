import frameworks from "./caap.json";
import taskBook from "./tasks.json";
import crfData from "./crf.json";

export const unitsFor = (role) => frameworks[role] || {};

const join = (list) =>
  list.length <= 1
    ? list[0] || ""
    : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;

export function draft(doc, covered = []) {
  const who = doc.candidate || "the candidate";
  const site = doc.site || "the worksite";
  const task = (doc.task || "").trim();

  const areas = covered.map((c) => `**${c.text.replace(/\.$/, "")}**`);

  const jobs = task
    .split(/\s*;\s*/)
    .filter(Boolean)
    .map((t) => {
      const one = t.replace(/\.$/, "");
      return `**${one.charAt(0).toLowerCase()}${one.slice(1)}**`;
    });
  const opening = jobs.length
    ? `I worked with ${who} on board ${site}, where he ${join(jobs)}.`
    : `I worked with ${who} on board ${site}.`;
  const body = `${who} carried out the work to the standard the job required, without direction beyond the brief.`;
  const scheme = areas.length
    ? `The work covered ${join(areas)}.`
    : "";
  const close = `In my opinion ${who} is competent in the areas described above, and I am satisfied this is an accurate record of what I saw.`;

  return [opening, body, scheme, close].filter(Boolean).join("\n\n");
}


const SHORT = {
  "ROV Pilot Technician": "PT",
  "ROV Sub-Engineer": "SE",
  "ROV Supervisor": "SUP",
  "ROV Superintendent": "SUPT",
};
export const shortRole = (role) => SHORT[role] || role;

const key = (text) =>
  String(text).toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

const ASKED_BY = (() => {
  const map = new Map();
  for (const [role, units] of Object.entries(frameworks))
    for (const list of Object.values(units))
      for (const text of list) {
        const k = key(text);
        if (!map.has(k)) map.set(k, new Set());
        map.get(k).add(role);
      }
  return map;
})();

export const levelsFor = (text) => [...(ASKED_BY.get(key(text)) || [])];

export function groupedCriteria(role) {
  return Object.entries(unitsFor(role)).map(([unit, list]) => ({
    unit,
    items: list.map((text) => ({ unit, text, levels: levelsFor(text) })),
  }));
}

export function questionFrom(text) {
  const t = String(text).replace(/\.$/, "").trim();
  const lower = t.charAt(0).toLowerCase() + t.slice(1);
  if (/^(knowledge|working knowledge|understanding|awareness)\b/i.test(t))
    return `What do you know about ${lower.replace(/^(working )?knowledge of\s*/i, "").replace(/^understanding of\s*/i, "").replace(/^awareness of\s*/i, "")}?`;
  if (/^demonstrate(s)? (the )?(ability|capability|a )/i.test(t))
    return `Talk me through how you ${lower.replace(/^demonstrates? (the )?(ability|capability) to\s*/i, "").replace(/^demonstrates? a\s*/i, "show ")}.`;
  if (/^(ensure|conduct|initiate|attend|report|prepare|plan|carry|perform|operate|maintain|check|identify|liaise|co-?ordinate|actively|utilise|select|use|apply)/i.test(t))
    return `How do you ${lower}?`;
  return `Tell me about ${lower}.`;
}

export const crfCriteria = (role) => crfData[role] || [];

export const LEVELS = [
  { level: "ROV Pilot Technician", caap: "ROV Pilot Technician", crf: "ROV Pilot Technician" },
  { level: "ROV Submersible Technician", caap: "ROV Sub-Engineer", crf: "ROV Submersible Technician" },
  { level: "ROV Supervisor", caap: "ROV Supervisor", crf: "ROV Supervisor" },
  { level: "ROV Superintendent", caap: "ROV Superintendent", crf: null },
];

export const levelNamed = (name) => LEVELS.find((l) => l.level === name) || LEVELS[0];

export const SCHEMES = {
  caap: { key: "caap", label: "CAAP", full: "CAAP framework", noun: "criteria", one: "criterion" },
  crf: { key: "crf", label: "CRF", full: "Competence Record Form", noun: "competences", one: "competence" },
};

export function topicsFor(level, scheme) {
  if (scheme === "crf") {
    if (!level.crf) return [];
    const unit = `${level.crf} — Competence Record Form`;
    return [{ unit, items: crfCriteria(level.crf).map((text) => ({ unit, text, levels: [] })) }];
  }
  return groupedCriteria(level.caap);
}

export function tasksFor(role, every = false) {
  const names = taskBook.roles[role]?.length ? taskBook.roles[role] : Object.keys(taskBook.groups);
  const mine = (t) => {
    const text = typeof t === "string" ? t : t.text;
    const levels = typeof t === "string" ? [] : t.levels || [];
    const proves = typeof t === "string" ? [] : t.proves || [];
    return { text, levels, proves, has: !levels.length || levels.includes(role) };
  };
  return (every ? Object.keys(taskBook.groups) : names)
    .map((unit) => ({
      unit,
      items: (taskBook.groups[unit] || [])
        .map(mine)
        .filter((t) => every || t.has)
        .map((t) => ({ unit, text: t.text, levels: t.levels, proves: t.proves })),
    }))
    .filter((g) => g.items.length);
}

export const topicCount = (level, scheme) =>
  topicsFor(level, scheme).reduce((n, g) => n + g.items.length, 0);
