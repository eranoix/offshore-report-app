import { holidaysIn } from "./holidays.js";

export const dayOf = (iso) =>
  Date.UTC(+String(iso).slice(0, 4), +String(iso).slice(5, 7) - 1, +String(iso).slice(8, 10)) / 864e5;

export const isoOf = (day) => new Date(day * 864e5).toISOString().slice(0, 10);

export const BLANK_PLAN = {
  v: 1,
  who: "",
  pattern: null,
  anchor: new Date().toISOString().slice(0, 10),
  horizon: 8,
  slips: {},
  days: {},
  dates: [],
  holidays: { country: "BR", own: [] },
};

const whole = (n, fallback) => (Number.isFinite(+n) && +n > 0 ? Math.round(+n) : fallback);
const spare = (n) => (Number.isFinite(+n) && +n > 0 ? Math.round(+n) : 0);

export const STATES = [
  { key: "out", label: "Travelling out", short: "Out", mark: "✈️", away: true },
  { key: "hotel", label: "In a hotel", short: "Hotel", mark: "🏨", away: true },
  { key: "aboard", label: "Aboard", short: "Aboard", mark: "⚓", away: true },
  { key: "back", label: "Travelling home", short: "Back", mark: "🛬", away: true },
  { key: "home", label: "At home", short: "Home", mark: "🏠", away: false },
];
export const STATE = Object.fromEntries(STATES.map((s) => [s.key, s]));
STATE.none = { key: "none", label: "Not planned", short: "", mark: "", away: false };

export const SUGGESTED = { on: 28, off: 28, hotelOut: 0, hotelBack: 0, travel: 0 };

export const hasRotation = (plan) => Boolean(plan?.pattern && plan?.anchor);

export function patternOf(plan = BLANK_PLAN) {
  const p = plan?.pattern || {};
  return {
    on: whole(p.on, 28),
    off: whole(p.off, 28),
    hotelOut: spare(p.hotelOut ?? plan?.hotelOut),
    hotelBack: spare(p.hotelBack ?? plan?.hotelBack),
    travel: spare(p.travel ?? plan?.travel),
  };
}

export const cycleOf = (plan = BLANK_PLAN) => {
  const p = patternOf(plan);
  return p.on + p.hotelBack + p.travel + p.off;
};

function turnAt({ hotelOut = 0, hotelBack = 0, travel = 0 }, from, to, homeDays) {
  const lodgedTo = to + hotelBack;
  const flownTo = lodgedTo + travel;
  const homeFrom = flownTo + 1;
  const homeTo = homeFrom + homeDays - 1;
  const legs = [
    { state: "out", first: from - hotelOut - travel, last: from - hotelOut - 1 },
    { state: "hotel", first: from - hotelOut, last: from - 1 },
    { state: "aboard", first: from, last: to },
    { state: "hotel", first: to + 1, last: lodgedTo },
    { state: "back", first: lodgedTo + 1, last: flownTo },
    { state: "home", first: homeFrom, last: homeTo },
  ]
    .filter((l) => l.last >= l.first)
    .map((l) => ({
      state: l.state, from: isoOf(l.first), to: isoOf(l.last), days: l.last - l.first + 1,
    }));
  return {
    aboard: { from: isoOf(from), to: isoOf(to), days: to - from + 1, marks: [] },
    home: { from: isoOf(homeFrom), to: isoOf(homeTo), days: homeTo - homeFrom + 1, marks: [] },
    legs,
  };
}

export function turnsOf(plan = BLANK_PLAN, { count } = {}) {
  if (!hasRotation(plan)) return [];
  const { on, off, hotelOut, hotelBack, travel } = patternOf(plan);
  const cycle = on + hotelBack + travel + off;
  const start = dayOf(plan?.anchor || BLANK_PLAN.anchor);
  const many = whole(count ?? plan?.horizon, 8);
  const slips = plan?.slips || {};

  const out = [];
  let next = start;
  for (let n = 1; n <= many; n += 1) {
    const slip = slips[String(n)] || {};
    const from = slip.from ? dayOf(slip.from) : next;
    const to = slip.to ? dayOf(slip.to) : from + on - 1;
    const turn = turnAt({ hotelOut, hotelBack, travel }, from, to, off);
    out.push({
      n,
      ...turn,
      moved: from - (start + (n - 1) * cycle),
      slipped: Boolean(slip.from || slip.to),
    });
    next = dayOf(turn.home.to) + 1;
  }
  return out;
}

export const cleanTurns = (plan, count) =>
  turnsOf({ ...plan, slips: {} }, { count });

const dayAndMonth = (on) => (String(on).length > 5 ? String(on).slice(5) : String(on));

export function marksOf(plan = BLANK_PLAN, fromIso, toIso, { certificates = [] } = {}) {
  const first = dayOf(fromIso);
  const last = dayOf(toIso);
  const years = [];
  for (let y = +fromIso.slice(0, 4); y <= +toIso.slice(0, 4); y += 1) years.push(y);

  const out = [];
  const keep = (on, what, sort, note = "", id = "") => {
    const day = dayOf(on);
    if (day >= first && day <= last) out.push({ on, what, sort, note, ...(id ? { id } : {}) });
  };

  for (const d of plan?.dates || []) {
    if (!d?.on || !d?.what) continue;
    const span = spanOf(d);
    const each = (start, note) => {
      for (let k = 0; k <= span; k += 1) {
        keep(isoOf(dayOf(start) + k), d.what, "family",
          span ? `${note ? `${note} · ` : ""}${k + 1}/${span + 1}` : note, d.id);
      }
    };
    if (d.every === "once" && String(d.on).length > 5) { each(d.on, ""); continue; }
    if (d.every === "repeat") { for (const s of repeatStarts(d, fromIso, toIso)) each(s, ""); continue; }
    const md = dayAndMonth(d.on);
    const born = String(d.on).length > 5 ? +String(d.on).slice(0, 4) : null;
    for (const y of (span ? [years[0] - 1, ...years] : years).filter((yy) => comesIn(d, yy))) {
      each(`${y}-${md}`, born && !span ? `${y - born}` : "");
    }
  }

  const country = plan?.holidays?.country || "BR";
  const taken = new Set(plan?.holidays?.take || []);
  for (const y of years) {
    for (const h of holidaysIn(country, y)) {
      if (taken.has(h.what)) keep(h.on, h.what, "holiday", h.observed ? "observed" : "");
    }
  }
  for (const h of plan?.holidays?.own || []) {
    if (h?.on && h?.what) keep(h.on, h.what, "holiday");
  }

  for (const c of certificates) {
    if (!c?.expires || !c?.what) continue;
    keep(c.expires, `${c.what} expires`, "certificate");
  }

  return out.sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : a.what < b.what ? -1 : 1));
}

