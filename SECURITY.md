# Security Policy

## Supported versions

Achiote is pre-1.0. Security fixes target the current `master` branch until release branches exist.

## Reporting a vulnerability

Please do not open public issues for vulnerabilities. Report privately to the repository owner with:

- affected commit/version
- reproduction steps or MCP inputs
- expected impact
- whether credentials, filesystem paths, or private user food-memory data are exposed

## Security model

Achiote runs in two modes:

1. **stdio MCP server** — the primary mode, used by Claude Code, Codex, and other MCP clients. No network listener.
2. **HTTP server** (`node dist/http-server.js`) — optional mode for web UI and AI agent access. Exposes `/health`, `/ask`, `/mcp`, and static file endpoints.

Primary risks are:

- prompt-injection through user-provided memories or ingredient/location fields passed to host-model prompts — mitigated by `sanitizeForPrompt` which strips `<user_input>` tags, control characters, and JSON-wraps user values as inert data literals
- cache privacy and filesystem permissions
- accidental publication of runtime state
- supply-chain risk from npm dependencies and native `better-sqlite3`

### HTTP server security

- **Authentication** — configurable via `ACHIOTE_AUTH_ENABLED` env var. When enabled, requires API key via `x-api-key` header or `Authorization: Bearer` header. Keys are tiered (free/pro/business/enterprise). Anonymous `/ask` requires the separate local-demo-only `ACHIOTE_ALLOW_ANON_ASK=true` opt-in when auth is disabled.
- **Rate limiting** — tiered per calendar month. Free tier: 50 MCP calls, 3 web reconstructions. Rate limit headers exposed in responses.
- **`/ask` endpoint** — SSE streaming AI agent endpoint. Validates content-type, parses JSON body, enforces rate limits before calling Anthropic API. User messages are embedded in prompts inside `<user_input>` tags with a "do not follow instructions" directive.
- **Body size** — 1MB limit on request bodies.
- **CORS** — permissive (`Access-Control-Allow-Origin: *`) for development. Tighten for production.

### Production deployment

For public HTTPS access, run behind a reverse proxy:

- **nginx** or **Caddy** for TLS termination
- Set `ACHIOTE_TRUST_PROXY=true` and `ACHIOTE_TRUSTED_PROXY_IPS` so rate limiting uses `X-Forwarded-For` only from trusted proxy remote addresses. Configure the edge proxy to overwrite, not append, client-supplied `X-Forwarded-For`; if you intentionally preserve a multi-hop chain, every downstream proxy address after the original client must be listed in `ACHIOTE_TRUSTED_PROXY_IPS`
- Set `ACHIOTE_ALLOWED_ORIGINS=https://your-domain.com`
- Set `ACHIOTE_RATE_LIMIT_DB` to a persistent path so rate limits survive restarts

Example Caddyfile:

```text
your-domain.com {
  reverse_proxy localhost:3000
}
```

Example nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /etc/ssl/certs/your-domain.pem;
    ssl_certificate_key /etc/ssl/private/your-domain.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Maintainer checklist

- Keep GitHub secret scanning/push protection and code scanning enabled when available.
- Require CI before merging to the default branch.
- Run `npm audit --audit-level=moderate` before releases.
- Run `npm run pack:check` and inspect package contents before publishing.
