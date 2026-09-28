import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fillForm } from "../../engine/docx";
import witnessPage from "../../forms/witness.pdf?url";
import observationPage from "../../forms/observation.pdf?url";
import knowledgePage from "../../forms/knowledge.pdf?url";
import feedbackPage from "../../forms/feedback.pdf?url";
import { BLANKS } from "../../forms/blanks";
import { heldAbout } from "../../engine/forms";
import { boxesDrawn, fitBoxes } from "../../engine/boxes";
import { readerReady } from "../../engine/reader";
import { asQA } from "../../engine/qa";
import { readSetting, writeSetting } from "../../engine/vault";

const BLANK_PAGE = {
  witness: witnessPage,
  observation: observationPage,
  knowledge: knowledgePage,
  feedback: feedbackPage,
};

const drawnBefore = new Map();
const KEEP = 12;

function remember(store, mark, value) {
  if (store.has(mark)) return;
  store.set(mark, value);
  while (store.size > KEEP) {
    const [oldest, held] = store.entries().next().value;
    store.delete(oldest);
    if (typeof held === "string") URL.revokeObjectURL(held);
  }
}

let queue = Promise.resolve();

function InBox({ least, value, ...rest }) {
  const mine = useRef(null);
  useLayoutEffect(() => {
    const el = mine.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(least, el.scrollHeight)}px`;
  }, [value, least, rest.style?.width, rest.style?.fontSize]);
  return <textarea ref={mine} value={value} rows={1} {...rest} />;
}

function OnLine({ size, value, ...rest }) {
  const mine = useRef(null);
  useLayoutEffect(() => {
    const el = mine.current;
    if (!el) return;
    el.style.fontSize = `${size}px`;
    el.style.letterSpacing = "";
    if (el.scrollWidth <= el.clientWidth + 1) return;
    const fits = Math.max(size * 0.62, (size * el.clientWidth) / el.scrollWidth);
    el.style.fontSize = `${Math.max(6, fits)}px`;
  }, [value, size, rest.style?.width]);
  return <input ref={mine} value={value} {...rest} />;
}

export const LINES = {
  witness: ["WITNESS", "POSITION & SITE", "NAME FOR WHOM TESTIMONY IS FOR", "RELATIONSHIP WITH CANDIDATE"],
  observation: ["ASSESSOR", "POSITION & SITE", "NAME OF CANDIDATE OBSERVED", "RELATIONSHIP WITH CANDIDATE"],
  knowledge: ["ASSESSOR", "POSITION & SITE", "CANDIDATE QUESTIONED", "RELATIONSHIP WITH CANDIDATE"],
  feedback: ["ASSESSOR", "POSITION & SITE", "CANDIDATE", "RELATIONSHIP WITH CANDIDATE"],
};

export async function drawForm(kind, doc, content, mark, signal) {
  const held = drawnBefore.get(mark);
  if (held) return held;
  const mine = queue.then(() => draw(kind, doc, content, mark, signal));
  queue = mine.catch(() => {});
  return mine;
}

async function draw(kind, doc, content, mark, signal) {
  const already = drawnBefore.get(mark);
  if (already) return already;
  if (signal?.aborted) throw Object.assign(new Error("cancelled"), { name: "AbortError" });
  const bytes = await fillForm(kind, doc, content);
  const res = await fetch("/api/render", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: bytes,
    signal,
  });
  if (!res.ok) throw new Error(String(res.status));
  const address = URL.createObjectURL(await res.blob());
  remember(drawnBefore, mark, address);
  return address;
}

export const mapForm = (kind) => {
  const mine = heldAbout(kind)?.blanks;
  return mine?.fields?.length ? mine : BLANKS[kind] || { fields: [], boxes: [] };
};

export const formSignature = (kind, doc, content) =>
  JSON.stringify([
    kind,
    heldAbout(kind)?.version ?? 0,
    doc.candidate, doc.witness, doc.assessor, doc.site, doc.outcome, doc.discipline,
    doc.witnessPosition, doc.assessorPosition, doc.witnessRelationship, doc.assessorRelationship,
    doc.ref, doc.task, doc.dated,
    content?.text, content?.own, content?.questions,
  ]);

const REAL = 96 / 72;
const STEPS = [50, 75, 100, 125, 150, 200, 250];

export default function Paper({ kind, doc, content, generation, onLine, onBox }) {
  const [state, setState] = useState("opening");
  const [zoom, setZoom] = useState(() => readSetting("caap:zoom", "fit"));
  const [pages, setPages] = useState([]);
  const [wide, setWide] = useState(0);
  const holder = useRef(null);
  const drawn = useRef([]);
  const last = useRef("");
  const mark = formSignature(kind, doc, content);

  useLayoutEffect(() => {
    const box = holder.current;
    if (!box) return undefined;
    const watch = new ResizeObserver(([entry]) => setWide(Math.round(entry.contentRect.width)));
    watch.observe(box);
    setWide(Math.round(box.getBoundingClientRect().width));
    return () => watch.disconnect();
  }, []);

  const blanks = mapForm(kind);
  const boxes = useMemo(
    () => fitBoxes(blanks.boxes || [], pages.map((p) => p.boxes || [])),
    [blanks, pages],
  );

  useEffect(() => {
    if (last.current === mark && drawn.current.length) return undefined;
    let live = true;
    const stop = new AbortController();
    const go = async () => {
      setState(drawn.current.length ? "redrawing" : "opening");
      const open = async (address) => {
        const pdfjs = await readerReady();
        const file = await pdfjs.getDocument({ url: address }).promise;
        const got = [];
        for (let n = 1; n <= file.numPages; n += 1) {
          /* eslint-disable-next-line no-await-in-loop */
          const page = await file.getPage(n);
          const size = page.getViewport({ scale: 1 });
          /* eslint-disable-next-line no-await-in-loop */
          const boxes = await boxesDrawn(pdfjs, page, size);
          got.push({ page, w: size.width, h: size.height, boxes });
        }
        return got;
      };
      try {
        const address = await drawForm(kind, doc, content, mark, stop.signal);
        const got = await open(address);
        if (!live) return;
        drawn.current = got;
        setPages(got);
        last.current = mark;
        setState("shown");
      } catch (e) {
        if (!live || e?.name === "AbortError") return;
        try {
          const got = await open(BLANK_PAGE[kind]);
          if (!live) return;
          drawn.current = got;
          setPages(got);
          last.current = "";
          setState("plain");
        } catch {
          if (live) setState("failed");
        }
      }
    };
    const timer = setTimeout(go, drawn.current.length ? 350 : 0);
    return () => {
      live = false;
      clearTimeout(timer);
      stop.abort();
    };
  }, [mark, generation]);

  const first = pages[0];
  const scale = !first || !wide ? 1 : zoom === "fit" ? wide / first.w : ((Number(zoom) || 100) / 100) * REAL;

  useEffect(() => {
    if (!pages.length) return undefined;
    const jobs = [];
    pages.forEach((sheet, i) => {
      const canvas = document.getElementById(`sheet-${kind}-${i}`);
      if (!canvas) return;
      const sharp = Math.min(2, window.devicePixelRatio || 1);
      const view = sheet.page.getViewport({ scale: scale * sharp });
      canvas.width = Math.round(view.width);
      canvas.height = Math.round(view.height);
      const job = sheet.page.render({ canvasContext: canvas.getContext("2d"), viewport: view });
      jobs.push(job);
      job.promise.catch(() => {});
    });
    return () => jobs.forEach((job) => job.cancel?.());
  }, [pages, scale, kind]);

  const held = useRef(zoom);
  held.current = zoom;
  const at = (next) => {
    const size = next === "fit" ? "fit" : String(Math.min(250, Math.max(50, Math.round(next))));
    held.current = size;
    setZoom(size);
    writeSetting("caap:zoom", size);
  };
  const now = Math.max(1, Math.round((scale / REAL) * 100));
  const by = (way) => {
    const from = held.current === "fit" ? now : Number(held.current) || 100;
    const next =
      way < 0 ? [...STEPS].reverse().find((s) => s < from - 1) : STEPS.find((s) => s > from + 1);
    at(next ?? (way < 0 ? 50 : 250));
  };

  const [typed, setTyped] = useState({});
  useEffect(() => setTyped({}), [kind]);
  const saying = useCallback((key, printed) => (typed[key] === undefined ? printed : typed[key]), [typed]);

  const lineValue = (label) => {
    const which = LINES[kind] || [];
    const role = kind === "witness" ? doc.witnessPosition : doc.assessorPosition;
    return (
      [
        kind === "witness" ? doc.witness : doc.assessor,
        [role, doc.site].filter(Boolean).join(" — "),
        doc.candidate,
        kind === "witness" ? doc.witnessRelationship : doc.assessorRelationship,
      ][which.indexOf(label)] || ""
    );
  };
  const boxValue = (i) => {
    if (kind === "knowledge") return asQA(content?.questions);
    return i === 0 ? content?.text || "" : content?.own || "";
  };

  const put = (key, value, send) => {
    setTyped((all) => ({ ...all, [key]: value }));
    send(value);
  };
  const settle = (key) =>
    setTyped((all) => {
      const rest = { ...all };
      delete rest[key];
      return rest;
    });

  return (
    <div className={`paper${state === "plain" ? " plain" : ""}`} ref={holder}>
      <div className="zoom" role="group" aria-label="How big the form is drawn">
        <button type="button" onClick={() => by(-1)} aria-label="Smaller" disabled={now <= 50}>
          −
        </button>
        <button type="button" onClick={() => at(100)} title="The page at its printed size">
          {now}%
        </button>
        <button type="button" onClick={() => by(1)} aria-label="Bigger" disabled={now >= 250}>
          +
        </button>
        <button
          type="button"
          className={`fit${zoom === "fit" ? " on" : ""}`}
          onClick={() => at("fit")}
          title="As wide as the panel"
        >
          Fit width
        </button>
      </div>

      <div className="sheets">
        {pages.map((sheet, i) => (
          <div
            className="leaf"
            key={`${kind}-${i}`}
            style={{ width: `${Math.round(sheet.w * scale)}px`, height: `${Math.round(sheet.h * scale)}px` }}
          >
            <canvas id={`sheet-${kind}-${i}`} />
            {blanks.fields
              .filter((f) => f.page === i)
              .map((f) => (
                <OnLine
                  key={f.label}
                  className={`on-line${saying(f.label, lineValue(f.label)) ? "" : " blank"}`}
                  value={saying(f.label, lineValue(f.label))}
                  aria-label={f.label}
                  title={f.label}
                  spellCheck={false}
                  size={Math.max(7, Math.round(f.h * sheet.h * scale * 0.86))}
                  style={{
                    left: `${f.x * sheet.w * scale}px`,
                    top: `${f.y * sheet.h * scale}px`,
                    width: `${f.w * sheet.w * scale}px`,
                    height: `${Math.max(14, f.h * sheet.h * scale * 1.6)}px`,
                  }}
                  onChange={(e) => put(f.label, e.target.value, (v) => onLine?.(f.label, v))}
                  onBlur={() => settle(f.label)}
                />
              ))}
            {boxes.map((b, which) =>
              b.page !== i ? null : (
                <InBox
                  key={`box-${which}`}
                  className={`in-box${saying(`box${which}`, boxValue(which)) ? "" : " blank"}`}
                  value={saying(`box${which}`, boxValue(which))}
                  aria-label={which === 0 ? "The statement" : "The candidate's own words"}
                  least={Math.round(b.h * sheet.h * scale)}
                  style={{
                    left: `${b.x * sheet.w * scale}px`,
                    top: `${b.y * sheet.h * scale}px`,
                    width: `${b.w * sheet.w * scale}px`,
                    fontSize: `${Math.max(8, Math.round(10 * scale))}px`,
                  }}
                  onChange={(e) => put(`box${which}`, e.target.value, (v) => onBox?.(which, v))}
                  onBlur={() => settle(`box${which}`)}
                />
              ),
            )}
          </div>
        ))}
      </div>

      {state === "opening" && <p className="tip drawing">Drawing the form…</p>}
      {state === "redrawing" && <p className="tip drawing quiet">Laying it out again…</p>}
      {state === "plain" && (
        <p className="tip quiet">
          The blank form, with your writing on it — nothing here can lay it out until there is a
          connection again. The Word file you download is the real one.
        </p>
      )}
      {state === "failed" && <p className="tip">The form could not be drawn. The download still works.</p>}
    </div>
  );
}
