// t3-web — t3.chat (free) web-cookie provider
// Auth: cookie + session from t3.chat
// Uses OmniRoute GLM patterns

import { axios, UA, extractCookieValue, makeSseStream, jsonCompletion, jsonLinesFromSse, errorPayload, nodeStreamToWeb } from "../shared.mjs";

const BASE = "https://t3.chat";
const CHAT_URL = `${BASE}/api/chat/completions`;

export const t3Web = {
  id: "t3-web",
  label: "t3.chat (Free)",
  credentialHint: "convex-session-id from t3.chat (localStorage) + Cookie",
  howto: "1) Open t3.chat in your browser, log in (free tier — limited model access).\n2) Open DevTools → Application → Local Storage → https://t3.chat.\n3) Copy the value of 'convex-session-id'.\n4) Also open DevTools → Network → copy the Cookie header from any request.\n5) Paste both as `convex-session-id=<...>; <cookie>` here.",
  models: ["claude-opus-4-8", "claude-sonnet-4-6", "gemini-3-flash", "gpt-5.6"],
  async chat({ credential, model, messages, stream, signal }) {
    const raw = credential.trim();
    const sessionId = extractCookieValue(raw, "convex-session-id");
    const cookie = extractCookieValue(raw, "__Secure-next-auth.session-token");
    if (!sessionId) return { error: errorPayload(400, "Missing convex-session-id from t3.chat. Open DevTools → Application → Local Storage.") };

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
      "X-Convex-Session-Id": sessionId,
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
      return { error: errorPayload(status, `t3.chat error: ${txt.slice(0, 300)}`) };
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