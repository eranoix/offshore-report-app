import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as wait } from "node:timers/promises";
import WebSocket from "ws";
import { freePort } from "./port.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = await freePort();
const DEBUG = await freePort();
const PROFILE = `/tmp/smoke-check-${process.pid}`;
const PROFILE_FLAG = `--user-data-dir=${PROFILE}`;
const ROUTES = ["/", "/trip-feedback", "/caap", "/library", "/forms", "/rotation", "/account", "/roadmap"];

const serve = spawn(
  "npx",
  ["vite", "preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
  { stdio: "ignore", detached: true },
);
const chrome = spawn(
  "google-chrome",
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    `--remote-debugging-port=${DEBUG}`,
    "--remote-allow-origins=*",
    PROFILE_FLAG,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const stop = (code) => {
  try {
    process.kill(-serve.pid);
  } catch {
    serve.kill();
  }
  chrome.kill();
  process.exit(code);
};
process.on("SIGINT", () => stop(1));

let up = false;
for (let i = 0; i < 40 && !up; i += 1) {
  await wait(500);
  up = await fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.ok).catch(() => false);
}
if (!up) {
  console.error(`the preview server never answered on ${PORT} — nothing was checked`);
  stop(1);
}
await wait(1500);

async function target() {
  const res = await fetch(`http://127.0.0.1:${DEBUG}/json`);
  const list = await res.json();
  return list.find((t) => t.type === "page").webSocketDebuggerUrl;
}

function visit(url) {
  return new Promise(async (resolve) => {
    const ws = new WebSocket(await target(), { perMessageDeflate: false });
    const thrown = [];
    const got = [];
    let id = 0;
    const call = (method, params = {}) =>
      new Promise((done) => {
        const mine = (id += 1);
        const listen = (raw) => {
          const msg = JSON.parse(raw);
          if (msg.id === mine) {
            ws.off("message", listen);
            done(msg.result || {});
          }
        };
        ws.on("message", listen);
        ws.send(JSON.stringify({ id: mine, method, params }));
      });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw);
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails || {};
        thrown.push((d.exception?.description || d.text || "").split("\n")[0]);
      }
      if (msg.method === "Network.requestWillBeSent") got.push(msg.params.request.url);
    });

    ws.on("open", async () => {
      await call("Runtime.enable");
      await call("Page.enable");
      await call("Network.enable");
      await call("Page.navigate", { url: "about:blank" });
      await wait(400);
      thrown.length = 0;
      await call("Page.navigate", { url });
      await wait(3500);
      const { result } = await call("Runtime.evaluate", {
        expression: "document.getElementById('root')?.children.length ?? -1",
        returnByValue: true,
      });
      const lists = await call("Runtime.evaluate", {
        expression: `[
          ...[...document.querySelectorAll("datalist")].map((d) => ({
            id: d.id,
            items: [...d.options].map((o) => o.value || o.textContent),
          })),
          /* Every chooser but the ones marked as a ladder: the levels of the
             scheme and the shelf's own ordering menu are in their order on
             purpose. A grouped chooser is read group by group — the groups run
             alongside, over, judging, which is also a ladder. */
          ...[...document.querySelectorAll("select:not([data-scale])")].flatMap((sel, at) => {
            const groups = [...sel.querySelectorAll("optgroup")];
            /* Numbered, because two choosers on a panel can be the same field
               asked twice — the crew's position and the supervisor's — and a
               report that folded them together would say four lists were
               checked when it had looked at three. */
            const name = (sel.id || sel.getAttribute("aria-label") || sel.className || "select") + " " + at;
            const pick = (nodes) => nodes.filter((o) => o.value !== "").map((o) => o.textContent.trim());
            return groups.length
              ? groups.map((g, n) => ({ id: name + " · " + (g.label || n), items: pick([...g.children]) }))
              : [{ id: name, items: pick([...sel.options]) }];
          }),
        ]`,
        returnByValue: true,
      });
      ws.close();
      resolve({ painted: result?.value ?? -1, thrown, got, lists: lists.result?.value || [] });
    });
  });
}

let bad = 0;
const BUDGET = 1_400_000;
const fat = [];
const jumbled = [];
const offered = new Map();
const byName = new Intl.Collator("en", { sensitivity: "base", numeric: true }).compare;
for (const route of ROUTES) {
  const { painted, thrown, got, lists } = await visit(`http://127.0.0.1:${PORT}${route}`);
  const blank = painted < 1;
  for (const list of lists) {
    offered.set(`${route} #${list.id || "(unnamed)"}`, list.items);
    const wanted = [...list.items].sort(byName);
    if (list.items.join("\u0000") !== wanted.join("\u0000"))
      jumbled.push(`${route} #${list.id || "(unnamed)"}: ${list.items.slice(0, 3).join(", ")}…`);
  }
  const weight = [...new Set(got)]
    .filter((u) => /\.js(\?|$)/.test(u))
    .map((u) => new URL(u).pathname.replace(/^\//, ""))
    .reduce((sum, name) => sum + (statSync(join(ROOT, "dist", name), { throwIfNoEntry: false })?.size || 0), 0);
  if (weight > BUDGET) fat.push(`${route} ${Math.round(weight / 1024)} KB`);
  if (blank || thrown.length) {
    bad += 1;
    console.error(`FAIL ${route}${blank ? " — nothing rendered" : ""}`);
    thrown.forEach((t) => console.error(`     ${t}`));
  } else {
    console.log(`ok   ${route} — ${Math.round(weight / 1024)} KB of script`);
  }
}
if (fat.length) {
  bad += 1;
  console.error(`FAIL pages fetch more script than they should — ${fat.join(", ")}`);
} else {
  console.log(`ok   no page fetches more than ${Math.round(BUDGET / 1024)} KB of script`);
}
if (jumbled.length) {
  bad += 1;
  console.error(`FAIL lists are offered out of order — ${jumbled.join(" · ")}`);
} else {
  const counted = [...offered].filter(([, items]) => items.length).length;
  console.log(`ok   every list a page offers is in alphabetical order — ${counted} with something in them`);
}
const ships = offered.get("/trip-feedback #l-vessel") || [];
if (ships.length < 20 || !ships.includes("MV Gulf Sentinel")) {
  bad += 1;
  console.error(`FAIL the trip panel does not offer the fleet — ${ships.length} ship(s)`);
} else {
  console.log(`ok   the trip panel offers the fleet — ${ships.length} ships, ${ships[0]} first`);
}

console.log(bad ? `\n${bad} problem${bad === 1 ? "" : "s"}` : `\nall ${ROUTES.length} pages render`);
stop(bad ? 1 : 0);