export function landing(turns, marks) {
  const inside = (block, day) => day >= dayOf(block.from) && day <= dayOf(block.to);
  return turns.map((t) => {
    const aboard = [];
    const home = [];
    for (const m of marks) {
      const day = dayOf(m.on);
      if (inside(t.aboard, day)) aboard.push(m);
      else if (inside(t.home, day)) home.push(m);
    }
    return { ...t, aboard: { ...t.aboard, marks: aboard }, home: { ...t.home, marks: home } };
  });
}

export function nextChange(turns, todayIso) {
  const today = dayOf(todayIso);
  for (const t of turns) {
    const out = dayOf(t.aboard.from);
    if (out >= today) return { kind: "fly out", on: t.aboard.from, inDays: out - today, turn: t.n };
    const back = dayOf(t.home.from);
    if (back >= today) return { kind: "fly home", on: t.home.from, inDays: back - today, turn: t.n };
  }
  return null;
}

export const sheetsOf = (turns, perSheet) => {
  const each = whole(perSheet, 8);
  const out = [];
  for (let i = 0; i < turns.length; i += each) out.push(turns.slice(i, i + each));
  return out;
};

const middle = (list) => {
  const sorted = [...list].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[half] : Math.round((sorted[half - 1] + sorted[half]) / 2);
};

export function guessPattern(trips = []) {
  const clean = trips
    .filter((t) => t?.start && t?.end && dayOf(t.end) >= dayOf(t.start))
    .sort((a, b) => dayOf(a.start) - dayOf(b.start));
  if (clean.length < 2) return { ...SUGGESTED, anchor: BLANK_PLAN.anchor, from: clean.length };

  const on = middle(clean.map((t) => dayOf(t.end) - dayOf(t.start) + 1));
  const gaps = [];
  for (let i = 1; i < clean.length; i += 1) gaps.push(dayOf(clean[i].start) - dayOf(clean[i - 1].end) - 1);
  const off = middle(gaps) ?? 28;
  const last = clean[clean.length - 1];
  return { on, off, anchor: isoOf(dayOf(last.end) + off + 1), from: clean.length };
}

export const monthStart = (y, m) => Date.UTC(y, m, 1) / 864e5;
export const monthLength = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

export function turnsAcross(plan = BLANK_PLAN, fromIso, toIso) {
  const hs = hitchesOf(plan);
  const rota = hasRotation(plan);
  if (!hs.length && !rota) return [];
  const p = rota ? patternOf(plan) : { on: 1, off: 0, hotelOut: 0, hotelBack: 0, travel: 0 };
  const to = dayOf(toIso);
  const out = [];

  hs.forEach((h, i) => {
    const a = dayOf(h.from);
    const b = dayOf(h.to);
    const next = hs[i + 1];
    const backEnd = b + p.hotelBack + p.travel;
    const home = next ? Math.max(0, dayOf(next.from) - 1 - backEnd) : offAfter(plan, h);
    out.push({ n: i + 1, ...turnAt(p, a, b, home), moved: 0, slipped: false, hitch: h.id, confirmed: true,
      off: home, ownOff: next ? false : Number.isFinite(h.off) });
  });

  if (rota && plan?.suggest !== false) {
    const cycle = cycleOf(plan);
    const last = out[out.length - 1];
    const start = last ? dayOf(last.home.to) + 1 : dayOf(plan.anchor);
    const many = Math.min(2000, Math.max(1, Math.ceil((to - start + 1) / cycle) + 1));
    const base = last
      ? turnsOf({ ...plan, anchor: isoOf(start), slips: {} }, { count: many })
      : turnsOf(plan, { count: many });
    const dismissed = new Set(plan?.dismissed || []);
    for (const t of base) {
      const no = dismissed.has(t.aboard.from);
      out.push({
        ...t, n: out.length + 1, suggested: true, dismissed: no,
        ...(no ? { legs: [{ state: "home", from: t.legs[0].from, to: t.home.to, days: dayOf(t.home.to) - dayOf(t.legs[0].from) + 1 }] } : {}),
      });
    }
  }
  const from = dayOf(fromIso);
  return out.filter((t) => dayOf(t.home.to) >= from - cycleOf(plan) && dayOf(t.legs[0].from) <= to);
}

