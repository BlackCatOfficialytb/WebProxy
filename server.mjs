// WebProxy server — OpenAI-compatible /v1 gateway for web-chat providers.
// Listens on localhost (default :16769). Requires axios.
import http from "node:http";
import crypto from "node:crypto";
import db from "./db.mjs";
import { PROVIDERS, BY_ID } from "./providers/index.mjs";
import { renderUI } from "./ui.mjs";
import { initializePasswordAuth, requireAuth, createAuthToken, invalidateSession, hasAdminPassword, hashPassword } from "./auth.mjs";

const PORT = Number(process.env.PORT) || 16769;
const HOST = process.env.HOST || "127.0.0.1";

// SECURITY: fail loudly if someone tries to bind to a public interface
// without an admin password — the /api/connections + /v1/chat endpoints
// would otherwise be exposed to the network.
if (HOST !== "127.0.0.1" && HOST !== "::1" && HOST !== "localhost") {
  console.warn("[security] Binding to non-loopback interface. Ensure WEBPROXY_PASSWORD is set and you know what you are doing.");
}

// In-memory credential registry (matches original design).
const credentials = new Map(PROVIDERS.map((p) => [p.id, []]));

function sendJson(res, status, obj, extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...extraHeaders });
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
      try {
        const parsed = JSON.parse(data);
        // SECURITY: strip prototype-pollution keys recursively.
        resolve(sanitizePayload(parsed));
      } catch { reject(new Error("invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

// Recursive sanitizer — removes __proto__, constructor, prototype keys.
function sanitizePayload(v, depth = 0) {
  if (depth > 8 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => sanitizePayload(x, depth + 1));
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    out[k] = sanitizePayload(val, depth + 1);
  }
  return out;
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

  // SECURITY FIX: `body.credential` previously let any unauthenticated caller
  // turn the server into an open proxy (credential field used as arbitrary
  // upstream). Only authenticated admins may supply per-request credentials.
  const authed = await requireAuth(req);
  if (body.credential && !authed) {
    return sendJson(res, 401, { error: { message: "Supplying body.credential requires authentication. Configure credentials via /api/connections instead." } });
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

async function handleConnections(req, res) {
  // SECURITY FIX: list/add/delete/test now all require admin auth.
  const authed = await requireAuth(req);
  if (!authed) return sendJson(res, 401, { error: { message: "Authentication required. Set WEBPROXY_PASSWORD and send it as a Bearer token." } });

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

async function handleDeleteCredential(req, res, id, index) {
  const authed = await requireAuth(req);
  if (!authed) return sendJson(res, 401, { error: { message: "Authentication required." } });

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
  const authed = await requireAuth(req);
  if (!authed) return sendJson(res, 401, { error: { message: "Authentication required." } });

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
    // SECURITY: endpoints that require auth.
    auth: hasAdminPassword()
      ? "Admin password set — send `Authorization: Bearer <WEBPROXY_PASSWORD>` to modify credentials."
      : "No admin password set (WEBPROXY_PASSWORD) — credential APIs are locked until one is set.",
  };
}

function uiHtml() {
  return renderUI(PROVIDERS, HOST, PORT);
}


function renderLoginUi() {
  return <!doctype html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WebProxy Login</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap" rel="stylesheet">
<style>
:root{--brand:#E56A4A;--brand-hover:#cc5236;--brand-glow:rgba(229,106,74,.25);--bg:#1a1a1a;--bg-alt:#1F1F1E;--surface:#262626;--surface-2:#303030;--surface-3:#3a3a3a;--border:#333;--border-subtle:#2a2a2a;--text:#ededed;--text-muted:#9ca3af;--text-subtle:#6b7280;--success:#22c55e;--danger:#ef4444;--warning:#fbbf24;--info:#60a5fa;--radius:10px;--radius-lg:14px;--shadow-soft:0 1px 2px rgba(0,0,0,.3);--shadow-warm:0 2px 12px -2px rgba(229,106,74,.25);--shadow-elev:inset 0 1px 0 rgba(255,255,255,.06),0 1px 2px rgba(0,0,0,.4),0 16px 48px -8px rgba(0,0,0,.55)}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased;height:100vh;overflow:hidden;margin:0;display:flex;align-items:center;justify-content:center}
::selection{background:rgba(229,106,74,.3);color:var(--brand)}
.login-container{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.login-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px;width:100%;max-width:320px;box-shadow:var(--shadow-elev)}
.login-header{text-align:center;margin-bottom:24px}
.login-header h1{font-size:1.5rem;font-weight:600;margin-bottom:0.5rem;background:linear-gradient(135deg,var(--brand),var(--brand-hover));-webkit-background-clip:text;-webkit-text-fill-color:white}
.login-header p{font-size:0.9rem;color:var(--text-muted)}
.login-form{display:flex;flex-direction:column;gap:16px}
.form-group{display:flex;flex-direction:column;gap:6px}
.form-group label{font-size:0.875rem;font-weight:500;color:var(--text-muted)}
.form-group input{width:100%;background:var(--bg-alt);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:8px 10px;font-size:0.875rem;outline:none;font-family:inherit}
.form-group input:focus{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-glow)}
.form-group input[type="password"]{font-family:ui-monospace,monospace}
.login-actions{display:flex;flex-direction:column;gap:12px}
.btn-primary{background:var(--brand);color:#fff;border:0;border-radius:8px;padding:10px 16px;font-weight:600;font-size:0.875rem;cursor:pointer;transition:background .15s}
.btn-primary:hover{background:var(--brand-hover)}
.btn-primary:disabled{opacity:.5;cursor:not-allowed}
.btn-link{background:transparent;border:0;color:var(--text-muted);font-size:0.75rem;cursor:pointer;padding:0;text-decoration:none}
.btn-link:hover{text-decoration:underline;color:var(--text)}
.error-message{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);color:var(--danger);padding:10px 12px;border-radius:6px;font-size:0.875rem;display:none}
.error-message.show{display:block}
.loading{text-align:center;color:var(--text-muted);font-size:0.875rem;display:none}
.loading.show{display:block}
.loading-spinner{width:24px;height:24px;border:2px solid var(--border-subtle);border-top-color:var(--brand);border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 8px}
@keyframes spin{to{transform:rotate(360deg)}}
.hint{font-size:0.75rem;color:var(--text-muted);text-align:center;margin-top:16px}
</style>
</head>
<body>
<div class="login-container">
  <div class="login-card">
    <div class="login-header">
      <h1>WebProxy</h1>
      <p>Enter your password to access the dashboard</p>
    </div>
    <form id="login-form" class="login-form">
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" autocomplete="current-password" required>
      </div>
      <div class="error-message" id="error-message"></div>
      <div class="loading" id="loading">
        <div class="loading-spinner"></div>
        <div>Logging in...</div>
      </div>
      <div class="login-actions">
        <button type="submit" class="btn-primary" id="submit-btn">Login</button>
      </div>
    </div>
    <div class="hint">
      Default password is <code>123456</code> (if not changed via WEBPROXY_PASSWORD)
    </div>
  </div>
</div>
<script>
const form = document.getElementById('login-form');
const passwordInput = document.getElementById('password');
const errorMessage = document.getElementById('error-message');
const loading = document.getElementById('loading');
const submitBtn = document.getElementById('submit-btn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorMessage.textContent = '';
  errorMessage.classList.remove('show');
  loading.classList.add('show');
  submitBtn.disabled = true;

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: passwordInput.value })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Login failed');
    }

    // Login successful - redirect to the main UI
    window.location.href = '/';
  } catch (err) {
    errorMessage.textContent = err.message;
    errorMessage.classList.add('show');
  } finally {
    loading.classList.remove('show');
    submitBtn.disabled = false;
  }
});

