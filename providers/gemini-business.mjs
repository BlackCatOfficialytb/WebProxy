// gemini-business — Gemini Business (free) web-cookie provider
// Auth: cookies from business.gemini.google (__Secure-1PSID + __Secure-1PSIDTS)
// Uses OmniRoute GLM patterns

import { axios, UA, extractCookieValue, makeSseStream, jsonCompletion, jsonLinesFromSse, errorPayload, nodeStreamToWeb } from "../shared.mjs";

const BASE = "https://business.gemini.google";
const CHAT_URL = `${BASE}/api/chat/completions`;

export const geminiBusiness = {
  id: "gemini-business",
  label: "Gemini Business (Free)",
  credentialHint: "__Secure-1PSID and __Secure-1PSIDTS from business.gemini.google",
  howto: "1) From your Google Workspace enterprise account, open business.gemini.google/home/cid/{your-cid}.\n2) Open DevTools → Application → Cookies → business.gemini.google.\n3) Copy both __Secure-1PSID and __Secure-1PSIDTS cookies.\n4) Paste them here (separated by semicolon).\n5) Free for enterprise Google Workspace accounts — no subscription required.",
  models: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash"],
  async chat({ credential, model, messages, stream, signal }) {
    const raw = credential.trim();
    const psid = extractCookieValue(raw, "__Secure-1PSID");
    const psidts = extractCookieValue(raw, "__Secure-1PSIDTS");
    if (!psid) return { error: errorPayload(400, "Missing __Secure-1PSID cookie from business.gemini.google.") };

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
      Cookie: `__Secure-1PSID=${psid}; __Secure-1PSIDTS=${psidts || ""}`,
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
      return { error: errorPayload(status, `Gemini Business error: ${txt.slice(0, 300)}`) };
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