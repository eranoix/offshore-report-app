import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import WebSocket from "ws";

const SITE = process.env.OFFSHORE_REPORT_URL || "https://forms.example.com";
const EMAIL = process.env.OFFSHORE_REPORT_EMAIL;
const PASSWORD = process.env.OFFSHORE_REPORT_PASSWORD;
const ROUTES = ["/", "/trip-feedback", "/caap", "/library", "/forms", "/account", "/roadmap"];
const DEBUG = 9436;

if (!EMAIL || !PASSWORD) {
  console.error("set OFFSHORE_REPORT_EMAIL and OFFSHORE_REPORT_PASSWORD to check the live site");
  process.exit(2);
}

const chrome = spawn(
  "google-chrome",
  ["--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${DEBUG}`,
   "--remote-allow-origins=*", "--window-size=1400,1000", "about:blank"],
  { stdio: "ignore" },
);
const stop = (code) => { chrome.kill(); process.exit(code); };
process.on("SIGINT", () => stop(1));
await wait(4000);

const res = await fetch(`http://127.0.0.1:${DEBUG}/json`);
const page = (await res.json()).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });

let id = 0;
const trouble = [];
const call = (method, params = {}) =>
  new Promise((done) => {
    const mine = (id += 1);
    const listen = (raw) => {
      const msg = JSON.parse(raw);
      if (msg.id === mine) { ws.off("message", listen); done(msg.result || {}); }
    };
    ws.on("message", listen);
    ws.send(JSON.stringify({ id: mine, method, params }));
  });

ws.on("message", (raw) => {
  const msg = JSON.parse(raw);
  const p = msg.params || {};
  if (msg.method === "Runtime.exceptionThrown") {
    const d = p.exceptionDetails || {};
    trouble.push((d.exception?.description || d.text || "").split("\n")[0]);
  } else if (msg.method === "Log.entryAdded" && p.entry?.level === "error") {
    trouble.push(`${p.entry.text} ${p.entry.url || ""}`.trim().slice(0, 180));
  }
});

const ready = new Promise((go) => ws.on("open", go));
await ready;
await call("Runtime.enable");
await call("Log.enable");
await call("Page.enable");

const evaluate = (expression) =>
  call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
    .then((r) => r.result?.value);

const fails = [];
const FIRST = "witness";
const KIND = process.env.OFFSHORE_REPORT_KIND || FIRST;
const SHEETS = ["sed"];

