// lmarena — Arena (free) web-cookie provider
// Auth: cookie from arena.ai
// Uses OmniRoute GLM patterns

import { axios, UA, extractCookieValue, makeSseStream, jsonCompletion, jsonLinesFromSse, errorPayload, nodeStreamToWeb } from "../shared.mjs";

const BASE = "https://arena.ai";
const CHAT_URL = `${BASE}/api/chat/completions`;

export const lmarena = {
  id: "lmarena",
  label: "Arena Web (Free)",
  credentialHint: "cookie from arena.ai (include arena-auth-prod-v1.0)",
  howto: "1) Open arena.ai in your browser.\n2) Log in (free — no subscription required).\n3) Open DevTools → Network → any request → Request Headers → Cookie.\n4) Copy the full Cookie header value.\n5) Paste it here (include arena-auth-prod-v1.0, cf_clearance, etc.)",
  models: ["claude-opus-4-8", "claude-sonnet-4-6", "gemini-3-flash", "gpt-5.6", "deepseek-v3"],
  async chat({ credential, model, messages, stream, signal }) {
    const cookie = credential.trim();
    if (!cookie) return { error: errorPayload(400, "Missing cookie from arena.ai. Log in and copy your Cookie header.") };

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
      return { error: errorPayload(status, `Arena error: ${txt.slice(0, 300)}`) };
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