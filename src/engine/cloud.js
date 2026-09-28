const OFF = typeof __OFFLINE__ !== "undefined" && __OFFLINE__;

export function toSignIn() {
  if (typeof location === "undefined" || location.pathname.startsWith("/login")) return;
  location.replace(`/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
}

async function call(path, { method = "GET", body } = {}) {
  if (OFF) throw new Error("offline build");
  const res = await fetch(`/api/${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { toSignIn(); throw new Error("not signed in"); }
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.status === 204 ? null : res.json();
}

export const available = () => !OFF;

export const getProfile = () => call("profile");
export const putProfile = (profile) => call("profile", { method: "PUT", body: profile });
export const forgetPhrases = () => call("phrases", { method: "DELETE" });

export const getPhrases = () => call("phrases").then((r) => r.phrases || []);
export const addPhrases = (phrases) => call("phrases", { method: "POST", body: { phrases } });

export const listDocuments = (kind = "trip") =>
  call(`documents?kind=${encodeURIComponent(kind)}`).then((r) => r.documents || []);
export const listEverything = () => call("documents?kind=every").then((r) => r.documents || []);
export const loadDocument = (id) => call(`document?id=${encodeURIComponent(id)}`).then((r) => r.document);
export const saveDocument = (payload) => call("documents", { method: "POST", body: payload });
export async function savePlan(payload) {
  if (OFF) throw new Error("offline build");
  const res = await fetch("/api/documents", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  if (res.status === 401) { toSignIn(); throw new Error("not signed in"); }
  if (res.status === 409) return { conflict: (await res.json()).document };
  if (!res.ok) throw new Error(`documents returned ${res.status}`);
  return res.json();
}
export const deleteDocument = (id) =>
  call(`documents?id=${encodeURIComponent(id)}`, { method: "DELETE" });