export function hitchesOf(plan) {
  const ok = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
  return (plan?.hitches || [])
    .filter((h) => h?.id && ok(h.from) && ok(h.to) && h.to >= h.from && dayOf(h.to) - dayOf(h.from) <= 365)
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

export function offAfter(plan, h) {
  if (Number.isFinite(h?.off) && h.off >= 0) return Math.round(h.off);
  if (!hasRotation(plan)) return 0;
  const p = patternOf(plan);
  const days = dayOf(h.to) - dayOf(h.from) + 1;
  return Math.max(0, Math.round((days * p.off) / p.on));
}

export function withHitch(plan = BLANK_PLAN, fromIso, toIso, id = `h${fromIso}`) {
  let a = fromIso;
  let b = toIso || fromIso;
  if (b < a) [a, b] = [b, a];
  const kept = (plan.hitches || []).filter((h) => h.id !== id && (h.to < a || h.from > b));
  const was = (plan.hitches || []).find((h) => h.id === id);
  const days = { ...(plan.days || {}) };
  for (const iso of Object.keys(days)) if (iso >= a && iso <= b && days[iso] === "aboard") delete days[iso];
  return { ...plan, days, hitches: [...kept, { id, from: a, to: b, ...(Number.isFinite(was?.off) ? { off: was.off } : {}) }] };
}

export function changeHitch(plan = BLANK_PLAN, id, patch) {
  return {
    ...plan,
    hitches: (plan.hitches || []).map((h) => {
      if (h.id !== id) return h;
      const next = { ...h, ...patch };
      if (patch.off === null) delete next.off;
      if (next.to < next.from) [next.from, next.to] = [next.to, next.from];
      return next;
    }),
  };
}

export const dropHitch = (plan = BLANK_PLAN, id) =>
  ({ ...plan, hitches: (plan.hitches || []).filter((h) => h.id !== id) });

export const dismissTurn = (plan = BLANK_PLAN, fromIso) =>
  ({ ...plan, dismissed: [...new Set([...(plan.dismissed || []), fromIso])] });

export const withSuggestions = (plan = BLANK_PLAN, on) =>
  ({ ...plan, suggest: Boolean(on), ...(on ? { dismissed: [] } : {}) });

export function turnsFrom(plan = BLANK_PLAN, todayIso, count) {
  const many = whole(count ?? plan?.horizon, 8);
  const first = hitchesOf(plan)[0]?.from || plan?.anchor;
  if (!first) return [];
  const cycle = cycleOf(plan);
  const all = turnsAcross(plan, first, isoOf(Math.max(dayOf(first), dayOf(todayIso)) + cycle * (many + 1)))
    .filter((t) => !t.dismissed);
  const at = Math.max(0, all.findIndex((t) => t.home.to >= todayIso));
  return all.slice(at, at + many);
}

export function statesAcross(plan = BLANK_PLAN, fromIso, toIso) {
  const from = dayOf(fromIso);
  const to = dayOf(toIso);
  const days = Math.max(0, to - from + 1);
  const out = new Array(days).fill("none");
  if (!days) return out;
  for (const leg of turnsAcross(plan, fromIso, toIso).flatMap((t) => t.legs)) {
    const first = Math.max(from, dayOf(leg.from));
    const last = Math.min(to, dayOf(leg.to));
    for (let d = first; d <= last; d += 1) out[d - from] = leg.state;
  }
  for (const [iso, state] of Object.entries(plan?.days || {})) {
    if (!STATE[state] || !/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) continue;
    const d = dayOf(iso);
    if (d >= from && d <= to) out[d - from] = state;
  }
  return out;
}

export function comesIn(d, y) {
  if ((d.skip || []).includes(y)) return false;
  if (d.first && y < d.first) return false;
  if (d.last && y > d.last) return false;
  return true;
}

export function spanOf(d) {
  if (!d?.until || String(d.on).length <= 5) return 0;
  const n = dayOf(d.until) - dayOf(d.on);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 365) : 0;
}

const weekdayOf = (day) => new Date(day * 864e5).getUTCDay();

const shiftRepeat = (r, shift) => (!r ? r : {
  ...r,
  ...(r.until ? { until: isoOf(dayOf(r.until) + shift) } : {}),
  ...(r.freq === "week" && (r.days || []).length ? { days: r.days.map((w) => (((w + shift) % 7) + 7) % 7) } : {}),
});

export function repeatStarts(d, fromIso, toIso) {
  const r = d?.repeat;
  if (!r || !d.on || String(d.on).length <= 5) return [];
  const span = spanOf(d);
  const lo = dayOf(fromIso);
  const hi = dayOf(toIso);
  const step = Math.max(1, Math.round(+r.n || 1));
  const until = r.until ? dayOf(r.until) : Infinity;
  const count = r.count ? Math.round(+r.count) : Infinity;
  const ex = new Set(d.ex || []);
  const start = dayOf(d.on);
  const got = [];
  let n = 0;
  const period = r.freq === "day" ? step : r.freq === "week" ? 7 * step : 0;
  let k = count === Infinity && period ? Math.max(0, Math.floor((lo - span - start) / period) - 1) : 0;
  for (let guard = 0; n < count && guard < 5000; guard += 1, k += 1) {
    let cands = [];
    if (r.freq === "day") cands = [start + k * step];
    else if (r.freq === "week") {
      const monday = start - ((weekdayOf(start) + 6) % 7) + k * 7 * step;
      const days = (r.days || []).length ? r.days : [weekdayOf(start)];
      cands = days.map((w) => monday + ((w + 6) % 7)).filter((c) => c >= start).sort((a, b) => a - b);
    } else if (r.freq === "month" || r.freq === "year") {
      const d0 = new Date(start * 864e5);
      const months = r.freq === "month" ? k * step : k * 12 * step;
      const at = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + months, d0.getUTCDate());
      if (new Date(at).getUTCDate() === d0.getUTCDate()) cands = [at / 864e5];
      else if (at / 864e5 > hi) break;
    } else break;
    let stop = false;
    for (const c of cands) {
      if (c > until || n >= count || c > hi) { stop = true; break; }
      n += 1;
      if (c + span >= lo && !ex.has(isoOf(c))) got.push(isoOf(c));
    }
    if (stop) break;
  }
  return got;
}

export function repeatWords(d) {
  const r = d?.repeat;
  if (!r) return "";
  const unit = { day: "day", week: "week", month: "month", year: "year" }[r.freq] || "time";
  const n = Math.max(1, Math.round(+r.n || 1));
  const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const on = r.freq === "week" && (r.days || []).length ? ` on ${[...r.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((w) => DAY[w]).join(", ")}` : "";
  const stop = r.until ? `, until ${r.until}` : r.count ? `, ${r.count} times` : "";
  return `every ${n === 1 ? unit : `${n} ${unit}s`}${on}${stop}`;
}

