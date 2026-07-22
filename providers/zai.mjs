// zai-web — chat.z.ai (Z.AI / GLM international consumer chat). OpenAI-shaped SSE.
import { UA, extractCookieValue, makeSseStream, jsonCompletion, jsonLinesFromSse, errorPayload } from "../shared.mjs";

const BASE = "https://chat.z.ai";
const CHAT_URL = `${BASE}/api/chat/completions`;

export const zaiWeb = {
  id: "zai-web",
  label: "Z.AI Web (chat.z.ai / GLM)",
  credentialHint: "token=<JWT> cookie from chat.z.ai",
  howto: "1) Log in at chat.z.ai. 2) Open DevTools → Application → Cookies → https://chat.z.ai. 3) Copy the `token` cookie (a JWT). 4) Paste `token=<JWT>` or the full Cookie header here.",
  models: ["glm-4.6", "glm-4.7", "glm-4.6v"],
  async chat({ credential, model, messages, stream, signal }) {
    const rawCookie = credential.trim();
    const token = extractCookieValue(rawCookie, "token");
    if (!rawCookie && !token) return { error: errorPayload(400, "Missing Z.ai session (token cookie from chat.z.ai).") };

    const reqBody = {
      stream: true,
      model,
      messages: (messages || []).map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) })),
      params: {},
      features: { image_generation: false, web_search: false, auto_web_search: false },
    };

    const headers = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "User-Agent": UA,
      Origin: BASE,
      Referer: `${BASE}/`,
    };
    if (rawCookie) headers.Cookie = rawCookie;
    if (token) headers.Authorization = `Bearer ${token}`;

    const upstream = await fetch(CHAT_URL, { method: "POST", headers, body: JSON.stringify(reqBody), signal });
    if (!upstream.ok) {
      const txt = await upstream.text().catch(() => "");
      return { error: errorPayload(upstream.status, `Z.ai error: ${txt.slice(0, 300)}`) };
    }

    const parseFrame = (obj) => {
      const choices = obj.choices;
      if (Array.isArray(choices) && choices.length) {
        const d = choices[0].delta || {};
        return { content: typeof d.content === "string" ? d.content : "", reasoning: typeof d.reasoning_content === "string" ? d.reasoning_content : "", done: choices[0].finish_reason != null };
      }
      const data = obj.data || obj;
      const phase = String(data.phase ?? "");
      const dc = data.delta_content ?? data.edit_content ?? data.content;
      if (typeof dc === "string" && dc) {
        const thinking = phase === "thinking";
        return { content: thinking ? "" : dc, reasoning: thinking ? dc : "", done: data.done === true || phase === "done" || phase === "finish" };
      }
      if (data.done === true || phase === "done" || phase === "finish") return { content: "", reasoning: "", done: true };
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
