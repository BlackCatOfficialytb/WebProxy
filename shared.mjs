// Shared helpers for web-provider adapters: cookie/token extraction, OpenAI-shaped
// SSE/JSON emission, and a tiny in-memory credential store. Uses axios for HTTP.

import axios from "axios";

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

export { axios };

/** Wrap a Node.js Readable stream (from axios responseType:'stream') as a web ReadableStream. */
export function nodeStreamToWeb(nodeStream) {
  return new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk)));
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err) => controller.error(err));
    },
    cancel() { nodeStream.destroy(); },
  });
}

function stripPrefix(raw) {
  const t = (raw || "").trim();
  return t.replace(/^bearer\s+/i, "").replace(/^cookie:/i, "").trim();
}

/** Extract one cookie value from a bare value, `k=v`, or a full DevTools cookie blob. */
export function extractCookieValue(raw, name) {
  const t = stripPrefix(raw);
  if (!t) return "";
  if (t.includes(";")) {
    const m = t.match(new RegExp("(?:^|;\\s*)" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;\\s]+)"));
    return m ? m[1] : "";
  }
  const prefix = `${name}=`;
  if (t.startsWith(prefix)) return t.slice(prefix.length);
  return t.includes("=") ? "" : t;
}

/** Full cookie blob passthrough (used by qwen/doubao which need the whole jar). */
export function fullCookieHeader(raw) {
  const t = stripPrefix(raw);
  return t && t.includes("=") ? t : "";
}

/**
 * Kimi credential extractor — returns `{ mode, value }`:
 *   - `{ mode: "bearer", value }` → send as `Authorization: Bearer <value>`
 *   - `{ mode: "cookie",  value }` → send as `Cookie: kimi-auth=<value>`
 *
 * Accepts: raw token, `Bearer <token>`, `access_token=<v>`, `kimi-auth=<v>`,
 *           or a full DevTools cookie blob containing either key.
 */
export function extractKimiCredential(raw) {
  const r = String(raw || "").trim();
  if (!r) return { mode: "", value: "" };

  // Bearer header or bare token
  const bearer = r.match(/^(?:authorization:\s*)?bearer\s+([^;\s]+)/i);
  if (bearer) return { mode: "bearer", value: bearer[1] };

  // access_token=... → Bearer mode (localStorage value)
  const atMatch = r.match(/(?:^|[\s;])access_token=([^;\s]+)/);
  if (atMatch) return { mode: "bearer", value: atMatch[1] };

  // kimi-auth=... → Cookie mode (browser cookie)
  const kaMatch = r.match(/(?:^|[\s;])kimi-auth=([^;\s]+)/);
  if (kaMatch) return { mode: "cookie", value: kaMatch[1] };

  // Bare token (no = or ; → treat as raw access_token)
  if (!r.includes("=") && !r.includes(";")) return { mode: "bearer", value: r };

  return { mode: "", value: "" };
}

export function extractBearer(raw) {
  const m = String(raw || "").match(/^(?:authorization:\s*)?bearer\s+([^;\s]+)/i);
  if (m) return m[1];
  const t = stripPrefix(raw);
  return !t.includes("=") && !t.includes(";") ? t : "";
}

// ── OpenAI-shaped streaming helpers ──────────────────────────────────────────

export function newChunkId() {
  return `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Build a ReadableStream that emits OpenAI chunk deltas, then [DONE]. */
export function makeSseStream(model, onDelta) {
  const encoder = new TextEncoder();
  const id = newChunkId();
  const created = Math.floor(Date.now() / 1000);
  let roleEmitted = false;
  let finished = false;
  const emit = (controller, delta, finish = null) => {
    controller.enqueue(
      encoder.encode(
        `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
      )
    );
  };
  return new ReadableStream({
    async start(controller) {
      try {
        await onDelta({
          role: () => {
            if (!roleEmitted) {
              roleEmitted = true;
              emit(controller, { role: "assistant", content: "" });
            }
          },
          content: (t) => t && emit(controller, { content: t }),
          reasoning: (t) => t && emit(controller, { reasoning_content: t }),
          finish: () => {
            if (!finished) { finished = true; emit(controller, {}, "stop"); }
          },
        });
        if (!roleEmitted) emit(controller, { role: "assistant", content: "" });
        if (!finished) {
          emit(controller, {}, "stop");
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

/** Build a single non-streaming OpenAI chat.completion JSON Response. */
export function jsonCompletion(model, content, reasoning) {
  const message = { role: "assistant", content: content || "" };
  if (reasoning) message.reasoning_content = reasoning;
  return {
    id: newChunkId(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

export function errorPayload(status, message) {
  return { status, message };
}

/** Fold OpenAI messages -> single "role: text" transcript (web UIs take one prompt). */
export function foldMessages(messages) {
  const out = [];
  const sys = [];
  for (const m of messages || []) {
    const role = m.role;
    const text = Array.isArray(m.content)
      ? m.content.map((p) => (p.type === "text" ? p.text : "")).join("")
      : String(m.content || "");
    if (!text) continue;
    if (role === "system" || role === "developer") sys.push(text);
    else if (role === "assistant") out.push(`Assistant: ${text}`);
    else if (role === "tool") out.push(`Tool result: ${text}`);
    else out.push(`User: ${text}`);
  }
  return [sys.join("\n\n"), out.join("\n\n")].filter(Boolean).join("\n\n").trim();
}

export function jsonLinesFromSse(body) {
  const decoder = new TextDecoder();
  let buf = "";
  return {
    async *[Symbol.asyncIterator]() {
      const reader = body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          const s = line.trim();
          if (!s.startsWith("data:")) continue;
          const payload = s.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            yield JSON.parse(payload);
          } catch {
            /* ignore non-JSON */
          }
        }
      }
    },
  };
}
