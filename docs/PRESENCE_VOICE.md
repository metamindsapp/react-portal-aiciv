# Portal Voice Presence

Portal Voice Presence adds a realtime voice surface to the existing AICIV Portal while keeping the Portal itself as the canonical local adapter to the durable AICIV.

## Architecture

```text
Browser / Portal Chat
        │
        │ Portal bearer auth
        ▼
react-portal-aiciv
        │
        │ server-only PRESENCE_GATEWAY_API_KEY
        ▼
aiciv-presence-gateway
        │
        ├── ElevenLabs Speech Engine: STT / turn-taking / TTS / WebRTC
        ├── Presence LLM: low-latency spoken cognition
        └── ask_primary(): durable work through this same Portal/AICIV
```

The browser does **not** receive:
- `PRESENCE_GATEWAY_API_KEY`;
- `ELEVENLABS_API_KEY`;
- `OPENAI_API_KEY`;
- `AICIV_CALLBACK_API_KEY`;
- the Portal server's own `.portal-token` beyond its normal authenticated application use.

The browser receives only a short-lived ElevenLabs conversation token minted for the current voice session.

## Portal configuration

Add these values to the AICIV container's process environment or `~/.env`:

```bash
# Publicly/privately reachable HTTP(S) URL of the Presence Gateway from this
# Portal server. Do not include a trailing slash.
PRESENCE_GATEWAY_URL=https://presence.example.com

# Server-to-server API key configured as PRESENCE_GATEWAY_API_KEY on the
# Presence Gateway. Use a long random value and never expose it to browser code.
PRESENCE_GATEWAY_API_KEY=replace-with-a-long-random-secret

# Optional Portal -> Gateway timeout; defaults to 8 seconds.
PRESENCE_GATEWAY_TIMEOUT_SECONDS=8
```

For durable AICIV completion receipts, the trusted AICIV container also needs:

```bash
# This is intentionally a separate, callback-only authority.
AICIV_CALLBACK_API_KEY=replace-with-a-different-long-random-secret
```

The Presence Gateway must be configured with the same callback key and with this Portal's URL/token as its durable AICIV transport.

## Start Portal

`start.sh` now launches `portal_entrypoint.py`, which imports the existing `portal_server.app`, registers the Presence routes, and serves the same Starlette app.

```bash
./start.sh
```

Optional port override:

```bash
./start.sh 8097
```

The integration intentionally leaves `portal_server.py` untouched. This makes upstream Portal maintenance much less likely to conflict with the voice module.

## Portal routes

### `GET /api/presence/status`

Requires normal Portal bearer authentication.

Returns only capability state, for example:

```json
{
  "configured": true,
  "surface": "portal",
  "civ": "synth",
  "voice": { "available": true }
}
```

It never exposes the Presence Gateway URL or key.

### `POST /api/presence/voice/token`

Requires normal Portal bearer authentication.

The Portal calls the Presence Gateway server-to-server and returns only:

```json
{
  "token": "<short-lived ElevenLabs WebRTC token>",
  "conversationId": "conv_..."
}
```

Upstream diagnostic bodies are deliberately not proxied into the browser.

## Browser behavior

The Chat toolbar includes a Voice button. On an explicit user click it:

1. requests microphone permission;
2. immediately closes the temporary permission-probe stream;
3. requests a short-lived conversation token from the Portal server;
4. starts the ElevenLabs authenticated WebRTC session;
5. displays realtime state: Connecting, Listening, Speaking, Muted;
6. allows explicit mute/unmute and end-session controls.

The conversation token is kept only in memory and is never written to `localStorage`.

## Relationship to durable delegation

Voice Presence is deliberately not a separate AICIV.

When a spoken request needs substantial work, Presence can call:

```text
ask_primary(goal, expected_return, urgency)
```

The Presence Gateway persists a durable job, then delivers it through the existing Portal chat injection path to the same primary AICIV. The Portal-distributed `presence-job` skill reports explicit running/completion/cancellation receipts back to the gateway.

That means typed Portal chat and spoken Presence remain two surfaces over the same durable intelligence rather than becoming separate assistants with diverging state.

## Production checklist

Before enabling voice for clients:

- Presence Gateway is TLS-reachable by Portal and ElevenLabs as required by your deployment topology.
- Portal has `PRESENCE_GATEWAY_URL` and `PRESENCE_GATEWAY_API_KEY` server-side.
- Presence Gateway has its ElevenLabs Speech Engine ID/API key and OpenAI key.
- Presence Gateway is configured to use this Portal as its `AicivTransport`.
- `AICIV_CALLBACK_API_KEY` is installed only on trusted AICIV runtime(s).
- Browser origin is HTTPS so microphone/WebRTC APIs are available outside localhost.
- Voice latency, disconnect rate, barge-in, and per-tenant usage are instrumented before broad rollout.
