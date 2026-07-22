// kimi-web — www.kimi.com Connect-RPC chat (international Kimi / Moonshot consumer).
// Models: K2.6, K3, K3 Swarm. Conversations are deleted after each request.
import { UA, extractKimiCredential, foldMessages, makeSseStream, jsonCompletion, errorPayload } from "../shared.mjs";

const BASE = "https://www.kimi.com";
const CHAT_URL = `${BASE}/apiv2/kimi.gateway.chat.v1.ChatService/Chat`;
const DELETE_URL = `${BASE}/api/chat`;

// Model → scenario + kimiplus_id mapping (from live GetAvailableModels + OmniRoute OEM).
const MODEL_CONFIG = {
  "kimi-k2.6":      { scenario: "SCENARIO_K2D5" },
  "kimi-k3":        { scenario: "SCENARIO_OK_COMPUTER", kimiPlusId: "ok-computer" },
  "kimi-k3-swarm":  { scenario: "SCENARIO_OK_COMPUTER", kimiPlusId: "ok-computer" },
};
const DEFAULT_MODEL = "kimi-k3";

function resolveConfig(model) {
  return MODEL_CONFIG[model] || MODEL_CONFIG[DEFAULT_MODEL];
}

// Fire-and-forget: delete the conversation after streaming/non-streaming completes.
async function deleteChat(chatId, authHeader, signal) {
  if (!chatId) return;
  try {
    await fetch(`${DELETE_URL}/${chatId}`, {
      method: "DELETE",
      headers: {
        "User-Agent": UA,
        Origin: BASE,
        Referer: `${BASE}/`,
        ...authHeader,
      },
      signal,
    });
  } catch { /* best-effort */ }
}

export const kimiWeb = {
  id: "kimi-web",
  label: "Kimi (www.kimi.com)",
  credentialHint: "access_token (localStorage) or kimi-auth cookie",
  howto: "1) Log in at www.kimi.com. 2a) DevTools → Application → Local Storage → https://www.kimi.com → copy `access_token`. 2b) Or DevTools → Application → Cookies → www.kimi.com → copy `kimi-auth` value. 3) Paste either value here (a `Bearer <token>` or `access_token=<v>` or `kimi-auth=<v>` string also works).",
  models: Object.keys(MODEL_CONFIG),
  async chat({ credential, model, messages, stream, signal }) {
    const { mode, value } = extractKimiCredential(credential);
    if (!value) return { error: errorPayload(400, "Missing Kimi credential — paste access_token from localStorage or kimi-auth cookie.") };

    const prompt = foldMessages(messages);
    if (!prompt) return { error: errorPayload(400, "Kimi Web requires a non-empty user message.") };

    const config = resolveConfig(model);
    const body = JSON.stringify({
      chat_id: "",
      ...(config.kimiPlusId ? { kimiplus_id: config.kimiPlusId } : {}),
      scenario: config.scenario,
      tools: [],
      message: {
        id: "",
        parent_id: "",
        children_message_ids: [],
        role: "user",
        blocks: [{ id: "", message_id: "", text: { content: prompt } }],
        scenario: config.scenario,
        labels: [],
        references: [],
        is_goal: false,
      },
      options: { thinking: true },
      project_id: "",
    });

    const framed = (() => {
      const payload = new TextEncoder().encode(body);
      const framed = new Uint8Array(5 + payload.length);
      framed[0] = 0;
      framed[1] = (payload.length >>> 24) & 0xff;
      framed[2] = (payload.length >>> 16) & 0xff;
      framed[3] = (payload.length >>> 8) & 0xff;
      framed[4] = payload.length & 0xff;
      framed.set(payload, 5);
      return framed;
    })();

    const authHeader = mode === "cookie"
      ? { Cookie: `kimi-auth=${value}` }
      : { Authorization: `Bearer ${value}` };

    const upstream = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/connect+json",
        Accept: "*/*",
        "User-Agent": UA,
        Origin: BASE,
        Referer: `${BASE}/`,
        "connect-protocol-version": "1",
        ...authHeader,
      },
      body: framed,
      signal,
    });
    if (!upstream.ok) {
      const txt = await upstream.text().catch(() => "");
      return { error: errorPayload(upstream.status, `Kimi error: ${txt.slice(0, 300)}`) };
    }

    const decoder = new TextDecoder();
    const parseFrame = (buf, off) => {
      if (off + 5 > buf.length) return { consumed: 0 };
      const len = (buf[off + 1] << 24) | (buf[off + 2] << 16) | (buf[off + 3] << 8) | buf[off + 4];
      const msgLen = len < 0 ? len + 0x100000000 : len;
      if (off + 5 + msgLen > buf.length) return { consumed: 0 };
      let msg = null;
      if (msgLen > 0) {
        try { msg = JSON.parse(decoder.decode(buf.subarray(off + 5, off + 5 + msgLen))); } catch { /* */ }
      }
      return { consumed: 5 + msgLen, flags: buf[off], msg };
    };
    const extractDelta = (m) => {
      if (!m) return null;
      const op = String(m.op ?? "");
      const mask = String(m.mask ?? "");
      const block = (m.block ?? {});
      if (op === "append") {
        if (mask === "block.text.content") return { kind: "text", text: String((block.text ?? {}).content ?? "") };
        if (mask === "block.think.content") return { kind: "think", text: String((block.think ?? {}).content ?? "") };
      }
      if (op === "set") {
        if (mask === "block.text") return { kind: "text", text: String((block.text ?? {}).content ?? "") };
        if (mask === "block.think") return { kind: "think", text: String((block.think ?? {}).content ?? "") };
      }
      return null;
    };
    // Extract chat_id from any frame that carries it (for post-request cleanup).
    const extractChatId = (m) => {
      if (!m) return null;
      const id = m.chat_id || m.id;
      return typeof id === "string" && id ? id : null;
    };

    if (stream) {
      const sse = makeSseStream(model, async (emit) => {
        const reader = upstream.body.getReader();
        let buf = new Uint8Array(0);
        let ended = false;
        let chatId = null;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const merged = new Uint8Array(buf.length + value.length);
          merged.set(buf); merged.set(value, buf.length); buf = merged;
          let off = 0;
          while (off < buf.length) {
            const { consumed, flags, msg } = parseFrame(buf, off);
            if (consumed === 0) break;
            off += consumed;
            if (flags & 0x02) { ended = true; break; }
            const cid = extractChatId(msg);
            if (cid) chatId = cid;
            const d = extractDelta(msg);
            if (d) { emit.role(); d.kind === "think" ? emit.reasoning(d.text) : emit.content(d.text); }
          }
          buf = buf.subarray(off);
          if (ended) break;
        }
        emit.finish();
        deleteChat(chatId, authHeader, signal);
      });
      return { stream: new Response(sse, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } }) };
    }

    // non-streaming
    const reader = upstream.body.getReader();
    let buf = new Uint8Array(0);
    let content = "";
    let reasoning = "";
    let chatId = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const merged = new Uint8Array(buf.length + value.length);
      merged.set(buf); merged.set(value, buf.length); buf = merged;
      let off = 0;
      while (off < buf.length) {
        const { consumed, flags, msg } = parseFrame(buf, off);
        if (consumed === 0) break;
        off += consumed;
        if (flags & 0x02) break;
        const cid = extractChatId(msg);
        if (cid) chatId = cid;
        const d = extractDelta(msg);
        if (d) d.kind === "think" ? (reasoning += d.text) : (content += d.text);
      }
      buf = buf.subarray(off);
    }
    deleteChat(chatId, authHeader, signal);
    return { json: jsonCompletion(model, content, reasoning) };
  },
};
