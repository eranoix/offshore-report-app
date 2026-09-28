import { useEffect, useRef, useState } from "react";

export default function WordEditor({ kind, onSaved, onFail }) {
  const box = useRef(null);
  const editor = useRef(null);
  const [state, setState] = useState("opening");
  const [server, setServer] = useState(null);

  useEffect(() => {
    let alive = true;
    setState("opening");

    (async () => {
      try {
        const told = await fetch(`/api/render?t=editor&kind=${kind}`).then((r) =>
          (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.error || r.status)))));
        if (!alive) return;
        setServer({ at: told.at, up: told.up !== false });

        await load(`${told.at}/web-apps/apps/api/documents/api.js`);
        if (!alive) return;
        if (!window.DocsAPI) throw new Error("the document server answered but its editor did not load");

        const at = document.createElement("div");
        at.id = `word-${kind}-${Date.now()}`;
        box.current.appendChild(at);

        editor.current = new window.DocsAPI.DocEditor(at.id, {
          ...told.config,
          token: told.token,
          width: "100%",
          height: "100%",
          events: {
            onAppReady: () => alive && setState("open"),
            onDocumentReady: () => alive && setState("open"),
            onDocumentStateChange: (e) => { if (!e?.data && alive) onSaved?.(); },
            onError: (e) => {
              if (!alive) return;
              setState("failed");
              onFail?.(new Error(e?.data?.errorDescription || "the editor stopped"));
            },
          },
        });
      } catch (e) {
        if (!alive) return;
        setState("failed");
        onFail?.(e);
      }
    })();

    return () => {
      alive = false;
      try { editor.current?.destroyEditor?.(); } catch { /* it is going anyway */ }
      editor.current = null;
    };
  }, [kind, onSaved, onFail]);

  return (
    <div className={`word is-${state}`}>
      <div className="word-here" ref={box} />
      {state === "opening" ? <p className="note">Opening it in Word…</p> : null}
      {state === "failed" ? <Stopped server={server} /> : null}
    </div>
  );
}

function Stopped({ server }) {
  const blocked = server?.up;
  return (
    <div className="word-out">
      <p><b>Word could not open on this device.</b></p>
      {blocked ? (
        <>
          <p>
            The document server is running — the site reached it a moment ago.
            This browser could not, which puts whatever is refusing it between
            this device and the server: a network that opens secure
            connections to look inside them, or a security program installed
            here.
          </p>
          <p>
            <a className="btn" href={`${server.at}/healthcheck`} target="_blank" rel="noreferrer">
              Ask the browser why
            </a>
          </p>
          <p className="note">
            That opens the document server in a tab of its own. Whatever the
            browser says there names what is refusing it — and on a page it
            refuses, <b>Advanced → Certificate</b> says who issued the one it
            was handed instead.
          </p>
        </>
      ) : (
        <p>
          The document server is not answering at all. That one is ours, not
          yours.
        </p>
      )}
      <p className="note">
        The rest of this page is unaffected: Import, Export, Export to PDF and
        putting a form in front of the crew all go through the site.
      </p>
    </div>
  );
}

const loading = new Map();
function load(src) {
  if (loading.has(src)) return loading.get(src);
  const job = new Promise((done, fail) => {
    const tag = document.createElement("script");
    tag.src = src;
    tag.async = true;
    tag.onload = () => done();
    tag.onerror = () => {
      loading.delete(src);
      fail(new Error("the document server could not be reached"));
    };
    document.head.appendChild(tag);
  });
  loading.set(src, job);
  return job;
}
