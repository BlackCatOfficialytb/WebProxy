// WebProxy server — OpenAI-compatible /v1 gateway for web-chat providers.
// Listens on localhost (default :16769). No external dependencies.
import http from "node:http";
import { kimiWeb } from "./providers/kimi.mjs";
import { zaiWeb } from "./providers/zai.mjs";
import { chatglmWeb } from "./providers/chatglm.mjs";
import { deepseekWeb } from "./providers/deepseek.mjs";
import { doubaoWeb } from "./providers/doubao.mjs";
import { qwenWeb } from "./providers/qwen.mjs";
import { renderUI } from "./ui.mjs";

const PROVIDERS = [kimiWeb, zaiWeb, chatglmWeb, deepseekWeb, doubaoWeb, qwenWeb];
const BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));
// provider id -> array of { name, cred, priority, status } (multiple sessions; tried in priority order / failover)
const credentials = new Map();

const PORT = Number(process.env.PORT) || 16769;
const HOST = process.env.HOST || "127.0.0.1";

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) { req.destroy(); return reject(new Error("Request body too large")); }
      data += c;
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error("invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

function buildModelsList() {
  return PROVIDERS.flatMap((p) =>
    p.models.map((m) => ({ id: `${p.id}/${m}`, object: "model", owned_by: p.id, provider: p.id, native_model: m }))
  );
}

// Credentials sorted by priority ascending (failover order).
function orderedCreds(providerId) {
  return (credentials.get(providerId) || []).slice().sort((a, b) => a.priority - b.priority);
}

async function handleChat(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: { message: e.message } }); }

  const providerId = body.provider || body.metadata?.provider;
  const provider = providerId ? BY_ID[providerId] : null;
  if (!provider) {
    return sendJson(res, 400, {
      error: { message: `Unknown or missing provider. Use one of: ${PROVIDERS.map((p) => p.id).join(", ")}`, type: "invalid_provider" },
    });
  }

  const stored = orderedCreds(provider.id);
  const requested = body.credential ? [{ cred: String(body.credential), priority: 0, name: "request", status: "unknown" }] : [];
  const creds = requested.length ? requested : stored;
  if (creds.length === 0) {
    return sendJson(res, 400, { error: { message: `No credential configured for ${provider.id}. Add one in the UI or body.credential.` } });
  }

  const model = body.model || provider.models[0];
  const stream = body.stream !== false;
  const messages = body.messages || [];

  let lastError = null;
  for (const entry of creds) {
    const ac = new AbortController();
    const onClose = () => ac.abort();
    req.on("close", onClose);
    try {
      const result = await provider.chat({ credential: entry.cred, model, messages, stream, signal: ac.signal });
      if (result.error) {
        lastError = result.error;
        const errStatus = result.error.status || 500;
        if (errStatus !== 401 && errStatus !== 403 && errStatus !== 429) {
          req.removeListener("close", onClose);
          return sendJson(res, errStatus, { error: { message: result.error.message || "upstream error" } });
        }
        continue;
      }
      req.removeListener("close", onClose);
      if (result.stream) {
        const upstreamResp = result.stream;
        res.writeHead(upstreamResp.status || 200, Object.fromEntries(upstreamResp.headers));
        const reader = upstreamResp.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!res.destroyed) res.write(value);
          }
        } catch { /* client disconnected */ }
        if (!res.destroyed) res.end();
        return;
      }
      return sendJson(res, 200, result.json);
    } catch (e) {
      lastError = { status: 502, message: e.message };
      req.removeListener("close", onClose);
    }
  }
  const err = lastError || { status: 502, message: "All credentials failed" };
  return sendJson(res, err.status || 500, { error: { message: err.message } });
}

function maskCred(c) {
  const s = String(c || "");
  if (s.length <= 12) return "•".repeat(s.length);
  return s.slice(0, 6) + "•".repeat(6) + s.slice(-4);
}

function listConnections() {
  return PROVIDERS.map((p) => {
    const list = credentials.get(p.id) || [];
    return {
      provider: p.id,
      label: p.label,
      hint: p.credentialHint,
      howto: p.howto || p.credentialHint,
      models: p.models,
      keys: list.map((k, i) => ({ index: i, name: k.name, priority: k.priority, status: k.status, masked: maskCred(k.cred) })),
      credentials: list.length,
    };
  });
}

