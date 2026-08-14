// muse-spark-web — Muse Spark (free) web-cookie provider
// Auth: cookie + WS token from meta.ai
// Uses OmniRoute GLM patterns

import { axios, UA, extractCookieValue, makeSseStream, jsonCompletion, jsonLinesFromSse, errorPayload, nodeStreamToWeb } from "../shared.mjs";

const BASE = "https://www.meta.ai";
const CHAT_URL = `${BASE}/api/chat/completions`;

export const museSparkWeb = {
  id: "muse-spark-web",
  label: "Muse Spark (Free)",
  credentialHint: "ecto_1_sess cookie AND ecto1: WS auth token from meta.ai",
  howto: "1) Open meta.ai in your browser.\n2) Log in (Meta AI platform — Llama models, free).\n3) Open DevTools → Network → WS → find the 'clippy' request → Authorization query param.\n4) Copy the ecto1: token AND the ecto_1_sess cookie.\n5) Paste as `ecto_1_sess=<...>; ecto1:<...>` here.",
  models: ["llama-4", "llama-3.3-70b", "llama-3.1-405b"],
  async chat({ credential, model, messages, stream, signal }) {
    const raw = credential.trim();
    const sess = extractCookieValue(raw, "ecto_1_sess");
    const wsToken = extractCookieValue(raw, "ecto1");
    if (!sess) return { error: errorPayload(400, "Missing ecto_1_sess cookie from meta.ai. Log in and capture the WS token.") };

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
      Cookie: `ecto_1_sess=${sess}; ${wsToken ? `ecto1=${wsToken}` : ""}`,
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
      return { error: errorPayload(status, `Meta AI error: ${txt.slice(0, 300)}`) };
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