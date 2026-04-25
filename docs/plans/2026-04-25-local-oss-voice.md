# Local OSS Voice Implementation Plan

**Goal:** Add opt-in speech-to-text and text-to-speech to the Achiote web app using only local, free/open-source engines.

**Architecture:** Keep Achiote's MCP and food-memory reasoning unchanged. Add HTTP voice endpoints that are disabled by default and shell out to explicitly configured local binaries/models, then add app controls that discover voice readiness from the server before showing push-to-talk or playback. This avoids hosted speech APIs, avoids new npm dependencies, and keeps user audio inside the local/self-hosted runtime.

**Tech Stack:** Node HTTP server, TypeScript, Vitest, browser MediaRecorder, local `ffmpeg`, local `whisper.cpp` CLI, and a configurable Kokoro command adapter.

---

### Task 1: Voice Runtime Contract

**Files:**
- Create: `src/lib/local-speech.ts`
- Test: `tests/local-speech.test.ts`
- Modify: `.env.example`

**Steps:**
1. Write failing tests for disabled-by-default speech config, `whisper.cpp` readiness requirements, media type validation, and command placeholder validation.
2. Run `npx vitest run tests/local-speech.test.ts` and confirm the missing module failure.
3. Implement a small local speech runtime with no shell interpolation: build argv arrays with placeholders, validate audio media types, cap text/audio sizes, and return structured readiness.
4. Run the focused test and commit the runtime contract.

### Task 2: HTTP Voice Endpoints

**Files:**
- Modify: `src/http-server.ts`
- Test: `tests/http-server.test.ts`

**Steps:**
1. Add failing tests for `GET /voice/status`, disabled `POST /voice/transcribe`, disabled `POST /voice/synthesize`, auth behavior, and payload validation.
2. Run the focused HTTP test and confirm endpoint failures.
3. Wire `/voice/status`, `/voice/transcribe`, and `/voice/synthesize` through the local speech runtime. Keep auth/rate-limit expectations aligned with `/ask` and return clear 503s when local binaries/models are missing.
4. Run focused tests and commit endpoint wiring.

### Task 3: Web App Controls

**Files:**
- Modify: `docs/landing/app.html`
- Modify: `docs/landing/app.js`
- Modify: `docs/landing/index.html`
- Test: `tests/p2-product-trust.test.ts` or `tests/agent-guardrails.test.ts`

**Steps:**
1. Add failing tests that the product surface describes local/offline OSS voice and does not claim hosted speech.
2. Add push-to-talk and read-aloud controls that are hidden/disabled unless `/voice/status` reports readiness.
3. Use `MediaRecorder` for mic capture, send base64 audio to `/voice/transcribe`, place transcripts in the existing input, and use `/voice/synthesize` audio responses for read-aloud.
4. Run focused tests and commit UI/docs.

### Task 4: Verification And PR

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`

**Steps:**
1. Document local setup for `whisper.cpp + Kokoro-82M`, including license notes, env vars, and disabled-by-default behavior.
2. Run required verification: `npm run check`, `npm run package:smoke`, `npm audit --audit-level=moderate`, `git diff --check`, and `npm pack --dry-run`.
3. Make final documentation commit if needed.
4. Push `codex/local-oss-voice` and open a draft PR.
