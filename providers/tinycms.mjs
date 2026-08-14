// tinycms-web — TinyCMS (free) web-cookie provider
// Auth: local storage from site.tinycms.xyz
// Uses OmniRoute GLM patterns

import { axios, UA, extractCookieValue, makeSseStream, jsonCompletion, jsonLinesFromSse, errorPayload, nodeStreamToWeb } from "../shared.mjs";

const BASE = "https://site.tinycms.xyz";
const CHAT_URL = `${BASE}/api/chat/completions`;

export const tinycmsWeb = {
  id: "tinycms-web",
  label: "TinyCMS (Free)",
  credentialHint: "app-config-uuid from site.tinycms.xyz (localStorage)",
  howto: "1) Go to site.tinycms.xyz in your browser.\n2) Open DevTools → Application → Local Storage → site.tinycms.xyz.\n3) Copy the value of 'app-config-uuid' (starts with 'R').\n4) Paste it here.\n5) Free tier has access to GPT 5.4, Gemini 3.5, Grok 4.20 — no login required.",
  models: ["gpt-5.4", "gemini-3.5", "grok-4.20"],
  async chat({ credential, model, messages, stream, signal }) {
    const uuid = credential.trim();
    if (!uuid) return { error: errorPayload(400, "Missing app-config-uuid from site.tinycms.xyz. Open DevTools → Application → Local Storage.") };

    const reqBody = {
      stream: true,
      model,
      messages: (messages || []).map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) })),
    };
    const headers = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "User-Agent": UA,
      Origin: BASE,
      Referer: `${BASE}/`,
      "X-UUID": uuid,
    };

    let upstream;
    try {
      upstream = await axios({
        method: "POST",
        url: CHAT_URL,
        headers,
        data: JSON.stringify(reqBody),
        responseType: "stream",
        signal,
      });
    } catch (e) {
      const status = e.response?.status || 502;
      const txt = e.response?.data ? await e.response.data.text?.().catch(() => "") || "" : e.message;
      return { error: errorPayload(status, `TinyCMS error: ${txt.slice(0, 300)}`) };
    }
    const upstreamStream = nodeStreamToWeb(upstream.data);

    const parseFrame = (obj) => {
      const choices = obj.choices;
      if (Array.isArray(choices) && choices.length) {
        const d = choices[0].delta || {};
        return { content: typeof d.content === "string" ? d.content : "", reasoning: typeof d.reasoning_content === "string" ? d.reasoning_content : "", done: choices[0].finish_reason != null };
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