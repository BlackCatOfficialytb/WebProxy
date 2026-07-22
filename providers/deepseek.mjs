// deepseek-web — chat.deepseek.com consumer chat. userToken (localStorage) -> access token.
import { UA, extractBearer, foldMessages, makeSseStream, jsonCompletion, jsonLinesFromSse, errorPayload } from "../shared.mjs";

const BASE = "https://chat.deepseek.com";
const API = `${BASE}/api`;
const NEW_URL = `${API}/v0/chat_session/create`;
const COMPLETION_URL = `${API}/v0/chat/completion`;

const tokenCache = new Map();

async function acquireToken(userToken, signal) {
  if (tokenCache.has(userToken)) return tokenCache.get(userToken);
  const r = await fetch(`${API}/v0/users/current`, { headers: { Authorization: `Bearer ${userToken}`, "User-Agent": UA }, signal });
  if (!r.ok) throw new Error("DeepSeek token invalid/expired");
  const j = await r.json();
  const t = j?.data?.biz_data?.token || j?.biz_data?.token;
  if (!t) throw new Error("DeepSeek token not found");
  tokenCache.set(userToken, t);
  return t;
}

export const deepseekWeb = {
  id: "deepseek-web",
  label: "DeepSeek (chat.deepseek.com)",
  credentialHint: "userToken from chat.deepseek.com localStorage",
  howto: "1) Log in at chat.deepseek.com. 2) Open DevTools → Application → Local Storage → https://chat.deepseek.com. 3) Copy the `userToken` value (it is JSON like {\"value\":\"...\"}). 4) Paste it here as-is.",
  models: ["deepseek-chat", "deepseek-reasoner"],
  async chat({ credential, model, messages, stream, signal }) {
    const userToken = extractBearer(credential);
    if (!userToken) return { error: errorPayload(400, "Missing DeepSeek userToken (localStorage).") };
    let accessToken;
    try { accessToken = await acquireToken(userToken, signal); } catch (e) { return { error: errorPayload(401, e.message) }; }

    const m = (model || "").toLowerCase();
    const thinking = m.includes("reason") || m.includes("r1");
    const prompt = foldMessages(messages);
    if (!prompt) return { error: errorPayload(400, "DeepSeek requires a non-empty message.") };

    const sessionR = await fetch(NEW_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, "User-Agent": UA }, body: "{}", signal });
    const sid = (await sessionR.json())?.data?.biz_data?.chat_session?.id;
    if (!sid) return { error: errorPayload(502, "DeepSeek session create failed") };

    const reqBody = { chat_session_id: sid, parent_message_id: null, model_type: "default", prompt, ref_file_ids: [], thinking_enabled: thinking, search_enabled: false, preempt: false };
    const upstream = await fetch(COMPLETION_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, "User-Agent": UA, Accept: "text/event-stream" }, body: JSON.stringify(reqBody), signal });
    if (!upstream.ok) return { error: errorPayload(upstream.status, `DeepSeek error: ${upstream.status}`) };

    // DeepSeek web SSE: {p, v} frames; v.response.fragments[].content with type THINK/ANSWER.
    const parseFrame = (obj) => {
      const v = obj.v;
      if (v && typeof v === "object" && Array.isArray(v.response?.fragments)) {
        const out = { content: "", reasoning: "" };
        for (const f of v.response.fragments) {
          if (typeof f?.content !== "string") continue;
          if (String(f.type).toUpperCase() === "THINK") out.reasoning += f.content;
          else out.content += f.content;
        }
        return out;
      }
      if (obj.p === "response/fragments" && Array.isArray(v)) {
        const out = { content: "", reasoning: "" };
        for (const f of v) {
          if (typeof f?.content !== "string") continue;
          if (String(f.type).toUpperCase() === "THINK") out.reasoning += f.content;
          else out.content += f.content;
        }
        return out;
      }
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
        }
        emit.finish();
      });
      return { stream: new Response(sse, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } }) };
    }

    let content = ""; let reasoning = "";
    for await (const obj of jsonLinesFromSse(upstream.body)) {
      const d = parseFrame(obj);
      if (!d) continue;
      content += d.content; reasoning += d.reasoning;
    }
    return { json: jsonCompletion(model, content, reasoning) };
  },
};