function handleConnections(req, res) {
  if (req.method === "GET") return sendJson(res, 200, { connections: listConnections() });
  return readBody(req)
    .then((b) => {
      const p = BY_ID[b.provider];
      if (!p) return sendJson(res, 400, { error: { message: `Unknown provider: ${b.provider}` } });
      if (!b.credential) return sendJson(res, 400, { error: { message: "credential is required" } });
      const list = credentials.get(p.id) || [];
      list.push({
        name: String(b.name || `Key ${list.length + 1}`).slice(0, 40),
        cred: String(b.credential),
        priority: Number.isFinite(b.priority) ? Number(b.priority) : list.length + 1,
        status: "unknown",
      });
      credentials.set(p.id, list);
      return sendJson(res, 200, { ok: true, provider: p.id, count: list.length });
    })
    .catch((e) => sendJson(res, 400, { error: { message: e.message } }));
}

function handleDeleteCredential(req, res, id, index) {
  const p = BY_ID[id];
  if (!p) return sendJson(res, 400, { error: { message: `Unknown provider: ${id}` } });
  const list = credentials.get(p.id) || [];
  if (index < 0 || index >= list.length) return sendJson(res, 404, { error: { message: "credential not found" } });
  list.splice(index, 1);
  credentials.set(p.id, list);
  return sendJson(res, 200, { ok: true, provider: p.id, count: list.length });
}

// Mark a key's status after a validate (lightweight chat probe).
async function handleTestCredential(req, res, id, index) {
  const p = BY_ID[id];
  if (!p) return sendJson(res, 400, { error: { message: `Unknown provider: ${id}` } });
  const list = credentials.get(p.id) || [];
  if (index < 0 || index >= list.length) return sendJson(res, 404, { error: { message: "credential not found" } });
  const entry = list[index];
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 15000);
    try {
      const result = await p.chat({
        credential: entry.cred,
        model: p.models[0],
        messages: [{ role: "user", content: "ping" }],
        stream: false,
        signal: ac.signal,
      });
      clearTimeout(t);
      if (result.error) {
        entry.status = "failed";
        return sendJson(res, result.error.status || 500, { valid: false, message: result.error.message || "credential rejected" });
      }
      entry.status = "active";
      return sendJson(res, 200, { valid: true });
    } finally { clearTimeout(t); }
  } catch (e) {
    entry.status = "failed";
    return sendJson(res, 502, { valid: false, message: e.message });
  }
}

function endpointInfo() {
  return {
    baseUrl: `http://${HOST}:${PORT}`,
    apiKey: "(not required — localhost only)",
    models: PROVIDERS.flatMap((p) => p.models.map((m) => `${p.id}/${m}`)),
    providers: PROVIDERS.map((p) => ({ id: p.id, label: p.label })),
    chat: `POST http://${HOST}:${PORT}/v1/chat/completions  (body must include "provider" + "model")`,
  };
}

function uiHtml() {
  return renderUI(PROVIDERS, HOST, PORT);
}

const SEC_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "no-referrer",
};

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SEC_HEADERS)) res.setHeader(k, v);

  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const path = url.pathname;

  if (req.method === "GET" && path === "/api/health") return sendJson(res, 200, { ok: true });
  if (req.method === "GET" && path === "/v1/models") return sendJson(res, 200, { object: "list", data: buildModelsList() });
  if (req.method === "GET" && path === "/api/endpoint") return sendJson(res, 200, endpointInfo());
  if (path === "/v1/chat/completions") {
    if (req.method !== "POST") return sendJson(res, 405, { error: { message: "Method not allowed" } });
    return handleChat(req, res);
  }
  if (path === "/api/connections" || /^\/api\/connections\/[^/]+\/\d+/.test(path)) {
    if (req.method === "DELETE") {
      const m = path.match(/^\/api\/connections\/([^/]+)\/(\d+)$/);
      if (m) return handleDeleteCredential(req, res, decodeURIComponent(m[1]), Number(m[2]));
      return sendJson(res, 405, { error: { message: "Method not allowed" } });
    }
    if (req.method === "POST") {
      const m = path.match(/^\/api\/connections\/([^/]+)\/(\d+)\/test$/);
      if (m) return handleTestCredential(req, res, decodeURIComponent(m[1]), Number(m[2]));
    }
    return handleConnections(req, res);
  }
  if (req.method === "GET" && (path === "/" || path === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(uiHtml());
  }
  if (path === "/favicon.ico") return res.writeHead(204).end();
  return sendJson(res, 404, { error: { message: `Not found: ${path}` } });
});

server.listen(PORT, HOST, () => {
  console.log(`WebProxy listening on http://${HOST}:${PORT}`);
  console.log(`Providers: ${PROVIDERS.map((p) => p.id).join(", ")}`);
  console.log(`UI: http://${HOST}:${PORT}/`);
});
