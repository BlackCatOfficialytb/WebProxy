# WebProxy — standalone web-provider gateway

A dependency-free Node server that exposes an **OpenAI-compatible** `/v1` API on
`http://localhost:16769`, routing only to **consumer web-chat providers** (the
sites you log into with a browser session cookie/token, used for free).

**This is a standalone tool.** It has zero connection to 9Router's codebase and
cannot be merged into it — 9Router is a full-featured AI gateway with hundreds
of API-key providers, OAuth flows, combos, and a Next.js frontend. WebProxy
exists because web-session providers (Kimi, ChatGLM, Qwen, etc.) require
browser-cookie reverse-proxying that doesn't fit 9Router's architecture.

**Recommended:** run WebProxy alongside 9Router. Point both at the same model
names and let 9Router handle routing, fallback, and your API-key providers while
WebProxy fills the free web-session tier. Example combo:

```
9Router (localhost:16760)          WebProxy (localhost:16769)
├── OpenAI (api-key)               ├── kimi-web / kimi-k3
├── Anthropic (api-key)            ├── qwen-web / qwen3.7-max
├── Gemini (oauth)                 ├── deepseek-web
└── ...                            └── ...
```

## Supported web providers

| Provider id    | Site / auth                                                       | Models |
| -------------- | ----------------------------------------------------------------- | ------ |
| `kimi-web`     | www.kimi.com — `access_token` (localStorage) or `kimi-auth` cookie | kimi-k2.6, kimi-k3, kimi-k3-swarm |
| `zai-web`      | chat.z.ai — `token` cookie (Z.AI / GLM international)             | glm-4.6, glm-4.7, glm-4.6v |
| `chatglm-web`  | chatglm.cn — `chatglm_session` cookie (Zhipu mainland)            | glm-4-plus, glm-4-air, glm-4-flash, glm-4v |
| `deepseek-web` | chat.deepseek.com — `userToken` (localStorage)                    | deepseek-chat, deepseek-reasoner |
| `doubao-web`   | www.dola.com — session cookie                                     | dola-speed, dola-pro, dola-deep-think |
| `qwen-web`     | chat.qwen.ai — full Cookie header + `token`                       | qwen3.7-max, qwen3.7-plus, qwen3.6-plus, qwen3-coder-plus |

All run **unauthenticated locally** (it only listens on localhost). Each provider
needs one credential pasted from your browser.

## Run

```bash
node server.mjs            # listens on http://localhost:16769
PORT=18080 node server.mjs # custom port
```

## Configure a provider (via the localhost UI)

Open `http://localhost:16769/` in your browser. The dashboard shows a card per
provider with a built-in **chat playground** (pick provider + model, type a
message, streamed responses). Paste a cookie/token and click **+ Add key**.

**Multiple keys per provider are supported.** Add as many sessions as you like —
on a 401/403/429 the gateway automatically fails over to the next key. Remove any
key with its **remove** button.

Or via the API:

```bash
# add a key (repeat to add more; they form a failover pool)
curl -sS -X POST http://localhost:16769/api/connections \
  -H 'Content-Type: application/json' \
  -d '{"provider":"kimi-web","credential":"<access_token or Bearer ...>"}'

# list providers + key counts
curl -sS http://localhost:16769/api/connections

# remove key #0 for a provider
curl -sS -X DELETE http://localhost:16769/api/connections/kimi-web/0
```

## Chat (OpenAI-compatible)

```bash
curl -sS http://localhost:16769/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"provider":"kimi-web","model":"kimi-k3","stream":true,"messages":[{"role":"user","content":"hi"}]}'
```

- `provider` selects which web site to hit (required; no key needed on the request).
- `model` is the provider-native model id (defaults per provider).
- `stream` true/false → SSE vs JSON, exactly like OpenAI.

## Endpoints

- `GET  /api/health`          → `{"ok":true}`
- `GET  /v1/models`           → list models grouped by provider
- `POST /v1/chat/completions` → chat (needs `provider` in body)
- `GET/POST /api/connections` → list / upsert provider credentials
- `GET  /`                     → dashboard UI (provider cards + chat playground)
- `DELETE /api/connections/:provider/:index` → remove one key from a provider

## Notes

- Credentials are kept **in memory only** (lost on restart). Never expose the port.
- This is a reverse proxy to third-party web UIs; respect each site's ToS.
- Kimi conversations are automatically deleted after each request.
- `chatglm-web` uses the chatglm.cn consumer endpoint; if Zhipu changes it, update
  `CHATGLM_URL` in `providers/chatglm.mjs`.

## License

Public domain — released under [The Unlicense](LICENSE) (also CC0-1.0). No Apache,
MIT, or GPL terms apply; do whatever you want with it.