export function withDays(plan = BLANK_PLAN, fromIso, toIso, state) {
  let a = dayOf(fromIso);
  let b = dayOf(toIso || fromIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return plan;
  if (b < a) [a, b] = [b, a];
  b = Math.min(b, a + 365);
  let out = plan;
  for (let d = a; d <= b; d += 1) out = withDay(out, isoOf(d), state);
  return out;
}

export const saidOn = (plan, iso) => {
  const state = (plan?.days || {})[iso];
  return STATE[state] ? state : null;
};

export function withDay(plan = BLANK_PLAN, iso, state) {
  const days = { ...(plan?.days || {}) };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return plan;
  const projected = statesAcross({ ...plan, days: {} }, iso, iso)[0];
  if (state && !STATE[state]) return plan;
  if (!state || state === projected) delete days[iso];
  else days[iso] = state;
  return { ...plan, days };
}

export function tally(plan = BLANK_PLAN, fromIso, toIso, { flights = true } = {}) {
  const each = statesAcross(plan, fromIso, toIso);
  const n = { out: 0, hotel: 0, aboard: 0, back: 0, home: 0, none: 0 };
  for (const key of each) n[key] += 1;
  const travelling = n.out + n.back;
  const abroad = n.aboard + n.hotel + (flights ? travelling : 0);
  return { ...n, days: each.length, planned: each.length - n.none, travelling, abroad, inCountry: each.length - n.none - abroad };
}

export const monthTally = (plan, y, m, how) =>
  tally(plan, isoOf(monthStart(y, m)), isoOf(monthStart(y, m) + monthLength(y, m) - 1), how);
export const yearTally = (plan, y, how) =>
  tally(plan, isoOf(Date.UTC(y, 0, 1) / 864e5), isoOf(Date.UTC(y, 11, 31) / 864e5), how);

export function runsIn(plan = BLANK_PLAN, fromIso, toIso) {
  const each = statesAcross(plan, fromIso, toIso);
  const from = dayOf(fromIso);
  const out = [];
  for (let i = 0; i < each.length; i += 1) {
    const last = out[out.length - 1];
    if (last && last.state === each[i]) { last.to = isoOf(from + i); last.days += 1; }
    else out.push({ state: each[i], from: isoOf(from + i), to: isoOf(from + i), days: 1 });
  }
  const before = statesAcross(plan, isoOf(from - 1), isoOf(from - 1))[0];
  const after = statesAcross(plan, isoOf(from + each.length), isoOf(from + each.length))[0];
  return out.map((r, i) => ({
    ...r,
    whole: !((i === 0 && before === r.state) || (i === out.length - 1 && after === r.state)),
  })).filter((r) => r.state !== "none");
}

export function absencesIn(plan = BLANK_PLAN, fromIso, toIso) {
  const each = statesAcross(plan, fromIso, toIso);
  const from = dayOf(fromIso);
  const out = [];
  for (let i = 0; i < each.length; i += 1) {
    if (each[i] === "home" || each[i] === "none") continue;
    const last = out[out.length - 1];
    if (last && dayOf(last.to) === from + i - 1) { last.to = isoOf(from + i); last.days += 1; }
    else out.push({ from: isoOf(from + i), to: isoOf(from + i), days: 1 });
  }
  return out;
}

export function eventsIn(plan = BLANK_PLAN, fromIso, toIso, { certificates = [] } = {}) {
  const a = dayOf(fromIso);
  const b = dayOf(toIso);
  const out = [];
  const touches = (s, e) => dayOf(e) >= a && dayOf(s) <= b;

  for (const d of plan?.dates || []) {
    if (!d?.on || !d?.what) continue;
    const span = spanOf(d);
    const starts = [];
    if (d.every === "once" && String(d.on).length > 5) starts.push(d.on);
    else if (d.every === "repeat") starts.push(...repeatStarts(d, fromIso, toIso));
    else {
      const md = dayAndMonth(d.on);
      for (let y = +fromIso.slice(0, 4) - 1; y <= +toIso.slice(0, 4); y += 1) if (comesIn(d, y)) starts.push(`${y}-${md}`);
    }
    for (const s of starts) {
      const e = isoOf(dayOf(s) + span);
      if (touches(s, e)) {
        out.push({ key: `d:${d.id || d.what}:${s}`, id: d.id, sort: "family", what: d.what, from: s, to: e, every: d.every || "once", cat: d.cat || null, desc: d.desc || "",
          ...(d.time ? { time: d.time } : {}), ...(d.where ? { where: d.where } : {}), ...(d.every === "repeat" ? { rule: repeatWords(d) } : {}) });
      }
    }
  }

  const told = Object.entries(plan?.days || {})
    .filter(([iso, st]) => STATE[st] && /^\d{4}-\d{2}-\d{2}$/.test(iso))
    .sort(([x], [y]) => (x < y ? -1 : 1));
  let run = null;
  const close = () => {
    if (run && touches(run.from, run.to)) {
      out.push({ key: `s:${run.from}`, sort: "state", state: run.state, what: STATE[run.state].label, from: run.from, to: run.to });
    }
  };
  for (const [iso, st] of told) {
    if (run && run.state === st && dayOf(iso) === dayOf(run.to) + 1) run.to = iso;
    else { close(); run = { state: st, from: iso, to: iso }; }
  }
  close();

  for (const t of turnsAcross(plan, fromIso, toIso)) {
    if (t.dismissed || !touches(t.aboard.from, t.aboard.to)) continue;
    if (t.confirmed) {
      out.push({ key: `h:${t.hitch}`, id: t.hitch, sort: "hitch", what: "Aboard", from: t.aboard.from, to: t.aboard.to,
        days: t.aboard.days, off: t.off, ownOff: t.ownOff, homeTo: t.home.to });
    } else if (t.suggested) {
      out.push({ key: `s:${t.aboard.from}`, sort: "suggested", what: "Aboard", from: t.aboard.from, to: t.aboard.to,
        days: t.aboard.days, off: t.home.days, homeTo: t.home.to });
    }
  }

  for (const mk of marksOf({ ...plan, dates: [] }, fromIso, toIso, { certificates })) {
    out.push({ key: `${mk.sort}:${mk.on}:${mk.what}`, sort: mk.sort, what: mk.what, from: mk.on, to: mk.on, note: mk.note });
  }
  return out;
}

export function barsOf(items, firstIso, weeks) {
  const start = dayOf(firstIso);
  const pieces = [];
  for (let r = 0; r < weeks; r += 1) {
    const w0 = start + r * 7;
    const w1 = w0 + 6;
    const here = items
      .map((it) => ({ it, s: dayOf(it.from), e: dayOf(it.to) }))
      .filter(({ s, e }) => e >= w0 && s <= w1)
      .sort((x, y) => (y.e - y.s) - (x.e - x.s) || x.s - y.s);
    const taken = [];
    for (const { it, s, e } of here) {
      const c0 = Math.max(s, w0) - w0;
      const c1 = Math.min(e, w1) - w0;
      let lane = 0;
      while (taken.some((t) => t.lane === lane && t.c0 <= c1 && c0 <= t.c1)) lane += 1;
      taken.push({ lane, c0, c1 });
      pieces.push({ item: it, row: r, c0, c1, lane, head: s >= w0, tail: e <= w1 });
    }
  }
  return pieces;
}

export function moveEvent(plan = BLANK_PLAN, item, fromIso, toIso) {
  if (!item || !fromIso) return plan;
  let a = fromIso;
  let b = toIso || fromIso;
  if (b < a) [a, b] = [b, a];
  if (item.sort === "state") {
    const lifted = withDays(plan, item.from, item.to, null);
    return withDays(lifted, a, b, item.state);
  }
  if (item.sort === "hitch") return changeHitch(plan, item.id, { from: a, to: b });
  if (item.sort === "suggested") return withHitch(plan, a, b);
  if (item.sort !== "family" || !item.id) return plan;
  return {
    ...plan,
    dates: (plan.dates || []).map((d) => {
      if (d.id !== item.id) return d;
      const span = dayOf(b) - dayOf(a);
      if (d.every === "once") {
        const { until, ...rest } = d;
        return span > 0 ? { ...rest, on: a, until: b } : { ...rest, on: a };
      }
      if (d.every === "repeat") {
        const shift = dayOf(a) - dayOf(item.from);
        const on = isoOf(dayOf(d.on) + shift);
        const { until, ...rest } = d;
        return { ...rest, on, repeat: shiftRepeat(d.repeat, shift), ...(span > 0 ? { until: isoOf(dayOf(on) + span) } : {}) };
      }
      const year = String(d.on).length > 5 ? String(d.on).slice(0, 4) : "";
      if (!year) return { ...d, on: a.slice(5) };
      const on = `${year}-${a.slice(5)}`;
      const { until, ...rest } = d;
      return span > 0 ? { ...rest, on, until: isoOf(dayOf(on) + span) } : { ...rest, on };
    }),
  };
}

export const TRASH_DAYS = 30;

export function dropDate(plan = BLANK_PLAN, id, todayIso = new Date().toISOString().slice(0, 10)) {
  const gone = (plan.dates || []).find((d) => d.id === id);
  if (!gone) return plan;
  return {
    ...plan,
    dates: (plan.dates || []).filter((d) => d.id !== id),
    trash: [{ ...gone, deleted: todayIso }, ...(plan.trash || []).filter((d) => d.id !== id)],
  };
}

export function restoreDate(plan = BLANK_PLAN, id) {
  const back = (plan.trash || []).find((d) => d.id === id);
  if (!back) return plan;
  const { deleted, ...date } = back;
  return {
    ...plan,
    dates: [...(plan.dates || []).filter((d) => d.id !== id), date],
    trash: (plan.trash || []).filter((d) => d.id !== id),
  };
}

export function pruneTrash(plan = BLANK_PLAN, todayIso = new Date().toISOString().slice(0, 10)) {
  const keep = (plan.trash || []).filter((d) => dayOf(todayIso) - dayOf(d.deleted || todayIso) <= TRASH_DAYS);
  return keep.length === (plan.trash || []).length ? plan : { ...plan, trash: keep };
}

const freshOf = ({ uid, src, sig, ...d }) => d;

export function duplicateDate(plan = BLANK_PLAN, id, newId) {
  const d = (plan.dates || []).find((x) => x.id === id);
  if (!d) return plan;
  const span = spanOf(d);
  const full = String(d.on).length > 5;
  const on = full ? isoOf(dayOf(d.on) + span + 1) : d.on;
  const copy = { ...freshOf(d), id: newId, on, ...(span ? { until: isoOf(dayOf(on) + span) } : {}) };
  return { ...plan, dates: [...(plan.dates || []), copy] };
}

const MONTH_WORDS = [
  ["jan", "january"], ["feb", "february"], ["mar", "march"],
  ["apr", "april"], ["may"], ["jun", "june"],
  ["jul", "july"], ["aug", "august"], ["sep", "sept", "september"],
  ["oct", "october"], ["nov", "november"], ["dec", "december"],
];
const monthOf = (w) => {
  const x = String(w || "").toLowerCase().replace(/\.$/, "");
  const i = MONTH_WORDS.findIndex((names) => names.includes(x));
  return i < 0 ? null : i + 1;
};

export const CATEGORIES = [
  { key: "course", label: "Course", words: ["course", "training"], color: "#FBBF24" },
  { key: "family", label: "Family", words: ["family"], color: "#A78BFA" },
  { key: "health", label: "Health", words: ["health", "doctor"], color: "#34D399" },
  { key: "other", label: "Other", words: ["other"], color: "#94A3B8" },
  { key: "travel", label: "Travel", words: ["travel", "flight"], color: "#F472B6" },
  { key: "work", label: "Work", words: ["work", "job"], color: "#38BDF8" },
];
export const CATEGORY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

export function parseEvent(text, todayIso = new Date().toISOString().slice(0, 10)) {
  let rest = ` ${String(text || "").trim()} `;
  const out = { what: "", on: null, until: null, every: "once", cat: null };
  const today = dayOf(todayIso);
  const ty = +todayIso.slice(0, 4);
  const take = (re) => { const m = rest.match(re); if (m) rest = rest.replace(m[0], " "); return m; };
  const nextOf = (mo, d, y) => {
    if (y) return `${y < 100 ? 2000 + y : y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const md = `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return [ty - 1, ty, ty + 1].map((y) => `${y}-${md}`)
      .sort((a, b) => Math.abs(dayOf(a) - today) - Math.abs(dayOf(b) - today))[0];
  };
  const valid = (iso) => iso && Number.isFinite(dayOf(iso)) && isoOf(dayOf(iso)) === iso;

  const tag = take(/\s#([\p{L}]+)/u);
  if (tag) out.cat = CATEGORIES.find((c) => c.words.includes(tag[1].toLowerCase()) || c.key === tag[1].toLowerCase())?.key || null;
  if (take(/\s(every year|yearly|annually)(?=\s)/i)) out.every = "year";

  const MON = "([A-Za-z]{3,10}\\.?)";
  let m;
  if ((m = take(new RegExp(`\\s(\\d{1,2})\\s*(?:-|–|to)\\s*(\\d{1,2})\\s${MON}(?:\\s(\\d{4}))?(?=\\s)`, "i"))) && monthOf(m[3])) {
    out.on = nextOf(monthOf(m[3]), +m[1], m[4] && +m[4]);
    out.until = `${out.on.slice(0, 8)}${String(+m[2]).padStart(2, "0")}`;
  } else if ((m = take(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*(?:-|–|to)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s)/i))) {
    out.on = nextOf(+m[2], +m[1], m[3] && +m[3]);
    out.until = nextOf(+m[5], +m[4], m[6] ? +m[6] : +out.on.slice(0, 4));
    if (dayOf(out.until) < dayOf(out.on)) out.until = `${+out.until.slice(0, 4) + 1}${out.until.slice(4)}`;
  } else if ((m = take(/\s(\d{1,2})\s*[-–]\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s)/))) {
    out.on = nextOf(+m[3], +m[1], m[4] && +m[4]);
    out.until = `${out.on.slice(0, 8)}${String(+m[2]).padStart(2, "0")}`;
  } else if ((m = take(/\s(\d{4})-(\d{2})-(\d{2})(?=\s)/))) {
    out.on = `${m[1]}-${m[2]}-${m[3]}`;
  } else if ((m = take(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s)/))) {
    out.on = nextOf(+m[2], +m[1], m[3] && +m[3]);
  } else if ((m = take(new RegExp(`\\s(\\d{1,2})\\s${MON}(?:\\s(\\d{4}))?(?=\\s)`, "i"))) && monthOf(m[2])) {
    out.on = nextOf(monthOf(m[2]), +m[1], m[3] && +m[3]);
  } else if ((m = take(new RegExp(`\\s${MON}\\s(\\d{1,2})(?:,?\\s(\\d{4}))?(?=\\s)`, "i"))) && monthOf(m[1])) {
    out.on = nextOf(monthOf(m[1]), +m[2], m[3] && +m[3]);
  } else if (take(/\s(today)(?=\s)/i)) out.on = todayIso;
  else if (take(/\s(tomorrow)(?=\s)/i)) out.on = isoOf(today + 1);
  if (m && !out.on) rest = ` ${rest} ${m[0]} `;

  const len = take(/\s(?:for)\s(\d{1,3})\s(days?)(?=\s)/i);
  if (len && out.on) out.until = isoOf(dayOf(out.on) + Math.max(1, +len[1]) - 1);

  if (out.on && !valid(out.on)) out.on = null;
  if (out.until && (!valid(out.until) || !out.on || out.until <= out.on)) out.until = null;
  out.what = rest.replace(/\s+/g, " ").trim().replace(/^[-–:,]\s*/, "").replace(/\s(on|at)$/i, "");
  out.what = out.what ? out.what[0].toUpperCase() + out.what.slice(1) : "";
  return out;
}

