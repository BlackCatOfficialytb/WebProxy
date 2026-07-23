// doubao-web — www.dola.com (Doubao global consumer chat). Full session cookie.
import { axios, UA, fullCookieHeader, foldMessages, makeSseStream, jsonCompletion, jsonLinesFromSse, errorPayload, nodeStreamToWeb } from "../shared.mjs";

const BASE = "https://www.dola.com";
const CHAT_URL = `${BASE}/chat/completion`;
const DOLA_BOT_ID = "7339470689562525703";

export const doubaoWeb = {
  id: "doubao-web",
  label: "Doubao (www.dola.com)",
  credentialHint: "full Cookie header from www.dola.com",
  howto: "1) Log in at www.dola.com (Doubao global).\n2) Open DevTools → Network, refresh, click any request → copy the full `Cookie:` request header.\n3) Paste the whole Cookie header here.",
  models: ["dola-speed", "dola-pro", "dola-deep-think"],
  async chat({ credential, model, messages, stream, signal }) {
    const cookie = fullCookieHeader(credential);
    if (!cookie) return { error: errorPayload(400, "Missing dola.com session cookie.") };

    const prompt = foldMessages(messages);
    if (!prompt) return { error: errorPayload(400, "Doubao requires a non-empty message.") };

    const reqBody = {
      bot_id: DOLA_BOT_ID,
      prompt: { content: prompt, attachments: [] },
      stream: true,
      detail: { type: model.includes("pro") || model.includes("think") ? "deep" : "normal" },
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
      return { error: errorPayload(status, `Doubao error: ${txt.slice(0, 300)}`) };
    }
    const upstreamStream = nodeStreamToWeb(upstream.data);

    // dola SSE: data: {block_type, content, is_finish,...}; block_type 10040 = answer finish.
    const parseFrame = (obj) => {
      const blockType = obj.block_type;
      const content = typeof obj.content === "string" ? obj.content : (typeof obj?.data?.content === "string" ? obj.data.content : "");
      if (blockType === 10040) return { content, done: obj.is_finish === true };
      if (content) return { content, done: false };
      return null;
    };

    if (stream) {
      const sse = makeSseStream(model, async (emit) => {
        for await (const obj of jsonLinesFromSse(upstreamStream)) {
          const d = parseFrame(obj);
          if (!d) continue;
          emit.role();
          if (d.content) emit.content(d.content);
          if (d.done) { emit.finish(); break; }
        }
      });
      return { stream: new Response(sse, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } }) };
    }

    let content = "";
    for await (const obj of jsonLinesFromSse(upstreamStream)) {
      const d = parseFrame(obj);
      if (!d) continue;
      content += d.content;
      if (d.done) break;
    }
    return { json: jsonCompletion(model, content, "") };
  },
};
