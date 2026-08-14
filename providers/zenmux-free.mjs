// zenmux-free — ZenMux (free) web-cookie provider
// Auth: cookie from zenmux.ai
// Uses OmniRoute GLM patterns

import { axios, UA, extractCookieValue, makeSseStream, jsonCompletion, jsonLinesFromSse, errorPayload, nodeStreamToWeb } from "../shared.mjs";

const BASE = "https://zenmux.ai";
const CHAT_URL = `${BASE}/api/chat/completions`;

export const zenmuxFree = {
  id: "zenmux-free",
  label: "ZenMux (Free)",
  credentialHint: "cookie from zenmux.ai (full Cookie header)",
  howto: "1) Login at zenmux.ai in your browser.\n2) Export all cookies using EditThisCookie or Cookie-Editor.\n3) Paste the full Cookie header string here.\n4) Free tier (5 Flows/5h, 38.64 Flows/week) — DeepSeek V3.2, GLM 4.7 Flash Free. No subscription required.",
  models: ["deepseek-v3.2", "glm-4.7-flash", "glm-5.2"],
  async chat({ credential, model, messages, stream, signal }) {
    const cookie = credential.trim();
    if (!cookie) return { error: errorPayload(400, "Missing cookie from zenmux.ai. Login and export cookies.") };

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
      Cookie: cookie,
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
      return { error: errorPayload(status, `ZenMux error: ${txt.slice(0, 300)}`) };
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