export function changeOccurrence(plan = BLANK_PLAN, item, scope, change, newId = `d${Date.now().toString(36)}`, todayIso) {
  const d = (plan.dates || []).find((x) => x.id === item?.id);
  if (!d) return plan;
  const y = +item.from.slice(0, 4);
  const yearly = d.every === "year";
  const repeats = d.every === "repeat";
  const withMoved = (base) => {
    if (change.kind !== "move") return base;
    const span = dayOf(change.to) - dayOf(change.from);
    return { ...base, on: change.from, ...(span > 0 ? { until: change.to } : {}) };
  };
  const replaceDate = (fn) => ({ ...plan, dates: (plan.dates || []).map((x) => (x.id === d.id ? fn(x) : x)) });

  if (repeats && scope !== "all") {
    const { skip, first, last, until, uid, src, sig, ...base } = d;
    const span = spanOf(d);
    if (scope === "one") {
      const skipped = replaceDate((x) => ({ ...x, ex: [...new Set([...(x.ex || []), item.from])] }));
      if (change.kind === "delete") return skipped;
      const { repeat, ex, ...plain } = base;
      const single = withMoved({ ...plain, id: newId, every: "once", on: item.from, ...(span ? { until: item.to } : {}) });
      return { ...skipped, dates: [...skipped.dates, change.kind === "edit" ? { ...single, ...change.patch } : single] };
    }
    const cut = isoOf(dayOf(item.from) - 1);
    const stopped = d.on >= item.from;
    const next = stopped
      ? { ...plan, dates: (plan.dates || []).filter((x) => x.id !== d.id) }
      : replaceDate((x) => ({ ...x, repeat: { ...x.repeat, until: cut, count: undefined } }));
    if (change.kind === "delete") return stopped ? dropDate(plan, d.id, todayIso) : next;
    let tail = { ...base, id: newId, on: item.from, ...(span ? { until: item.to } : {}),
      repeat: { ...d.repeat, count: undefined }, ex: (d.ex || []).filter((e) => e >= item.from) };
    if (change.kind === "move") {
      const shift = dayOf(change.from) - dayOf(item.from);
      const s2 = dayOf(change.to) - dayOf(change.from);
      const { until: u2, ...noEnd } = tail;
      tail = { ...noEnd, on: change.from, repeat: shiftRepeat(tail.repeat, shift),
        ex: (tail.ex || []).map((e) => isoOf(dayOf(e) + shift)), ...(s2 > 0 ? { until: change.to } : {}) };
    } else tail = { ...tail, ...change.patch };
    return { ...next, dates: [...next.dates, tail] };
  }

  if (!yearly || scope === "all") {
    if (change.kind === "delete") return dropDate(plan, d.id, todayIso);
    if (change.kind === "move") return moveEvent(plan, item, change.from, change.to);
    return replaceDate((x) => ({ ...x, ...change.patch }));
  }

  if (scope === "one") {
    const skipped = replaceDate((x) => ({ ...x, skip: [...new Set([...(x.skip || []), y])] }));
    if (change.kind === "delete") return skipped;
    const { skip, first, last, until, ...base } = freshOf(d);
    const single = withMoved({ ...base, id: newId, every: "once", on: item.from, ...(item.to !== item.from ? { until: item.to } : {}) });
    return { ...skipped, dates: [...skipped.dates, change.kind === "edit" ? { ...single, ...change.patch } : single] };
  }

  const stopped = (d.first && d.first >= y) || false;
  let next = stopped
    ? { ...plan, dates: (plan.dates || []).filter((x) => x.id !== d.id) }
    : replaceDate((x) => ({ ...x, last: y - 1 }));
  if (change.kind === "delete") return stopped ? dropDate(plan, d.id, todayIso) : next;
  const { skip, last, ...base } = freshOf(d);
  let tail = { ...base, id: newId, first: y };
  if (change.kind === "move") {
    const span = dayOf(change.to) - dayOf(change.from);
    const year = String(d.on).length > 5 ? String(d.on).slice(0, 4) : "";
    const on = year ? `${year}-${change.from.slice(5)}` : change.from.slice(5);
    const { until, ...noEnd } = tail;
    tail = { ...noEnd, on, ...(span > 0 && year ? { until: isoOf(dayOf(on) + span) } : {}) };
  } else tail = { ...tail, ...change.patch };
  next = { ...next, dates: [...next.dates, tail] };
  return next;
}

