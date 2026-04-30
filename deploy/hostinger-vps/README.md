# Achiote — Hostinger VPS Deployment

Deploy Achiote to the same Hostinger VPS (`187.124.238.235`) that runs Declutter and DialectOS.

## Quick Start

1. Copy `env.example` to `env.hostinger` and fill in your values:
   ```bash
   cp env.example env.hostinger
   ```

2. Configure your provider:

   **Cloud (GLM/Z.AI) — default:**
   ```env
   ACHIOTE_ASK_PROVIDER=glm
   GLM_API_KEY=your-key

   # GLM Coding Plan models use Z.ai's Anthropic-compatible endpoint.
   ACHIOTE_ASK_MODEL=GLM-4.5-Air
   GLM_BASE_URL=https://api.z.ai/api/anthropic
   # GLM_MODEL=GLM-4.5-Flash
   ```

   **Local inference via Tailscale — for demo/cost savings:**
   ```env
   ACHIOTE_ASK_PROVIDER=local
   ACHIOTE_ASK_MODEL=your-loaded-model
   LOCAL_INFERENCE_BASE_URL=http://host.docker.internal:1234/v1
   LOCAL_INFERENCE_MODEL=your-loaded-model
   ```

3. Deploy:
   ```bash
   docker compose up -d --build
   ```

## Tailscale Setup

The local inference pattern works exactly like Declutter and DialectOS:

1. Your home machine runs an inference server (LM Studio, Ollama, etc.) on port 1234
2. Both your home machine and the VPS are on the same Tailscale network
3. The VPS can reach your home machine via its Tailscale IP (`100.x.x.x`)
4. `host.docker.internal:host-gateway` mapping allows the container to reach the VPS host, which routes through Tailscale

### Option A: Via host.docker.internal (if inference runs on VPS host)

```env
LOCAL_INFERENCE_BASE_URL=http://host.docker.internal:1234/v1
```

### Option B: Via Tailscale IP directly (if inference runs on home machine)

```env
LOCAL_INFERENCE_BASE_URL=http://100.x.x.x:1234/v1
```

Replace `100.x.x.x` with your home machine's Tailscale IP.

## Switching Between Providers

To switch from cloud to local inference (or vice versa):

1. Edit `env.hostinger` with the new provider settings
2. Restart the container:
   ```bash
   docker compose up -d
   ```

No rebuild is needed — the provider is selected at runtime via environment variables.

## Health Check

```bash
curl https://achiote.kyanitelabs.tech/health
```

Expected response:
```json
{
  "status": "ok",
  "version": "0.2.0",
  "authEnabled": true,
  "readiness": {
    "ready": true,
    "status": "ok",
    "checks": [...]
  }
}
```

## Cost Comparison

| Provider | Cost | Latency | Notes |
|----------|------|---------|-------|
| GLM (Z.AI) | ~$0.01-0.05/request | ~2-5s | Cloud API, pay per use |
| Local (Tailscale) | $0 (your hardware) | ~1-10s | Depends on your GPU/CPU |

For demo and development, local inference via Tailscale eliminates API costs entirely.
