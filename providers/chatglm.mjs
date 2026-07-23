// chatglm-web — chatglm.cn (Zhipu AI mainland consumer chat).
// Auth: `chatglm_session` cookie. Endpoint: the consumer chat API, OpenAI-shaped SSE.
import { axios, UA, extractCookieValue, foldMessages, makeSseStream, jsonCompletion, jsonLinesFromSse, errorPayload, nodeStreamToWeb } from "../shared.mjs";

const BASE = "https://chatglm.cn";
// Consumer web chat endpoint (OpenAI-compatible SSE). Update here if Zhipu changes it.
const CHAT_URL = `${BASE}/openapi/v1/chat/completions`;

export const chatglmWeb = {
  id: "chatglm-web",
  label: "ChatGLM (chatglm.cn)",
  credentialHint: "chatglm_session=<...> cookie from chatglm.cn",
  howto: "1) Log in at chatglm.cn (phone number).\n2) Open DevTools → Application → Cookies → https://chatglm.cn.\n3) Copy the `chatglm_session` cookie.\n4) Paste `chatglm_session=<value>` (or full Cookie header) here.",
  models: ["glm-4-plus", "glm-4-air", "glm-4-flash", "glm-4v"],
  async chat({ credential, model, messages, stream, signal }) {
    const session = extractCookieValue(credential, "chatglm_session");
    if (!session) return { error: errorPayload(400, "Missing chatglm_session cookie from chatglm.cn.") };

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
      Cookie: `chatglm_session=${session}`,
      Authorization: `Bearer ${session}`,
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
      return { error: errorPayload(status, `ChatGLM error: ${txt.slice(0, 300)}`) };
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
