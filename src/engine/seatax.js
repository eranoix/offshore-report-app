const A_DAY = 864e5;

export const dayOf = (iso) =>
  Date.UTC(+String(iso).slice(0, 4), +String(iso).slice(5, 7) - 1, +String(iso).slice(8, 10)) / A_DAY;

export const isoOf = (day) => new Date(day * A_DAY).toISOString().slice(0, 10);

export const SEATAX = {
  MIN_PERIOD: 365,
  HALF: 0.5,
  PER_DAY_OUT: 0.5,
  PER_DAY_IN: -0.5,
  DAYS_PER_HALF_DAY: 2,
  MAX_UK_SPELL: 183,
};

const BRITISH = [
  "uk", "u k", "gb", "great britain", "britain", "england", "scotland", "wales",
  "northern ireland", "fraserburgh", "cromarty", "scrabster", "rosyth",
  "lerwick", "scapa", "sullom voe", "montrose", "dundee", "leith", "grangemouth",
  "great yarmouth", "lowestoft", "teesside", "middlesbrough", "hull", "immingham",
  "grimsby", "blyth", "tyne", "newcastle", "sunderland", "liverpool", "birkenhead",
  "holyhead", "milford haven", "swansea", "cardiff", "bristol", "avonmouth",
  "southampton", "portsmouth", "plymouth", "falmouth", "poole", "dover", "harwich",
  "felixstowe", "london", "tilbury", "belfast", "londonderry", "stornoway",
  "glasgow", "greenock", "edinburgh", "stromness", "wick", "thurso", "shetland", "orkney",
];

const words = (text) => ` ${String(text ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim()} `;

export const looksBritish = (port) => {
  const said = words(port);
  return BRITISH.some((hint) => said.includes(` ${hint} `));
};

const round2 = (n) => Math.round(n * 2) / 2;

export function runLedger(absences = []) {
  const list = Array.isArray(absences) ? absences : [];
  const problems = [];
  const portWarnings = [];
  const rows = [];

  let prevBack = null;
  let total = 0;
  let ukTotal = 0;
  let outDays = 0;
  let longestUkSpell = 0;
  let broken = false;

  for (let i = 0; i < list.length; i += 1) {
    const it = list[i] || {};
    const n = i + 1;
    const left = it.left ? dayOf(it.left) : null;
    const back = it.back ? dayOf(it.back) : null;
    const port = it.port == null ? "" : String(it.port);

    if (left == null) {
      problems.push(`absence ${n} has no day of leaving`);
      broken = true;
    }
    if (left != null && back != null && back < left) {
      problems.push(`absence ${n} comes home on ${it.back}, before it left on ${it.left}`);
    }
    if (left != null && prevBack != null && left < prevBack) {
      problems.push(`absence ${n} leaves on ${it.left}, before the ${isoOf(prevBack)} it last came home`);
    }
    if (back == null && i < list.length - 1) {
      problems.push(`absence ${n} has no day of return, and nothing after it can be counted`);
    }
    if (!port.trim()) portWarnings.push({ n, left: it.left ?? null, port: "", why: "no port written down" });
    else if (looksBritish(port)) portWarnings.push({ n, left: it.left ?? null, port, why: "reads as a British port" });

    const daysIn = broken || left == null ? null : (prevBack == null ? 0 : left - prevBack);
    if (daysIn != null) {
      ukTotal += daysIn;
      total += daysIn;
      longestUkSpell = Math.max(longestUkSpell, daysIn);
    }
    const ukAtLeaving = daysIn == null ? null : ukTotal;
    const totalAtLeaving = daysIn == null ? null : total;

    const open = back == null;
    const daysOut = open || daysIn == null ? null : back - left;
    if (daysOut != null) {
      outDays += daysOut;
      total += daysOut;
    }

    const rowTotal = open || daysIn == null ? null : total;
    const half = rowTotal == null ? null : rowTotal * SEATAX.HALF;
    const marginHalfDays = half == null ? null : round2(half - ukAtLeaving);
    const daysHeCanStay = marginHalfDays == null ? null : marginHalfDays * SEATAX.DAYS_PER_HALF_DAY;
    const failed = half == null ? null : ukAtLeaving > half;
    const failOn = daysHeCanStay == null ? null : isoOf(back + daysHeCanStay);

    if (back == null) { prevBack = null; broken = true; } else { prevBack = back; }

    rows.push({
      n,
      left: it.left ?? null,
      back: it.back ?? null,
      port,
      portLooksBritish: looksBritish(port),
      portMissing: !port.trim(),
      daysIn,
      daysOut,
      totalAtLeaving,
      total: rowTotal,
      half,
      ukTotal: ukAtLeaving,
      marginHalfDays,
      daysHeCanStay,
      failOn,
      failed,
      open,
    });
  }

  const closed = rows.filter((r) => !r.open && r.total != null);
  const last = closed[closed.length - 1] || null;
  const away = rows.length > 0 && rows[rows.length - 1].open;
  const claimStart = rows[0]?.left ?? null;
  const lastDay = away ? rows[rows.length - 1].left : (last?.back ?? null);
  const totalDays = away ? (rows[rows.length - 1].totalAtLeaving ?? 0) : (last?.total ?? 0);
  const ukDays = away ? (rows[rows.length - 1].ukTotal ?? 0) : (last?.ukTotal ?? 0);
  const half = totalDays * SEATAX.HALF;
  const marginHalfDays = round2(half - ukDays);

  return {
    rows,
    claimStart,
    lastDay,
    away,
    totalDays,
    ukDays,
    outDays,
    half,
    marginHalfDays,
    daysHeCanStay: marginHalfDays * SEATAX.DAYS_PER_HALF_DAY,
    failOn: away || last == null ? null : last.failOn,
    failed: rows.some((r) => r.failed === true),
    qualifies: totalDays >= SEATAX.MIN_PERIOD,
    shortBy: Math.max(0, SEATAX.MIN_PERIOD - totalDays),
    longestUkSpell,
    spellOver183: longestUkSpell > SEATAX.MAX_UK_SPELL,
    portWarnings,
    problems,
  };
}