const say = (ok, label, got = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${label}${got ? ` — ${got}` : ""}`);
  if (!ok) fails.push(label);
};

await call("Page.navigate", { url: `${SITE}/login.html` });
await wait(5000);
await evaluate(
  `(()=>{const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;` +
  `s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};` +
  `set(document.getElementById('email'),${JSON.stringify(EMAIL)});` +
  `set(document.getElementById('password'),${JSON.stringify(PASSWORD)});` +
  `document.querySelector('form').requestSubmit();})()`,
);
await wait(7000);
const signedIn = await evaluate("location.pathname");
say(signedIn !== "/login", "signed in", String(signedIn));

await call("Page.navigate", { url: `${SITE}/forms` });
await wait(6000);

if (KIND !== FIRST) {
  await evaluate(
    `(()=>{const t=[...document.querySelectorAll('.doc-bar button')]`
    + `.find(b=>b.dataset.kind===${JSON.stringify(KIND)}`
    + `|| b.textContent.trim().toLowerCase().includes(${JSON.stringify(KIND)}));`
    + `if(t)t.click();return !!t;})()`,
  );
  await wait(4000);
}

const tools = await evaluate(
  `JSON.stringify([...document.querySelectorAll('.forms-tools .btn')].map(b=>b.textContent.trim()))`,
);
const named = JSON.parse(tools || "[]");
say(named.length >= 3, "the bar is there", named.join(" · "));
for (const want of ["Import", "Export", "Export to PDF"]) {
  say(named.some((b) => b === want), `  ${want}`);
}

const forAll = named.some((b) => /Save for everyone|Back to the company/.test(b));
const told = await evaluate(`document.querySelector('.forms-tools .note')?.textContent || ''`);
say(!forAll && /only an admin/i.test(told || ""),
  "and saving for everybody is the admin's, said so on the page", told || "(nothing said)");

const reach = JSON.parse(await evaluate(
  `fetch('/api/render?t=editor&kind=${KIND}').then(r=>r.json())`
  + `.then(j=>JSON.stringify({up:j.up,at:j.at||''}))`,
) || "{}");
say(reach.up === true, "the site reaches the document server, and says which leg it tried",
  `up=${reach.up} · ${reach.at}`);

let up = null;
for (let n = 0; n < 40; n += 1) {
  await wait(3000);
  up = JSON.parse(await evaluate(`JSON.stringify({
    state: [...(document.querySelector('.word')?.classList||[])].find(c=>c.startsWith('is-'))||'(none)',
    frames: document.querySelectorAll('.word iframe').length,
    src: document.querySelector('.word iframe')?.src || '',
    said: document.querySelector('.forms-said')?.textContent || '',
  })`) || "{}");
  if (up.state === "is-open" || up.state === "is-failed") break;
}
say(up.state === "is-open", `the ${SHEETS.includes(KIND) ? "workbook opens in the spreadsheet editor" : "form opens in Word"}`, `${up.state}${up.said ? ` · ${up.said}` : ""}`);
say(up.frames > 0, "and it is the document server's own editor", up.src.slice(0, 64));

const frameUrl = up.src || "";
say(Boolean(reach.at) && frameUrl.startsWith(reach.at),
  "served from the document server the site names", frameUrl.slice(0, 72));
const WANTED = SHEETS.includes(KIND) ? "spreadsheeteditor" : "documenteditor";
say(new RegExp(WANTED).test(frameUrl), `and it is the ${SHEETS.includes(KIND) ? "spreadsheet" : "word"} editor, not a viewer`,
  frameUrl.slice(-48));

const draftNow = () => evaluate(
  `fetch('/api/render?t=draft&kind=${KIND}').then(r=>r.ok?r.arrayBuffer():null)`
  + `.then(b=>b?b.byteLength:0)`,
).then(Number);

const before = await draftNow();
say(true, "before anything is typed, the draft is", before ? `${before} bytes` : "not there");

const where = JSON.parse(await evaluate(
  `(()=>{const r=document.querySelector('.word iframe').getBoundingClientRect();` +
  `return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)})})()`,
) || "{}");
for (const type of ["mousePressed", "mouseReleased"]) {
  await call("Input.dispatchMouseEvent", {
    type, x: where.x, y: where.y, button: "left", clickCount: 1,
  });
}
await wait(2500);
const typed = `EDITED BY THE BENCH ${Date.now()}`;
await call("Input.insertText", { text: typed });
await wait(3000);

const forced = await evaluate(
  `fetch('/api/render?t=now&kind=${KIND}',{method:'POST'})`
  + `.then(r=>r.json()).then(j=>JSON.stringify(j)).catch(e=>String(e))`,
);
await wait(6000);

await call("Page.navigate", { url: `${SITE}/caap` });
await wait(20000);

let draft = 0;
for (let n = 0; n < 20; n += 1) {
  await wait(3000);
  draft = await draftNow();
  if (draft && draft !== before) break;
}
say(/"saved":true/.test(forced || ""), "the document server hands the file over when asked",
  `${KIND}: ${forced}`);
say(draft > 0 && draft !== before, "what was typed comes back as a draft of its own",
  `${before || "nothing"} → ${draft || "nothing"} bytes`);

const says = await evaluate(
  `fetch('/api/render?t=draft&kind=${KIND}').then(r=>r.arrayBuffer()).then(b=>{` +
  `const u=new Uint8Array(b);return u.length+':'+(u[0]===0x50&&u[1]===0x4b)})`,
);
say(/:true$/.test(String(says)), "and it is a Word document, not an error page", String(says));

const real = trouble.filter((e) => !/favicon|manifest|sw\.js|Failed to load resource|ResizeObserver/i.test(e));
say(real.length === 0, "nothing broken in the console", real.slice(0, 2).join(" · "));

console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join("\n- ")}` : `\nthe ${SHEETS.includes(KIND) ? "workbook" : "form"} opens on the live site`);
stop(fails.length ? 1 : 0);