export function withNote(plan = BLANK_PLAN, iso, text) {
  const notes = { ...(plan.notes || {}) };
  const t = String(text || "").trim();
  if (t) notes[iso] = t; else delete notes[iso];
  return { ...plan, notes };
}

export const SHIFTS = [
  { key: "none", label: "Not shown" },
  { key: "day", label: "Days" },
  { key: "night", label: "Nights" },
  { key: "swing", label: "Days, then nights (swing)" },
];

export function shiftsAcross(plan = BLANK_PLAN, fromIso, toIso) {
  const mode = plan?.pattern?.shift || "none";
  const from = dayOf(fromIso);
  const n = Math.max(0, dayOf(toIso) - from + 1);
  const out = new Array(n).fill(null);
  if (mode === "none" || !n) return out;
  const states = statesAcross(plan, fromIso, toIso);
  for (const t of turnsAcross(plan, fromIso, toIso)) {
    const a = dayOf(t.aboard.from);
    const len = t.aboard.days;
    for (let k = 0; k < len; k += 1) {
      const i = a + k - from;
      if (i < 0 || i >= n || states[i] !== "aboard") continue;
      out[i] = mode === "swing" ? (k < Math.ceil(len / 2) ? "day" : "night") : mode;
    }
  }
  return out;
}

