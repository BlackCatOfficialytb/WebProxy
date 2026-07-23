// qwen-web — chat.qwen.ai v2 API. Needs full Cookie header + bearer token (baxia WAF).
import { axios, UA, fullCookieHeader, extractBearer, foldMessages, makeSseStream, jsonCompletion, jsonLinesFromSse, errorPayload, nodeStreamToWeb } from "../shared.mjs";

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
  howto: "1) Log in at chat.qwen.ai.\n2) Open DevTools → Application → Cookies → https://chat.qwen.ai and copy the `token` value.\n3) Also copy the full `Cookie:` request header from Network (needs cna, ssxmod_itna, token).\n4) Paste the whole Cookie header here.",
  models: ["qwen3.7-max", "qwen3.7-plus", "qwen3.6-plus", "qwen3-coder-plus"],
  async chat({ credential, model, messages, stream, signal }) {
    const cookie = fullCookieHeader(credential);
    const token = extractBearer(credential);
    if (!cookie) return { error: errorPayload(400, "Missing Qwen cookie header (WAF requires the full jar).") };

    const modelId = MODEL_ALIASES[model] || model || DEFAULT_MODEL;
    const newHeaders = { "Content-Type": "application/json", "User-Agent": UA, Origin: BASE, Referer: `${BASE}/`, version: SPA_VERSION, Cookie: cookie };
    if (token) newHeaders.Authorization = `Bearer ${token}`;
    let chat_id;
    try {
      const newResp = await axios({ method: "POST", url: NEW_URL, headers: newHeaders, data: JSON.stringify({ title: "webproxy" }), signal });
      chat_id = newResp.data?.chat_id;
    } catch { /* no chat_id */ }

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

    let upstream;
    try {
      upstream = await axios({
        method: "POST",
        url: `${CHAT_URL}${chat_id ? `?chat_id=${chat_id}` : ""}`,
        headers,
        data: JSON.stringify(reqBody),
        responseType: "stream",
        signal,
      });
    } catch (e) {
      const status = e.response?.status || 502;
      const txt = e.response?.data ? await e.response.data.text?.().catch(() => "") || "" : e.message;
      return { error: errorPayload(status, `Qwen error: ${txt.slice(0, 300)}`) };
    }
    const upstreamStream = nodeStreamToWeb(upstream.data);

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
        for await (const obj of jsonLinesFromSse(upstreamStream)) {
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
    for await (const obj of jsonLinesFromSse(upstreamStream)) {
      const d = parseFrame(obj);
      if (!d) continue;
      content += d.content; reasoning += d.reasoning;
      if (d.done) break;
    }
    return { json: jsonCompletion(model, content, reasoning) };
  },
};
