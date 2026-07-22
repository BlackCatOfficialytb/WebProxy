// qwen-web — chat.qwen.ai v2 API. Needs full Cookie header + bearer token (baxia WAF).
import { UA, fullCookieHeader, extractBearer, foldMessages, makeSseStream, jsonCompletion, jsonLinesFromSse, errorPayload } from "../shared.mjs";

const BASE = "https://chat.qwen.ai";
const NEW_URL = `${BASE}/api/v2/chats/new`;
const CHAT_URL = `${BASE}/api/v2/chat/completions`;
const SPA_VERSION = "0.2.66";

const MODEL_ALIASES = {
  "qwen-plus": "qwen3.7-plus", "qwen-max": "qwen3.7-max", "qwen-turbo": "qwen3.6-plus",
  "qwen3-plus": "qwen3.7-plus", "qwen3-max": "qwen3.7-max", "qwen3-flash": "qwen3.6-plus",
  "qwen3-coder-flash": "qwen3.6-plus", qwen: "qwen3.7-max", qwen3: "qwen3.7-max",
};
const DEFAULT_MODEL = "qwen3.7-max";

export const qwenWeb = {
  id: "qwen-web",
  label: "Qwen (chat.qwen.ai)",
  credentialHint: "full Cookie header (cna, ssxmod_itna, token) from chat.qwen.ai",
  howto: "1) Log in at chat.qwen.ai. 2) Open DevTools → Application → Cookies → https://chat.qwen.ai and copy the `token` value. 3) Also copy the full `Cookie:` request header from Network (needs cna, ssxmod_itna, token). 4) Paste the whole Cookie header here.",
  models: ["qwen3.7-max", "qwen3.7-plus", "qwen3.6-plus", "qwen3-coder-plus"],
  async chat({ credential, model, messages, stream, signal }) {
    const cookie = fullCookieHeader(credential);
    const token = extractBearer(credential);
    if (!cookie) return { error: errorPayload(400, "Missing Qwen cookie header (WAF requires the full jar).") };

    const modelId = MODEL_ALIASES[model] || model || DEFAULT_MODEL;
    const { chat_id } = await (await fetch(NEW_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA, Origin: BASE, Referer: `${BASE}/`, version: SPA_VERSION, Cookie: cookie, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ title: "webproxy" }),
      signal,
    })).json().catch(() => ({}));

    const reqBody = {
      chat_id,
      stream: true,
      model: modelId,
      messages: (messages || []).map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) })),
    };
    const headers = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "User-Agent": UA,
      Origin: BASE,
      Referer: chat_id ? `${BASE}/c/${chat_id}` : `${BASE}/`,
      source: "web",
      version: SPA_VERSION,
      "x-request-id": crypto.randomUUID(),
      Cookie: cookie,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const upstream = await fetch(`${CHAT_URL}${chat_id ? `?chat_id=${chat_id}` : ""}`, { method: "POST", headers, body: JSON.stringify(reqBody), signal });
    if (!upstream.ok) {
      const txt = await upstream.text().catch(() => "");
      return { error: errorPayload(upstream.status, `Qwen error: ${txt.slice(0, 300)}`) };
    }

    // phase: think/thinking_summary -> reasoning; answer/null -> content.
    const parseFrame = (obj) => {
      const choices = obj.choices;
      if (Array.isArray(choices) && choices.length) {
        const d = choices[0].delta || {};
        const phase = String(d.phase ?? "");
        const content = typeof d.content === "string" ? d.content : "";
        const reasoning = typeof d.reasoning_content === "string" ? d.reasoning_content : (phase === "think" || phase === "thinking_summary" ? content : "");
        return { content: phase === "answer" || phase === "" ? content : "", reasoning, done: choices[0].finish_reason != null };
      }
      return null;
    };

    if (stream) {
      const sse = makeSseStream(model, async (emit) => {
        for await (const obj of jsonLinesFromSse(upstream.body)) {
          const d = parseFrame(obj);
          if (!d) continue;
          emit.role();
          if (d.reasoning) emit.reasoning(d.reasoning);
          if (d.content) emit.content(d.content);
          if (d.done) { emit.finish(); break; }
        }
      });
      return { stream: new Response(sse, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } }) };
    }

    let content = ""; let reasoning = "";
    for await (const obj of jsonLinesFromSse(upstream.body)) {
      const d = parseFrame(obj);
      if (!d) continue;
      content += d.content; reasoning += d.reasoning;
      if (d.done) break;
    }
    return { json: jsonCompletion(model, content, reasoning) };
  },
};