export const planOf = (other) => ({ ...BLANK_PLAN, ...other, dates: [], trash: [], notes: {} });

export function bothHome(plan, other, fromIso, days = 730) {
  const toIso = isoOf(dayOf(fromIso) + days - 1);
  const mine = statesAcross(plan, fromIso, toIso);
  const theirs = statesAcross(planOf(other), fromIso, toIso);
  const i = mine.findIndex((st, k) => st === "home" && theirs[k] === "home");
  if (i < 0) return null;
  let j = i;
  while (j + 1 < mine.length && mine[j + 1] === "home" && theirs[j + 1] === "home") j += 1;
  return { from: isoOf(dayOf(fromIso) + i), to: isoOf(dayOf(fromIso) + j), days: j - i + 1 };
}

export function agendaOf(plan = BLANK_PLAN, fromIso, days = 180, { certificates = [] } = {}) {
  const toIso = isoOf(dayOf(fromIso) + days - 1);
  const items = eventsIn(plan, fromIso, toIso, { certificates })
    .filter((e) => dayOf(e.to) >= dayOf(fromIso));
  for (const t of turnsAcross(plan, fromIso, toIso)) {
    const away = t.legs.find((l) => l.state !== "home");
    const home = t.legs.find((l) => l.state === "home");
    if (away && away.from >= fromIso && away.from <= toIso) {
      items.push({ key: `c:out:${away.from}`, sort: "change", what: "Leave home", from: away.from, to: away.from, state: away.state });
    }
    if (home && home.from >= fromIso && home.from <= toIso) {
      items.push({ key: `c:home:${home.from}`, sort: "change", what: "Back home", from: home.from, to: home.from, state: "home" });
    }
  }
  return items.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : (a.sort === "change" ? -1 : 1)));
}

export function yearsOf(plan = BLANK_PLAN, firstYear, n = 5, how) {
  return Array.from({ length: n }, (unused, k) => {
    const y = firstYear + k;
    return { y, months: Array.from({ length: 12 }, (u, m) => monthTally(plan, y, m, how)), total: yearTally(plan, y, how) };
  });
}

export const BLANK_PAY = { mode: "day", currency: "£", dayRate: 0, travelRate: 0, hotelRate: 0, monthly: 0, soldRate: 0 };