function ukDaysBy(rows, onDay) {
  let uk = 0;
  let inUk = false;
  let spellFrom = null;
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const left = r.left ? dayOf(r.left) : null;
    const back = r.back ? dayOf(r.back) : null;
    if (i > 0) {
      const prev = rows[i - 1].back ? dayOf(rows[i - 1].back) : null;
      if (prev != null && left != null) uk += Math.max(0, Math.min(onDay, left) - prev);
    }
    if (back != null && onDay >= back && (i === rows.length - 1 || onDay < dayOf(rows[i + 1].left))) {
      inUk = true;
      spellFrom = back;
      uk += onDay - back;
    }
  }
  return { uk, inUk, spellFrom };
}

export function standing(absences = [], onIso) {
  const led = runLedger(absences);
  const on = onIso ? dayOf(onIso) : null;
  if (on == null || led.claimStart == null) {
    return {
      on: onIso ?? null, before: true, total: 0, ukDays: 0, half: 0,
      marginHalfDays: 0, daysHeCanStay: 0, inUk: false, failOn: null, failed: false,
      qualifies: false, shortBy: SEATAX.MIN_PERIOD,
    };
  }
  const start = dayOf(led.claimStart);
  if (on < start) {
    return {
      on: onIso, before: true, total: 0, ukDays: 0, half: 0,
      marginHalfDays: 0, daysHeCanStay: 0, inUk: false, failOn: null, failed: false,
      qualifies: false, shortBy: SEATAX.MIN_PERIOD,
    };
  }

  const { uk, inUk, spellFrom } = ukDaysBy(led.rows, on);
  const total = on - start;
  const half = total * SEATAX.HALF;
  const marginHalfDays = round2(half - uk);
  const daysHeCanStay = marginHalfDays * SEATAX.DAYS_PER_HALF_DAY;
  return {
    on: onIso,
    before: false,
    total,
    ukDays: uk,
    half,
    marginHalfDays,
    daysHeCanStay,
    inUk,
    failOn: inUk ? isoOf(on + daysHeCanStay) : null,
    ukSpell: inUk && spellFrom != null ? on - spellFrom : 0,
    failed: uk > half,
    qualifies: total >= SEATAX.MIN_PERIOD,
    shortBy: Math.max(0, SEATAX.MIN_PERIOD - total),
  };
}

export function mustLeaveBy(absences = []) {
  return runLedger(absences).failOn;
}

export function stayOutFor(absences = [], wantMargin = 0) {
  const have = runLedger(absences).marginHalfDays;
  const want = Number(wantMargin) || 0;
  if (have >= want) return 0;
  return Math.ceil((want - have) / SEATAX.PER_DAY_OUT);
}