// Auto-focus password input
passwordInput.focus();
</script>
</body></html>;
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
// Auth status endpoint
if (req.method === "GET" && path === "/api/auth/status") {
  const authed = await requireAuth(req);
  if (!authed) {
    return sendJson(res, 401, { error: { message: "Unauthorized" } });
  }
  const defaultPasswordHash = hashPassword("123456");
  const isDefaultPassword = passwordHash === defaultPasswordHash;
  return sendJson(res, 200, {
    authenticated: true,
    isDefaultPassword: isDefaultPassword
  });
}

// Change password endpoint
if (req.method === "PATCH" && path === "/api/auth/password") {
  const authed = await requireAuth(req);
  if (!auted) {
    return sendJson(res, 401, { error: { message: "Unauthorized" } });
  }
  try {
    const body = await readBody(req);
    const { currentPassword, newPassword } = body;
    if (!currentPassword || !newPassword) {
      return sendJson(res, 400, { error: { message: "Current password and new password are required" } });
    }
    const isValid = await verifyPassword(currentPassword, passwordHash);
    if (!isValid) {
      return sendJson(res, 401, { error: { message: "Invalid current password" } });
    }
    const newHash = hashPassword(newPassword);
    passwordHash = newHash;
    await setSetting("password_hash", newHash);
    return sendJson(res, 200, { ok: true });
  } catch (err) {
    return sendJson(res, 500, { error: { message: err.message } });
  }
}    return handleConnections(req, res);
  }
  if (req.method === "GET" && (path === "/" || path === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(uiHtml());
  }
  if (path === "/favicon.ico") return res.writeHead(204).end();
  return sendJson(res, 404, { error: { message: `Not found: ${path}` } });
});

server.listen(PORT, HOST, async () => {
  await initializePasswordAuth();
  console.log(`WebProxy listening on http://${HOST}:${PORT}`);
  console.log(`Providers: ${PROVIDERS.map((p) => p.id).join(", ")}`);
  console.log(`Auth: ${hasAdminPassword() ? "admin password set" : "NO ADMIN PASSWORD — credential APIs locked until WEBPROXY_PASSWORD is set"}`);
  console.log(`UI: http://${HOST}:${PORT}/`);
});


