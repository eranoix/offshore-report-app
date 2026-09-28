import https from "node:https";

const WHERE = () => new URL(process.env.DOCX_UPSTREAM || "https://203.0.113.10:9443/docx/");
const pinnedPrint = () => String(process.env.DOCX_FINGERPRINT || "").replace(/[^A-F0-9]/gi, "").toUpperCase();

export function ask(bytes, { where = "", headers = {}, timeout = 60_000 } = {}) {
  const url = WHERE();
  const pinned = pinnedPrint();
  const options = {
    method: "POST",
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname + where,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": bytes.length,
      "x-docx-key": process.env.DOCX_KEY,
      ...headers,
    },
    rejectUnauthorized: false,
    servername: url.hostname,
    timeout,
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const parts = [];
      res.on("data", (c) => parts.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode, body: Buffer.concat(parts), type: res.headers["content-type"] }));
    });
    const check = (socket) => {
      if (!pinned) {
        req.destroy(new Error("no certificate is pinned for the document engine"));
        return;
      }
      const seen = String(socket.getPeerCertificate?.()?.fingerprint256 || "")
        .replace(/[^A-F0-9]/gi, "")
        .toUpperCase();
      if (seen) {
        if (seen !== pinned) req.destroy(new Error("the document engine presented a different certificate"));
      } else if (!socket.isSessionReused?.()) {
        req.destroy(new Error("the document engine showed no certificate"));
      }
    };
    req.on("socket", (socket) => {
      if (socket.encrypted && !socket.connecting) check(socket);
      else socket.once("secureConnect", () => check(socket));
    });
    req.on("timeout", () => req.destroy(new Error("the engine took too long")));
    req.on("error", reject);
    req.end(bytes);
  });
}

export const engineReady = () => Boolean(process.env.DOCX_KEY && pinnedPrint());
