# WebProxy — standalone web-provider gateway

A dependency-free Node server that exposes an **OpenAI-compatible** `/v1` API on
`http://localhost:16769`, routing only to **consumer web-chat providers** (the
sites you log into with a browser session cookie/token, used for free). Modeled on
9Router's single-endpoint shape, but scoped to web providers.

## Supported web providers

| Provider id   | Site / auth                                                        |
| ------------- | ------------------------------------------------------------------ |
| `kimi-web`    | www.kimi.com — `access_token` (localStorage)                       |
| `zai-web`     | chat.z.ai — `token` cookie (Z.AI / GLM international)              |
| `chatglm-web` | chatglm.cn — `chatglm_session` cookie (Zhipu mainland)             |
| `deepseek-web`| chat.deepseek.com — `userToken` (localStorage)                     |
| `doubao-web`  | www.dola.com — session cookie                                      |
| `qwen-web`    | chat.qwen.ai — full Cookie header + `token`                        |

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
  -d '{"provider":"kimi-web","model":"kimi-k2","stream":true,"messages":[{"role":"user","content":"hi"}]}'
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
- `chatglm-web` uses the chatglm.cn consumer endpoint; if Zhipu changes it, update
  `CHATGLM_URL` in `providers/chatglm.mjs`.

## License

Public domain — released under [The Unlicense](LICENSE) (also CC0-1.0). No Apache,
MIT, or GPL terms apply; do whatever you want with it.