export function payOf(plan = BLANK_PLAN, fromIso, toIso, { flights = true } = {}) {
  const p = { ...BLANK_PAY, ...(plan?.pay || {}) };
  const states = statesAcross(plan, fromIso, toIso);
  const meant = statesAcross({ ...plan, days: {} }, fromIso, toIso);
  const n = { out: 0, hotel: 0, aboard: 0, back: 0, home: 0 };
  for (const st of states) n[st] += 1;
  const sold = states.filter((st, i) => st === "aboard" && meant[i] === "home").length;
  const travel = n.out + n.back;
  let total;
  const lines = [];
  if (p.mode === "salary") {
    const from = dayOf(fromIso);
    const to = dayOf(toIso);
    let months = 0;
    for (let d = from; d <= to; d += 1) {
      const iso = isoOf(d);
      months += 1 / monthLength(+iso.slice(0, 4), +iso.slice(5, 7) - 1);
    }
    const base = +(p.monthly || 0) * months;
    lines.push({ what: "Salary", days: null, amount: base });
    lines.push({ what: "Days sold", days: sold, amount: sold * +(p.soldRate || 0) });
    total = base + sold * +(p.soldRate || 0);
  } else {
    lines.push({ what: "Aboard", days: n.aboard, amount: n.aboard * +(p.dayRate || 0) });
    lines.push({ what: "Travelling", days: travel, amount: travel * +(p.travelRate || 0) });
    lines.push({ what: "Hotel", days: n.hotel, amount: n.hotel * +(p.hotelRate || 0) });
    total = lines.reduce((s, l) => s + l.amount, 0);
  }
  return { mode: p.mode, currency: p.currency || "£", total, lines, sold, counted: n, set: p.mode === "salary" ? +p.monthly > 0 : +p.dayRate > 0 };
}

export function ticketsAgainst(plan = BLANK_PLAN, certificates = [], todayIso) {
  const today = dayOf(todayIso);
  return certificates
    .filter((c) => c?.expires && c?.what)
    .map((c) => {
      const left = dayOf(c.expires) - today;
      const st = statesAcross(plan, c.expires, c.expires)[0];
      let renewBy = null;
      if (st !== "home") {
        const back = statesAcross(plan, isoOf(dayOf(c.expires) - 120), c.expires);
        for (let i = back.length - 1; i >= 0; i -= 1) if (back[i] === "home") { renewBy = isoOf(dayOf(c.expires) - (back.length - 1 - i)); break; }
      }
      return { ...c, left, aboardWhenItGoes: st !== "home", renewBy, standing: left < 0 ? "gone" : left <= 90 ? "soon" : "ok" };
    })
    .sort((a, b) => a.left - b.left);
}

export function holidaySuggestions(plan = BLANK_PLAN, y) {
  const country = plan?.holidays?.country || "BR";
  const taken = new Set(plan?.holidays?.take || []);
  return holidaysIn(country, y).map((h) => ({ ...h, taken: taken.has(h.what) }));
}

export function takeHolidays(plan = BLANK_PLAN, names) {
  return { ...plan, holidays: { ...(plan.holidays || {}), take: [...new Set(names)], asked: true } };
}

export const holidaysPending = (plan) => !plan?.holidays?.asked;

export function clearable(plan = BLANK_PLAN) {
  return {
    events: (plan.dates || []).length,
    days: Object.keys(plan.days || {}).length,
    notes: Object.keys(plan.notes || {}).length,
    slips: Object.keys(plan.slips || {}).length,
    holidays: (plan.holidays?.take || []).length,
    linked: (plan.linked || []).length,
    others: (plan.others || []).length,
    hitches: (plan.hitches || []).length,
  };
}

export function clearPlan(plan = BLANK_PLAN, what = {}, todayIso = new Date().toISOString().slice(0, 10)) {
  let out = { ...plan };
  if (what.events && (plan.dates || []).length) {
    out = { ...out, dates: [], trash: [...plan.dates.map((d) => ({ ...d, deleted: todayIso })), ...(plan.trash || [])] };
  }
  if (what.days) out = { ...out, days: {} };
  if (what.notes) out = { ...out, notes: {} };
  if (what.slips) out = { ...out, slips: {} };
  if (what.holidays) out = { ...out, holidays: { ...(plan.holidays || {}), take: [], asked: false } };
  if (what.linked) out = { ...out, linked: [] };
  if (what.others) out = { ...out, others: [] };
  if (what.hitches) out = { ...out, hitches: [] };
  if (what.rotation) {
    out = { ...out, pattern: null, anchor: todayIso, horizon: BLANK_PLAN.horizon, slips: {}, dismissed: [], suggest: true };
  }
  return out;
}

const canon = (v) => (Array.isArray(v) ? v.map(canon)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => [k, canon(v[k])]))
  : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

export function mergePlans(base, mine, theirs) {
  if (!theirs) return mine;
  if (!mine) return theirs;
  const byId = (list) => new Map((list || []).filter((d) => d?.id).map((d) => [d.id, d]));
  const B = byId(base?.dates);
  const M = byId(mine.dates);
  const T = byId(theirs.dates);
  const dates = [];
  for (const id of new Set([...M.keys(), ...T.keys()])) {
    const b = B.get(id);
    const m = M.get(id);
    const t = T.get(id);
    if (m && t) dates.push(b && same(m, b) ? t : m);
    else if (m) { if (!(b && same(m, b))) dates.push(m); }
    else if (!(b && same(t, b))) dates.push(t);
  }
  const kept = new Set(dates.map((d) => d.id));
  const trash = [...byId([...(theirs.trash || []), ...(mine.trash || [])]).values()]
    .filter((d) => !kept.has(d.id))
    .sort((x, y) => (x.deleted < y.deleted ? 1 : x.deleted > y.deleted ? -1 : 0));
  const out = { ...mine, dates, trash };
  for (const k of ["feed", "dav"]) {
    if (theirs[k] !== undefined) out[k] = theirs[k];
    else delete out[k];
  }
  return out;
}

export const samePlan = (a, b) => same(a, b);
