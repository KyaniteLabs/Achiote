"""Achiote — native Hermes plugin (food-memory reconstruction).

Surfaces:
  pre_llm_call        -> detect half-remembered dish fragments; inject research brief + cite-or-die
  pre_tool_call       -> block outbound/emit tools that carry an uncited nostalgia claim
                         (research/read tools are never gated — they are how citations get found)
  /achiote            -> gateway-safe subcommands: ask | list | save | status | help (| cook stub)
  tools               -> achiote_reconstruct, achiote_get_reconstruction, achiote_save_dish,
                         achiote_list_dishes, achiote_cite_check
  skill               -> skills/achiote/SKILL.md (achiote:achiote)
  desktop pane        -> desktop/plugin.js + dashboard/plugin_api.py (provenance + saved dishes)

Child processes get a scrubbed env and run from a controlled working directory (so the CLI's
``process.loadEnvFile()`` cannot pull an inherited ``.env`` back in). Durable state lives under
<HERMES_HOME>/plugin-data/achiote/ via plugins.plugin_storage:

  reconstructions/<id>.json   one full envelope per reconstruction (explicit handle)
  sessions/<sha>.json         session-local pointer to that session's last reconstruction
  latest.json                 profile-level pointer used only by the Desktop viewer
  saved_dishes.json           intentionally shared saved-dish store (locked read-modify-write)
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import logging
import os
import re
import shlex
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple

logger = logging.getLogger(__name__)

PLUGIN_NAME = "achiote"
DEFAULTS = {
    "achiote_command": "npx -y achiote@0.2.2",
    "inject_on_fragment": True,
    "cite_or_die": True,
    "timeout_seconds": 180,
    "enable_cook_slash": False,
}

# Output bounds (characters). Applied per field BEFORE serializing so tool output is always valid JSON.
MAX_ANSWER_CHARS = 3000
MAX_FIELD_CHARS = 600
MAX_LIST_ITEMS = 12
MAX_RECONSTRUCTIONS = 50
PAGE_CHARS = 6000

# Fragment heuristics — cheap, fail-open. Tuned for "pass-teh-lay" style scraps.
_FRAGMENT_RE = re.compile(
    r"(?:"
    r"\b(?:grandma|grandmother|grandpa|grandfather|abuela|abuelo|nan[ai]|oma|opa|"
    r"mom(?:'?s)?|dad(?:'?s)?|mama|papa|family|childhood|nostalgic|homesick)\b"
    r".{0,80}\b(?:made|cooked|ate|dish|recipe|soup|stew|bread|cake|sauce|mole|"
    r"tamale|pastel|risotto|curry|noodles?|rice)\b"
    r"|"
    r"\b(?:recreate|reconstruct|reverse[- ]?engineer|miss(?:ed)? (?:eating|the taste)|"
    r"food memory|nostalgia cue|sound(?:ed|s)? like)\b"
    r"|"
    r"\b(?:pass[- ]?teh[- ]?lay|pasteles?|adobo|sofrito|kimchi|pho|biryani)\b"
    r")",
    re.IGNORECASE | re.DOTALL,
)

_NOSTALGIA_CLAIM_RE = re.compile(
    r"nostalgia cue|minimum viable nostalgia|heritage (?:taste|recipe)|recreate(?:d)? (?:the )?(?:dish|recipe)",
    re.I,
)

# Research / read tools are never gated: blocking them would stop the agent from obtaining citations.
_RESEARCH_TOOL_RE = re.compile(
    r"(?:^|[_\-.])(?:search|web|fetch|read|browse|browser|get|list|lookup|query|find|extract|crawl|"
    r"scrape|open|view|grep|glob|ls|cat|navigate|snapshot|vision|recall|retrieve|session_search|skill)",
    re.I,
)
# Only tools that emit/persist content toward a person or another surface are gated.
_EMIT_TOOL_RE = re.compile(
    r"(?:send|message|reply|post|publish|notify|email|mail|tweet|slack|discord|telegram|whatsapp|"
    r"sms|share|write_file|patch|create_page|create_doc|tts|text_to_speech|announce|broadcast)",
    re.I,
)

_URL_RE = re.compile(r"https?://[^\s<>\"')\]]+", re.I)
_DOI_RE = re.compile(r"\b(10\.\d{4,9}/[^\s\"<>]+)", re.I)
_ISBN_RE = re.compile(r"\bISBN(?:-1[03])?:?\s*([0-9][0-9\- ]{8,16}[0-9Xx])\b")
_LOCAL_SUB_TEXT_RE = re.compile(
    r"(substitut\w*|swap\w*|stand[- ]?in|in place of|instead of|local(?:ly)? available|"
    r"(?:find|buy|get|look for|source)\b[^.\n]{0,60}\b(?:at|in|near)\b|grocer\w*|market|store)",
    re.I,
)
_SOURCING_FACT_RE = re.compile(
    r"^(?:Sourcing guide|Static regional availability matched|Starting points|sourcing store/corridor|"
    r"local sourcing search lead)\s*:", re.I)
_DOI_FULL_RE = re.compile(r"10\.\d{4,9}/[^\s\"<>]+", re.I)
# "X -> Y" / "X => Y" / "X → Y": an explicit substitution pair (both sides non-empty).
_SUB_PAIR_TEXT_RE = re.compile(r"\S.*?\s*(?:->|=>|→)\s*\S")
# An explicit refusal/negation is not substitution evidence ("do not buy the exact dish", "don't substitute").
_NEGATED_SUB_RE = re.compile(r"\b(?:do not|don'?t|never)\s+(?:buy|purchase|substitute|swap|replace)\b", re.I)
# Explicit absence: placeholder tokens, or a short "no sources / not provided"-style statement.
_ABSENT_TOKEN_RE = re.compile(r"^\W*(?:none|nil|null|n/?a|unknown|unk|tbd|todo|missing|empty|nothing|-+|\?+)\W*$", re.I)
_ABSENT_PHRASE_RE = re.compile(
    r"\b(?:not (?:provided|available|applicable|found|known|specified|given|sourced|cited)|"
    r"none (?:found|available|provided|given)|"
    r"no (?:\w+ ){0,2}(?:sources?|citations?|references?|evidence|substitut\w*|swaps?|alternatives?|"
    r"results?|data|records?|leads?|stores?))\b",
    re.I,
)
_ABSENT_MAX_WORDS = 8
# Explicit substitution / sourcing record shapes.
_SUB_FROM_KEYS = ("original", "ingredient", "item", "from", "replace", "instead_of", "insteadOf")
_SUB_TO_KEYS = ("substitute", "replacement", "to", "with", "swap", "alternative", "use")
_SOURCING_KEYS = ("store", "market", "shop", "where", "vendor", "retailer", "location", "corridor")

# Keys whose values are never evidence: generated labels, metadata, or what the user themselves said.
_NON_EVIDENCE_KEYS = {
    "id", "kind", "label", "status", "guidance", "reasons", "nodes", "edges", "title", "createdAt",
    "saved_at", "errored", "errorMessage", "guarded", "toolsRun", "tools_run", "userSaid", "ruledOut",
    "inferred", "unknown", "nextBestQuestions", "memory", "hypotheses", "cite", "provenance",
    "has_citation", "has_local_sub", "reconstruction_id", "session", "location_context", "userLocation",
}

_ctx = None
_state_lock = threading.RLock()


def _cfg(key: str) -> Any:
    try:
        val = _ctx.get_config(key, None) if _ctx is not None else None
    except Exception:
        val = None
    return DEFAULTS[key] if val is None else val


# --- storage ---------------------------------------------------------------------------------


def _data_dir() -> Path:
    from plugins.plugin_storage import plugin_data_dir

    return plugin_data_dir(PLUGIN_NAME)


def _dishes_path() -> Path:
    return _data_dir() / "saved_dishes.json"


def _latest_path() -> Path:
    return _data_dir() / "latest.json"


def _reconstruction_path(rid: str) -> Optional[Path]:
    if not isinstance(rid, str) or not re.fullmatch(r"[0-9a-f]{32}", rid):
        return None
    return _data_dir() / "reconstructions" / f"{rid}.json"


def _session_key(session_id: str) -> str:
    return hashlib.sha256(str(session_id).encode("utf-8")).hexdigest()[:32]


def _session_path(session_id: str) -> Path:
    return _data_dir() / "sessions" / f"{_session_key(session_id)}.json"


def _load_json(path: Optional[Path], default: Any) -> Any:
    if path is None:
        return default
    try:
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.debug("achiote: failed reading %s", path, exc_info=True)
    return default


def _save_json(path: Path, payload: Any) -> None:
    """Atomic write through a UNIQUE temp file in the same directory (no shared ``.tmp``)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_name, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp_name)
        raise


@contextlib.contextmanager
def _locked() -> Iterator[None]:
    """Process-safe (flock) + thread-safe lock around a full read-modify-write transaction."""
    with _state_lock:
        lock_path = _data_dir() / ".achiote.lock"
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        with open(lock_path, "a+") as fh:
            try:
                import fcntl  # POSIX

                fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
            except ImportError:  # pragma: no cover - Windows
                import msvcrt

                fh.seek(0)
                msvcrt.locking(fh.fileno(), msvcrt.LK_LOCK, 1)
                try:
                    yield
                finally:
                    fh.seek(0)
                    msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)


# --- child process -----------------------------------------------------------------------------


def _scrubbed_env() -> Dict[str, str]:
    """Minimal env for the Achiote child — never hand it full os.environ.

    NODE_OPTIONS is deliberately NOT inherited: it can carry ``--env-file`` / ``--require`` and
    re-open the same hole the controlled cwd closes.
    """
    allow = (
        "PATH",
        "HOME",
        "USER",
        "LANG",
        "LC_ALL",
        "TMPDIR",
        "TMP",
        "TEMP",
        "npm_config_cache",
        "NPM_CONFIG_CACHE",
        "XDG_CACHE_HOME",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "no_proxy",
        "SYSTEMROOT",
        "SystemRoot",
        "COMSPEC",
        "PATHEXT",
        "APPDATA",
        "LOCALAPPDATA",
    )
    env = {k: os.environ[k] for k in allow if os.environ.get(k)}
    data = str(_data_dir())
    env["ACHIOTE_CACHE_PATH"] = str(Path(data) / "culture-cache.db")
    env["ACHIOTE_PLUGIN_DATA"] = data
    # Secrets only via Hermes secret scope — never copy API keys from os.environ.
    #
    # Provenance is resolved from the scope itself, never inferred from the value. Two traps to
    # avoid, both found in review:
    #   * ``get_secret`` is NOT proof of provenance — with no profile scope bound and multiplexing
    #     inactive it falls through to ``os.environ``, so calling it unconditionally hands the child
    #     the exact ambient key this function promises to strip.
    #   * Dropping a value merely because it *equals* the ambient one is wrong in the other
    #     direction: a profile scope legitimately holding the same key as the shell/systemd env
    #     would lose its credential and 401. Equality is not provenance.
    try:
        from agent import secret_scope as _secret_scope
    except Exception:
        _secret_scope = None

    scope = None
    if _secret_scope is not None:
        try:
            scope = _secret_scope.current_secret_scope()
        except Exception:
            scope = None

    def _scoped_secret(name: str) -> str:
        """A secret that a real profile secret scope supplies, or "" if none does."""
        if _secret_scope is None:
            return ""
        if scope is not None:
            return (scope.get(name) or "").strip()
        # No contextvar scope. ``get_secret`` is only safe to ask when it cannot fall through to
        # os.environ — i.e. under multiplexing, where it reads the launch-body scope or raises.
        try:
            if _secret_scope.is_multiplex_active():
                return (_secret_scope.get_secret(name) or "").strip()
        except Exception:
            return ""
        return ""

    # Credentials: scope-only, never the ambient process env.
    for name in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "SERPER_API_KEY"):
        val = _scoped_secret(name)
        if val:
            env[name] = val

    # Routing config is not a credential. Prefer the scope, but fall back to the ambient env so a
    # deployment that keeps endpoints/models in the process env still routes correctly — dropping
    # these alongside the keys would send a scoped key to the provider's default endpoint.
    for name in ("OPENAI_BASE_URL", "OPENAI_MODEL", "ACHIOTE_ASK_PROVIDER"):
        val = _scoped_secret(name) or (os.environ.get(name) or "").strip()
        if val:
            env[name] = val
    return env


def _run_dir() -> Path:
    """Controlled, plugin-owned cwd for the child. Must never contain a dotenv file."""
    run = _data_dir() / "run"
    run.mkdir(parents=True, exist_ok=True)
    for name in (".env", ".npmrc"):
        stray = run / name
        if stray.exists() or stray.is_symlink():
            raise RuntimeError(f"refusing to run: unexpected {name} in controlled cwd {run}")
    return run


def _bounded_text(text: str, limit: int) -> str:
    text = text or ""
    return text if len(text) <= limit else text[: max(0, limit - 1)] + "…"


def _cli_hint(stderr: str) -> str:
    """Actionable one-liner for the npx/npm failure modes users actually hit.

    The raw npm tail is kept in diagnostics; this is what the person (and the model) reads first.
    """
    low = (stderr or "").lower()
    if any(tok in low for tok in ("enotcached", "econnrefused", "eai_again", "enotfound",
                                  "etimedout", "network", "could not resolve host", "registry")):
        return (
            "could not download achiote@0.2.2 from npm (offline or registry blocked). "
            "Run `npx -y achiote@0.2.2 ask --help` once with network access, install Node >=22, "
            "or set plugins.entries.achiote.settings.achiote_command to a local achiote binary."
        )
    return ""


def run_achiote(args: List[str]) -> Dict[str, Any]:
    cmd = shlex.split(str(_cfg("achiote_command"))) + args
    try:
        cwd = _run_dir()
    except RuntimeError as exc:
        return {"ok": False, "error": str(exc)}
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=int(_cfg("timeout_seconds")),
            env=_scrubbed_env(),
            cwd=str(cwd),
        )
    except FileNotFoundError as exc:
        binary = cmd[0] if cmd else "achiote"
        return {
            "ok": False,
            "error": (
                f"achiote CLI not found ({binary!r}). Install Node >=22 with npx, or set "
                "plugins.entries.achiote.settings.achiote_command to a local achiote binary."
            ),
            "diagnostics": {"exit_code": None, "error_message": str(exc), "stderr_tail": None, "status": None},
        }
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "error": (
                f"achiote timed out after {int(_cfg('timeout_seconds'))}s — the first npx run downloads "
                "the package; pre-install it or raise plugins.entries.achiote.settings.timeout_seconds."
            ),
            "diagnostics": {"exit_code": None, "error_message": "timeout", "stderr_tail": None, "status": None},
        }
    out = (proc.stdout or "").strip()
    err = (proc.stderr or "").strip()
    data: Optional[Dict[str, Any]] = None
    start = out.find("{")
    if start >= 0:
        try:
            parsed = json.loads(out[start:])
            data = parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            data = None
    envelope_error = isinstance(data, dict) and (data.get("errored") is True or bool(data.get("errorMessage")))
    if proc.returncode != 0 or envelope_error:
        message = ""
        if isinstance(data, dict):
            message = str(data.get("errorMessage") or "")
        diag = {
            "exit_code": proc.returncode,
            "error_message": _bounded_text(message, MAX_FIELD_CHARS) or None,
            "stderr_tail": err[-800:] or None,
            "status": data.get("status") if isinstance(data, dict) else None,
        }
        if message:
            friendly = message
        else:
            friendly = _cli_hint(err) or (err.splitlines()[0][:300] if err else f"achiote exited {proc.returncode}")
        return {"ok": False, "error": friendly, "diagnostics": diag}
    if data is not None:
        return {"ok": True, "data": data}
    return {"ok": True, "data": {"answer": out}, "stderr": err[-400:]}


def looks_like_fragment(text: str) -> bool:
    return bool(text and _FRAGMENT_RE.search(text))


# --- evidence / cite-or-die ------------------------------------------------------------------


def _clean(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", value).strip()


def _is_absent(text: str) -> bool:
    """True for explicit no-evidence values ("unknown", "No sources were found.", "not provided")."""
    t = _clean(text)
    if not t or _ABSENT_TOKEN_RE.match(t):
        return True
    if _SUB_PAIR_TEXT_RE.search(t):  # "X -> Y" is absent when either side is
        left, _, right = re.split(r"(->|=>|→)", t, maxsplit=1)
        return _is_absent(left) or _is_absent(right)
    return len(t.split()) <= _ABSENT_MAX_WORDS and bool(_ABSENT_PHRASE_RE.search(t))


def _normalize_doi(value: Any) -> Optional[str]:
    """One DOI validator for every path: bare, ``doi:`` or ``https://doi.org/`` forms; else None."""
    text = _clean(value)
    if not text:
        return None
    text = re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", "", text, flags=re.I).rstrip(".,;")
    return text if _DOI_FULL_RE.fullmatch(text) else None


def _string_list(value: Any) -> Optional[List[str]]:
    """A typed evidence collection: list of non-empty strings. Wrong type → None (never iterated)."""
    if not isinstance(value, list):
        return None
    return [t for t in (_clean(v) for v in value if isinstance(v, str)) if t]


def _is_sub_text(text: str) -> bool:
    t = _clean(text)
    if not t or _is_absent(t):
        return False
    if _SUB_PAIR_TEXT_RE.search(t):  # an explicit X -> Y beats any surrounding "don't" wording
        return True
    if _NEGATED_SUB_RE.search(t):
        return False
    return len(t.split()) >= 4 and bool(_LOCAL_SUB_TEXT_RE.search(t))


def _first_present(rec: Dict[str, Any], keys: Tuple[str, ...]) -> str:
    for k in keys:
        v = _clean(rec.get(k))
        if v and not _is_absent(v):
            return v
    return ""


def _sub_from_record(item: Any, origin: str) -> Optional[Dict[str, Any]]:
    """An ACTUAL substitution/sourcing record: an explicit pair, an item+store record, or a sentence."""
    if isinstance(item, str):
        return {"type": "substitution", "text": _clean(item), "origin": origin} if _is_sub_text(item) else None
    if not isinstance(item, dict):
        return None
    orig = _first_present(item, _SUB_FROM_KEYS)
    repl = _first_present(item, _SUB_TO_KEYS)
    if orig and repl:
        return {"type": "substitution", "original": orig, "substitute": repl,
                "text": f"{orig} -> {repl}", "origin": origin}
    where = _first_present(item, _SOURCING_KEYS)
    if orig and where:
        return {"type": "sourcing", "ingredient": orig, "where": where, "text": f"{orig} at {where}", "origin": origin}
    # Free-form record: only a real substitution/sourcing sentence among its VALUES counts.
    for _, text in _iter_value_strings(item):
        if _is_sub_text(text):
            return {"type": "substitution", "text": text, "origin": origin}
    return None


def _receipt_of(payload: Dict[str, Any]) -> Dict[str, Any]:
    for cand in (payload.get("receipt"), (payload.get("result") or {}).get("receipt") if isinstance(payload.get("result"), dict) else None):
        if isinstance(cand, dict):
            return cand
    return {}


def _iter_value_strings(obj: Any, key: str = "") -> Iterator[Tuple[str, str]]:
    """Yield (key, string VALUE) pairs — never field names, never non-evidence metadata keys."""
    if key in _NON_EVIDENCE_KEYS:
        return
    if isinstance(obj, str):
        text = _clean(obj)
        if text:
            yield key, text
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from _iter_value_strings(v, str(k))
    elif isinstance(obj, list):
        for v in obj:
            yield from _iter_value_strings(v, key)


def _source_from_record(rec: Any, origin: str) -> Optional[Dict[str, Any]]:
    if isinstance(rec, str):
        text = _clean(rec)
        if _is_absent(text):
            return None
        doi = _DOI_RE.search(text)
        url = _URL_RE.search(text)
        isbn = _ISBN_RE.search(text)
        if doi:
            return {"type": "doi", "doi": doi.group(1).rstrip(".,;"), "url": f"https://doi.org/{doi.group(1).rstrip('.,;')}", "text": text, "origin": origin}
        if url:
            return {"type": "url", "url": url.group(0).rstrip(".,;"), "text": text, "origin": origin}
        if isbn:
            return {"type": "isbn", "isbn": isbn.group(1), "text": text, "origin": origin}
        return None
    if isinstance(rec, dict):
        doi = _normalize_doi(rec.get("doi"))
        url = _clean(rec.get("url") or rec.get("href") or rec.get("link"))
        isbn = _clean(rec.get("isbn"))
        title = _clean(rec.get("title") or rec.get("citation") or rec.get("name"))
        if doi:
            return {"type": "doi", "doi": doi, "url": f"https://doi.org/{doi}", "text": title or doi, "origin": origin}
        if url and _URL_RE.match(url):
            return {"type": "url", "url": url, "text": title or url, "origin": origin}
        if isbn and re.search(r"\d{9,}", isbn.replace("-", "").replace(" ", "")):
            return {"type": "isbn", "isbn": isbn, "text": title or isbn, "origin": origin}
    return None


def extract_evidence(payload: Any) -> Dict[str, Any]:
    """Pull CONCRETE evidence values out of a producer-shaped result or a proposed cue.

    sources     — DOI / URL / ISBN records, or engine-researched facts from receipt.evidence.researched
    local_subs  — engine sourcing facts, explicit substitution records, or substitution sentences
    context     — what the user said / inferred / unknown (shown, never counted as a citation)
    """
    sources: List[Dict[str, Any]] = []
    local_subs: List[Dict[str, Any]] = []
    context: Dict[str, List[str]] = {}
    if not isinstance(payload, dict):
        payload = {"text": payload if isinstance(payload, str) else ""}

    malformed: List[str] = []
    receipt = _receipt_of(payload)
    share = receipt.get("shareCard") if isinstance(receipt.get("shareCard"), dict) else {}
    if share.get("doi") not in (None, ""):
        doi = _normalize_doi(share.get("doi"))
        if doi:
            sources.append({
                "type": "doi",
                "doi": doi,
                "url": f"https://doi.org/{doi}",
                "text": _clean(share.get("citation")) or doi,
                "fact": _clean(share.get("fact")),
                "origin": "receipt.shareCard",
            })
        else:
            malformed.append("receipt.shareCard.doi is not a valid DOI")
    evidence = receipt.get("evidence") if isinstance(receipt.get("evidence"), dict) else {}
    researched = _string_list(evidence.get("researched")) if "researched" in evidence else []
    if researched is None:
        malformed.append("receipt.evidence.researched must be a list of strings")
        researched = []
    for text in researched:
        if _is_absent(text):
            continue
        if _SOURCING_FACT_RE.match(text):
            local_subs.append({"type": "sourcing", "text": text, "origin": "receipt.evidence.researched"})
        elif re.match(r"^substitute\s*:\s*\S.*->\s*\S", text, re.I):
            local_subs.append({"type": "substitution", "text": text, "origin": "receipt.evidence.researched"})
        else:
            rec = _source_from_record(text, "receipt.evidence.researched") or {
                "type": "researched", "text": text, "origin": "receipt.evidence.researched"}
            sources.append(rec)
    for bucket in ("userSaid", "inferred", "unknown", "ruledOut"):
        vals = _string_list(evidence.get(bucket))
        if vals:
            context[bucket] = vals

    # Explicit citation / substitution records + free text, with the receipt (handled above) stripped.
    stripped: Dict[str, Any] = {k: v for k, v in payload.items() if k not in ("receipt", "provenance", "cite")}
    if isinstance(stripped.get("result"), dict):
        stripped["result"] = {k: v for k, v in stripped["result"].items() if k != "receipt"}

    def walk(obj: Any) -> None:
        if isinstance(obj, dict):
            for k, v in obj.items():
                lk = str(k).lower()
                if k in _NON_EVIDENCE_KEYS:
                    continue
                if lk in ("citations", "sources", "references", "ledger", "citedmechanisms"):
                    if not isinstance(v, list):
                        if v not in (None, "", {}):
                            malformed.append(f"payload.{k} must be a list of source records")
                        continue
                    for item in v:
                        rec = _source_from_record(item, f"payload.{k}")
                        if rec:
                            sources.append(rec)
                elif lk in ("substitutions", "substitutes", "local_subs", "localsubs", "local_swaps",
                            "localswaps", "swaps", "sourcing", "substitutelogic"):
                    if not isinstance(v, list):
                        if v not in (None, "", {}):
                            malformed.append(f"payload.{k} must be a list of substitution/sourcing records")
                        continue
                    for item in v:
                        rec = _sub_from_record(item, f"payload.{k}")
                        if rec:
                            local_subs.append(rec)
                else:
                    walk(v)
        elif isinstance(obj, list):
            for v in obj:
                walk(v)

    walk(stripped)

    # Free-text values (answer, proposed text): concrete URL/DOI and substitution sentences only.
    seen_text = set()
    for key, text in _iter_value_strings(stripped):
        if text in seen_text:
            continue
        seen_text.add(text)
        for m in _DOI_RE.finditer(text):
            d = m.group(1).rstrip(".,;")
            sources.append({"type": "doi", "doi": d, "url": f"https://doi.org/{d}", "text": d, "origin": f"text.{key or 'value'}"})
        for m in _URL_RE.finditer(text):
            u = m.group(0).rstrip(".,;")
            if "doi.org/" not in u:
                sources.append({"type": "url", "url": u, "text": u, "origin": f"text.{key or 'value'}"})
        for sentence in re.split(r"(?<=[.!?])\s+|\n+", text):
            s = sentence.strip()
            if _is_sub_text(s):
                local_subs.append({"type": "text", "text": s, "origin": f"text.{key or 'value'}"})

    def dedupe(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        out, seen = [], set()
        for it in items:
            sig = (it.get("type"), it.get("doi") or it.get("url") or it.get("isbn") or it.get("text"))
            if sig in seen:
                continue
            seen.add(sig)
            out.append(it)
        return out

    return {"sources": dedupe(sources), "local_subs": dedupe(local_subs), "context": context,
            "malformed": malformed}


def cite_check(payload: Any) -> Dict[str, Any]:
    """Cite-or-die: require >=1 concrete source value AND >=1 concrete local-substitution value.

    Field names, generated labels and the provenance skeleton never count; empty/missing evidence fails.
    """
    ev = extract_evidence(payload)
    has_cite = bool(ev["sources"])
    has_sub = bool(ev["local_subs"])
    reasons = []
    if not has_cite:
        reasons.append("missing citation/source/provenance evidence")
    if not has_sub:
        reasons.append("missing local-substitution / accessibility evidence")
    reasons.extend(f"malformed evidence: {m}" for m in ev["malformed"])
    ok = has_cite and has_sub
    return {
        "ok": ok,
        "has_citation": has_cite,
        "has_local_sub": has_sub,
        "source_count": len(ev["sources"]),
        "local_sub_count": len(ev["local_subs"]),
        "reasons": reasons,
        "guidance": (
            "Present the cue only after adding at least one concrete source and one local-sub note. "
            "If evidence is thin, say so and ask a gentle family follow-up — do not invent citations."
            if not ok
            else "Cite-or-die passed."
        ),
    }


def _provenance_from_result(memory: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """Source-to-claim provenance graph built from the real evidence (not a fixed outline)."""
    receipt = _receipt_of({"result": data})
    ev = extract_evidence({"result": data})
    sources = ev["sources"][:20]
    subs = ev["local_subs"][:20]
    test = receipt.get("firstTinyTasteTest") if isinstance(receipt.get("firstTinyTasteTest"), dict) else {}
    claim_label = _clean(test.get("title")) or _clean(test.get("cue")) or "Minimum viable nostalgia cue"
    nodes: List[Dict[str, Any]] = [{"id": "memory", "kind": "memory", "label": _bounded_text(memory or "", 160)}]
    edges: List[Dict[str, Any]] = []
    nodes.append({"id": "cue", "kind": "claim", "label": claim_label, "status": data.get("status")})
    for i, s in enumerate(sources):
        nid = f"src{i}"
        nodes.append({"id": nid, "kind": "source", "label": _bounded_text(s.get("text") or "", 160),
                      "type": s.get("type"), "url": s.get("url"), "doi": s.get("doi")})
        edges.append({"from": "memory", "to": nid, "rel": "researched_from"})
        edges.append({"from": nid, "to": "cue", "rel": "supports"})
    for i, s in enumerate(subs):
        nid = f"sub{i}"
        nodes.append({"id": nid, "kind": "local_sub", "label": _bounded_text(s.get("text") or "", 160)})
        edges.append({"from": nid, "to": "cue", "rel": "local_swap_for"})
    if not sources:
        edges.append({"from": "memory", "to": "cue", "rel": "unsupported"})
    return {
        "nodes": nodes,
        "edges": edges,
        "sources": sources,
        "local_subs": subs,
        "context": ev["context"],
        "status": data.get("status"),
    }


# --- bounding (valid JSON, always) ----------------------------------------------------------


def _bound(obj: Any, max_str: int = MAX_FIELD_CHARS, max_items: int = MAX_LIST_ITEMS, depth: int = 0) -> Any:
    """Bound every string/list/dict BEFORE serializing so the tool result is always parseable JSON."""
    if depth > 6:
        return "…"
    if isinstance(obj, str):
        return _bounded_text(obj, max_str)
    if isinstance(obj, list):
        out = [_bound(v, max_str, max_items, depth + 1) for v in obj[:max_items]]
        if len(obj) > max_items:
            out.append(f"… {len(obj) - max_items} more")
        return out
    if isinstance(obj, dict):
        items = list(obj.items())
        out = {str(k): _bound(v, max_str, max_items, depth + 1) for k, v in items[:40]}
        if len(items) > 40:
            out["_truncated_keys"] = len(items) - 40
        return out
    return obj


def summarize_envelope(env: Dict[str, Any]) -> Dict[str, Any]:
    """Stable, bounded summary + explicit handle. Citation verdict and evidence always survive."""
    if not env.get("ok"):
        return _bound({k: env.get(k) for k in ("ok", "error", "diagnostics") if k in env})
    result = env.get("result") if isinstance(env.get("result"), dict) else {}
    receipt = _receipt_of({"result": result})
    answer = str(result.get("answer") or result.get("humanReadable") or "")
    prov = env.get("provenance") or {}
    rid = env.get("reconstruction_id")
    return {
        "ok": True,
        "reconstruction_id": rid,
        "status": result.get("status"),
        "cite": env.get("cite"),
        "answer": _bounded_text(answer, MAX_ANSWER_CHARS),
        "answer_chars": len(answer),
        "answer_truncated": len(answer) > MAX_ANSWER_CHARS,
        "sources": _bound(prov.get("sources") or [], 300, 10),
        "local_subs": _bound(prov.get("local_subs") or [], 300, 10),
        "first_tiny_taste_test": _bound(receipt.get("firstTinyTasteTest"), 300),
        "next_best_questions": _bound(receipt.get("nextBestQuestions") or [], 300, 5),
        "location_context": env.get("location_context"),
        "full_result": {
            "handle": rid,
            "how": "Call achiote_get_reconstruction with this reconstruction_id (section=answer|receipt|sources, offset for paging).",
        },
    }


# --- reconstruct / session state ------------------------------------------------------------


def _clean_location(user_location: str) -> str:
    loc = re.sub(r"[\x00-\x1f\x7f]", " ", str(user_location or ""))
    # The engine's location parser stops at . ! ? ; , — keep the whole place name as one phrase.
    loc = re.sub(r"[.!?;,]+", " ", loc)
    loc = re.sub(r"\s+", " ", loc).strip().strip("\"'")
    return loc[:80]


def _engine_input(memory: str, location: str) -> str:
    if not location:
        return memory
    # `achiote ask` has no --location flag; the engine reads the shopping location from the message
    # (inferUserLocationFromMessage: "I live in <place>"). Passed as argv data, never through a shell.
    return f"{memory}\n\nI live in {location}."


def _owner_matches(record: Dict[str, Any], session_id: str) -> bool:
    owner = record.get("session")
    if not owner or not session_id:
        return True
    return owner == _session_key(session_id)


def load_reconstruction(rid: str, session_id: str = "") -> Optional[Dict[str, Any]]:
    rec = _load_json(_reconstruction_path(rid), None)
    if not isinstance(rec, dict) or not _owner_matches(rec, session_id):
        return None
    return rec


def session_last(session_id: str) -> Optional[Dict[str, Any]]:
    if not session_id:
        return None
    ptr = _load_json(_session_path(session_id), None)
    if not isinstance(ptr, dict):
        return None
    return load_reconstruction(str(ptr.get("reconstruction_id") or ""), session_id)


def _saved_reconstruction_ids() -> set:
    """Reconstruction IDs referenced by a saved dish. Call under _locked()."""
    dishes = _load_json(_dishes_path(), [])
    if not isinstance(dishes, list):
        return set()
    out = set()
    for d in dishes:
        snap = d.get("reconstruction") if isinstance(d, dict) else None
        rid = snap.get("reconstruction_id") if isinstance(snap, dict) else None
        if isinstance(rid, str) and _reconstruction_path(rid) is not None:
            out.add(rid)
    return out


def _prune_reconstructions() -> None:
    """Rolling cache of the latest MAX_RECONSTRUCTIONS UNSAVED results. A result referenced by a saved
    dish is pinned (its full answer/receipt is the dish's only complete record). Call under _locked()."""
    folder = _data_dir() / "reconstructions"
    pinned = _saved_reconstruction_ids()
    try:
        files = sorted((p for p in folder.glob("*.json") if p.stem not in pinned),
                       key=lambda p: p.stat().st_mtime, reverse=True)
    except OSError:
        return
    for stale in files[MAX_RECONSTRUCTIONS:]:
        with contextlib.suppress(OSError):
            stale.unlink()


def reconstruct(memory: str, user_location: str = "", as_json: bool = True, session_id: str = "") -> Dict[str, Any]:
    memory = (memory or "").strip()
    if not memory:
        return {"ok": False, "error": "memory is required"}
    location = _clean_location(user_location)
    engine_input = _engine_input(memory, location)
    # `--` stops option parsing so a memory that starts with "-" is always data.
    args = ["ask"] + (["--json"] if as_json else []) + ["--", engine_input]
    res = run_achiote(args)
    if not res.get("ok"):
        # Failure never replaces the last successful reconstruction.
        return res
    data = res.get("data") if isinstance(res.get("data"), dict) else {"answer": ""}
    prov = _provenance_from_result(memory, data)
    rid = uuid.uuid4().hex
    envelope = {
        "ok": True,
        "reconstruction_id": rid,
        "session": _session_key(session_id) if session_id else None,
        "memory": memory,
        "location_context": {"supplied": location or None, "sent_to_engine": bool(location)},
        "result": data,
        "provenance": prov,
        "cite": cite_check({"result": data}),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with _locked():
        _save_json(_reconstruction_path(rid), envelope)
        if session_id:
            _save_json(_session_path(session_id), {"reconstruction_id": rid})
        _save_json(_latest_path(), {"reconstruction_id": rid})
        _prune_reconstructions()
    return envelope


def _dish_snapshot(env: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not isinstance(env, dict):
        return None
    return {
        "reconstruction_id": env.get("reconstruction_id"),
        "cite_ok": bool((env.get("cite") or {}).get("ok")),
        "status": (env.get("result") or {}).get("status") if isinstance(env.get("result"), dict) else None,
        "sources": _bound((env.get("provenance") or {}).get("sources") or [], 400, 10),
        "local_subs": _bound((env.get("provenance") or {}).get("local_subs") or [], 400, 10),
    }


def save_dish(title: str, memory: str = "", notes: str = "", envelope: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    entry = {
        "id": str(uuid.uuid4()),
        "title": (title or "untitled dish")[:120],
        "memory": (memory or "")[:2000],
        "notes": (notes or "")[:2000],
        "reconstruction": _dish_snapshot(envelope),
        "saved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with _locked():  # full read-modify-write under one process-safe lock — no lost updates
        rid = (entry["reconstruction"] or {}).get("reconstruction_id")
        path = _reconstruction_path(rid) if isinstance(rid, str) else None
        if path is not None and not path.is_file():
            # Pruned by another process between load and save: restore the complete result we hold,
            # so the saved dish never points at a missing answer/receipt.
            _save_json(path, envelope)
        dishes = _load_json(_dishes_path(), [])
        if not isinstance(dishes, list):
            dishes = []
        dishes.insert(0, entry)
        dishes = dishes[:100]
        _save_json(_dishes_path(), dishes)
    return {"ok": True, "dish": entry, "count": len(dishes)}


def save_for_session(title: str, memory: str = "", notes: str = "", reconstruction_id: str = "",
                     session_id: str = "") -> Dict[str, Any]:
    """Resolve WHICH reconstruction to save: explicit ID > this session's last > none (memory-only)."""
    env: Optional[Dict[str, Any]] = None
    if reconstruction_id:
        env = load_reconstruction(reconstruction_id, session_id)
        if env is None:
            return {"ok": False, "error": f"unknown reconstruction_id {reconstruction_id!r} for this session"}
    elif session_id:
        env = session_last(session_id)
    if env is None and not (memory or "").strip():
        return {
            "ok": False,
            "error": "no reconstruction for this session — pass reconstruction_id (from achiote_reconstruct) or memory",
        }
    mem = (memory or "").strip() or (env.get("memory") if env else "") or ""
    return save_dish(title, memory=mem, notes=notes, envelope=env)


def list_dishes(limit: int = 20) -> Dict[str, Any]:
    dishes = _load_json(_dishes_path(), [])
    if not isinstance(dishes, list):
        dishes = []
    limit = max(1, min(int(limit or 20), 100))
    slim = [
        {
            "id": d.get("id"),
            "title": _bounded_text(str(d.get("title") or ""), 120),
            "memory": _bounded_text(str(d.get("memory") or ""), 200),
            "reconstruction_id": (d.get("reconstruction") or {}).get("reconstruction_id") if isinstance(d.get("reconstruction"), dict) else None,
            "cite_ok": (d.get("reconstruction") or {}).get("cite_ok") if isinstance(d.get("reconstruction"), dict) else None,
            "saved_at": d.get("saved_at"),
        }
        for d in dishes[:limit]
        if isinstance(d, dict)
    ]
    return {"ok": True, "dishes": slim, "count": len(dishes)}


def get_reconstruction_view(rid: str, section: str = "summary", offset: int = 0, session_id: str = "") -> Dict[str, Any]:
    env = load_reconstruction(rid, session_id) if rid else session_last(session_id)
    if env is None:
        return {"ok": False, "error": "reconstruction not found for this session; pass reconstruction_id"}
    section = (section or "summary").lower()
    if section == "summary":
        return summarize_envelope(env)
    result = env.get("result") if isinstance(env.get("result"), dict) else {}
    if section == "answer":
        text = str(result.get("answer") or result.get("humanReadable") or "")
    elif section == "receipt":
        text = json.dumps(_receipt_of({"result": result}), ensure_ascii=False, indent=2)
    elif section == "sources":
        prov = env.get("provenance") or {}
        text = json.dumps({"sources": prov.get("sources") or [], "local_subs": prov.get("local_subs") or [],
                           "context": prov.get("context") or {}}, ensure_ascii=False, indent=2)
    else:
        return {"ok": False, "error": "section must be summary|answer|receipt|sources"}
    offset = max(0, int(offset or 0))
    chunk = text[offset: offset + PAGE_CHARS]
    nxt = offset + len(chunk)
    return {
        "ok": True,
        "reconstruction_id": env.get("reconstruction_id"),
        "section": section,
        "offset": offset,
        "total_chars": len(text),
        "chunk": chunk,
        "next_offset": nxt if nxt < len(text) else None,
        "cite": env.get("cite"),
    }


# --- hooks ------------------------------------------------------------------------------------

_CITE_CONTEXT = (
    "[Achiote cite-or-die] For any nostalgia cue or heritage-taste claim: "
    "(1) cite at least one concrete source or provenance record, "
    "(2) name a local/accessible substitute or sourcing note for where the user is, "
    "(3) if evidence is thin, say so and ask a gentle family follow-up — never invent citations. "
    "Prefer tool achiote_reconstruct then achiote_cite_check before presenting a final cue. "
    "Heritage-locale translation belongs in DialectOS, not Achiote."
)

_FRAGMENT_CONTEXT = (
    "[Achiote research brief] The user message looks like a half-remembered family dish. "
    "Run achiote_reconstruct (or /achiote ask) to build a minimum viable nostalgia cue with "
    "provenance before a full recipe. Lead with the cue + citations + local swaps; "
    "only offer a fuller recipe after the user wants more. Demo path: fragment → provenance → cited cue."
)


def _on_pre_llm(
    session_id: str = "",
    user_message: str = "",
    conversation_history: Optional[list] = None,
    is_first_turn: bool = False,
    model: str = "",
    platform: str = "",
    **_: Any,
) -> Optional[Dict[str, str]]:
    """Inject the brief/guardrail only on food-memory turns.

    A per-turn hook that appended food-policy text to EVERY message polluted unrelated turns
    (and contradicted the README's "detects food-memory fragments and injects…"). The guardrail
    rides along when the message is a fragment or already talks about a nostalgia cue; other
    turns get ``None``. Enforcement itself stays on ``pre_tool_call``, which always gates
    outbound/emit tools regardless of what the user typed.
    """
    parts: List[str] = []
    try:
        msg = user_message or ""
        fragment = looks_like_fragment(msg)
        claim = bool(_NOSTALGIA_CLAIM_RE.search(msg))
        if _cfg("cite_or_die") and (fragment or claim):
            parts.append(_CITE_CONTEXT)
        if _cfg("inject_on_fragment") and fragment:
            parts.append(_FRAGMENT_CONTEXT)
    except Exception:
        logger.debug("achiote: pre_llm_call failed", exc_info=True)
        return None
    if not parts:
        return None
    return {"context": "\n\n".join(parts)}


def is_gated_tool(tool_name: str) -> bool:
    """Only outbound/emit tools are gated. Research/read tools (and Achiote's own) never are."""
    name = (tool_name or "").strip()
    if not name or name.lower().startswith("achiote_"):
        return False
    if _RESEARCH_TOOL_RE.search(name):
        return False
    return bool(_EMIT_TOOL_RE.search(name))


def _on_pre_tool(tool_name: str = "", args: Optional[Dict[str, Any]] = None, **_: Any) -> Optional[Dict[str, Any]]:
    """Veto an outbound tool call that carries an uncited nostalgia claim.

    Hermes' directive parser ignores a block without a non-empty ``message`` (the message becomes
    the tool result), so the directive always carries one.
    """
    try:
        if not _cfg("cite_or_die") or not is_gated_tool(tool_name):
            return None
        payload = args if isinstance(args, dict) else {}
        blob = " ".join(t for _, t in _iter_value_strings(payload))
        if not _NOSTALGIA_CLAIM_RE.search(blob):
            return None
        check = cite_check(payload)
        if check["ok"]:
            return None
        message = (
            "Achiote cite-or-die blocked this call: "
            + "; ".join(check["reasons"])
            + ". Run achiote_reconstruct (research tools stay available), then achiote_cite_check, "
            "and include at least one concrete source (DOI/URL) and one local-substitution note."
        )
        return {"action": "block", "message": message, "reason": message}
    except Exception:
        logger.debug("achiote: pre_tool_call failed", exc_info=True)
        return None


# --- slash + tools ----------------------------------------------------------------------------

_SAFE_SLASH = {"ask", "list", "save", "help", "cook", "status"}


def _pop_flag(parts: List[str], flag: str) -> Tuple[List[str], str]:
    out, val, i = [], "", 0
    while i < len(parts):
        if parts[i] == flag and i + 1 < len(parts):
            val = parts[i + 1]
            i += 2
            continue
        out.append(parts[i])
        i += 1
    return out, val


def _slash(raw_args: str) -> str:
    raw = (raw_args or "").strip()
    if not raw or raw.split()[0].lower() in {"help", "-h", "--help"}:
        return (
            "Usage:\n"
            "  /achiote ask \"<memory fragment>\" [--location \"<city>\"]   Reconstruct a cited nostalgia cue\n"
            "  /achiote list                                       Saved family dishes\n"
            "  /achiote save <title> --id <reconstruction_id>      Save that reconstruction\n"
            "  /achiote status <reconstruction_id>                 Reconstruction summary + cite check\n"
            "  /achiote cook …                                     Monday stretch (disabled unless enable_cook_slash)\n"
            "Gateway-safe: no purge/serve/arbitrary CLI. Slash commands carry no session, so save/status take an explicit ID."
        )
    try:
        parts = shlex.split(raw)
    except ValueError:
        parts = raw.split()
    cmd = parts[0].lower()
    if cmd not in _SAFE_SLASH:
        return f"Unknown or blocked subcommand `{cmd}`. Allowed: ask, list, save, status, help, cook."
    if cmd == "ask":
        rest, location = _pop_flag(parts[1:], "--location")
        memory = " ".join(rest).strip().strip('"')
        if not memory:
            return "Usage: /achiote ask \"pass-teh-lay my mom steamed in banana leaves\""
        env = reconstruct(memory, user_location=location)
        if not env.get("ok"):
            return f"Achiote failed: {env.get('error')}"
        cite = env.get("cite") or {}
        result = env.get("result") or {}
        answer = str(result.get("answer") or result.get("humanReadable") or "") if isinstance(result, dict) else ""
        flag = "✓ cite-or-die" if cite.get("ok") else "✗ cite-or-die — " + "; ".join(cite.get("reasons") or [])
        srcs = (env.get("provenance") or {}).get("sources") or []
        src_lines = "\n".join(
            f"  - {s.get('url') or s.get('text')}" for s in srcs[:5]
        )
        return (
            _bounded_text(answer, 2500)
            + (f"\n\nSources:\n{src_lines}" if src_lines else "")
            + f"\n\n[{flag}]\nreconstruction_id: {env.get('reconstruction_id')}"
            + f"\nSave it: /achiote save <title> --id {env.get('reconstruction_id')}"
        )
    if cmd == "list":
        return json.dumps(list_dishes(), indent=2, ensure_ascii=False)
    if cmd == "save":
        rest, rid = _pop_flag(parts[1:], "--id")
        title = " ".join(rest).strip() or "family dish"
        if not rid:
            return "Usage: /achiote save <title> --id <reconstruction_id> (the ID is printed by /achiote ask)."
        return json.dumps(_bound(save_for_session(title, reconstruction_id=rid)), indent=2, ensure_ascii=False)
    if cmd == "status":
        rid = parts[1] if len(parts) > 1 else ""
        if not rid:
            return "Usage: /achiote status <reconstruction_id>"
        return json.dumps(get_reconstruction_view(rid), indent=2, ensure_ascii=False)
    if cmd == "cook":
        if not _cfg("enable_cook_slash"):
            return (
                "/achiote cook is a Monday stretch and is disabled "
                "(set plugins.entries.achiote.settings.enable_cook_slash: true after go/no-go)."
            )
        return "Cooking-session walkthrough is not implemented in this build yet."
    return "Usage: /achiote help"


RECONSTRUCT_SCHEMA = {
    "name": "achiote_reconstruct",
    "description": "Reconstruct a half-remembered family dish into a cited minimum-viable nostalgia cue via Achiote (achiote ask). Pass the memory fragment; optional user_location is sent to the engine for local swaps/sourcing. Returns a bounded summary plus reconstruction_id (full-result handle).",
    "parameters": {
        "type": "object",
        "properties": {
            "memory": {"type": "string", "description": "Food-memory fragment"},
            "user_location": {"type": "string", "description": "Where the user shops now (city/region)"},
        },
        "required": ["memory"],
    },
}

GET_SCHEMA = {
    "name": "achiote_get_reconstruction",
    "description": "Read a stored Achiote reconstruction by reconstruction_id (defaults to this session's last). section=summary|answer|receipt|sources; page long sections with offset.",
    "parameters": {
        "type": "object",
        "properties": {
            "reconstruction_id": {"type": "string"},
            "section": {"type": "string", "enum": ["summary", "answer", "receipt", "sources"]},
            "offset": {"type": "integer"},
        },
        "required": [],
    },
}

SAVE_SCHEMA = {
    "name": "achiote_save_dish",
    "description": "Save a family dish into the Hermes profile plugin-data store. Attaches reconstruction_id if given, else THIS session's last reconstruction (never another session's).",
    "parameters": {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "reconstruction_id": {"type": "string", "description": "ID returned by achiote_reconstruct"},
            "memory": {"type": "string"},
            "notes": {"type": "string"},
        },
        "required": ["title"],
    },
}

LIST_SCHEMA = {
    "name": "achiote_list_dishes",
    "description": "List saved family dishes from Achiote plugin-data.",
    "parameters": {
        "type": "object",
        "properties": {"limit": {"type": "integer"}},
        "required": [],
    },
}

CITE_SCHEMA = {
    "name": "achiote_cite_check",
    "description": "Cite-or-die gate: verify a proposed nostalgia cue/recipe has concrete source evidence (DOI/URL/ISBN or engine-researched fact) AND concrete local-substitution evidence before presenting it as done.",
    "parameters": {
        "type": "object",
        "properties": {
            "payload": {
                "type": "object",
                "description": "Cue, recipe, citations/sources, and substitutions to validate",
            },
            "text": {"type": "string", "description": "Alternative: free-text cue/recipe to validate"},
            "reconstruction_id": {"type": "string", "description": "Alternative: re-check a stored reconstruction"},
        },
        "required": [],
    },
}


def _dumps(obj: Any) -> str:
    return json.dumps(obj, indent=2, ensure_ascii=False)


def _tool_reconstruct(args: Dict[str, Any], session_id: str = "", **_: Any) -> str:
    env = reconstruct(args.get("memory", ""), args.get("user_location") or "", session_id=session_id or "")
    return _dumps(summarize_envelope(env))


def _tool_get(args: Dict[str, Any], session_id: str = "", **_: Any) -> str:
    return _dumps(get_reconstruction_view(
        str(args.get("reconstruction_id") or ""), str(args.get("section") or "summary"),
        int(args.get("offset") or 0), session_id=session_id or ""))


def _tool_save(args: Dict[str, Any], session_id: str = "", **_: Any) -> str:
    res = save_for_session(
        str(args.get("title") or "family dish"),
        memory=str(args.get("memory") or ""),
        notes=str(args.get("notes") or ""),
        reconstruction_id=str(args.get("reconstruction_id") or ""),
        session_id=session_id or "",
    )
    if res.get("ok"):
        d = res["dish"]
        res = {"ok": True, "count": res.get("count"), "dish": {
            "id": d["id"], "title": d["title"], "memory": _bounded_text(d["memory"], 200),
            "notes": _bounded_text(d["notes"], 300), "saved_at": d["saved_at"],
            "reconstruction": _bound(d.get("reconstruction"), 200, 5)}}
    return _dumps(_bound(res))


def _tool_list(args: Dict[str, Any], **_: Any) -> str:
    return _dumps(list_dishes(args.get("limit") or 20))


def _tool_cite(args: Dict[str, Any], session_id: str = "", **_: Any) -> str:
    rid = str(args.get("reconstruction_id") or "")
    if rid:
        env = load_reconstruction(rid, session_id or "")
        if env is None:
            return _dumps({"ok": False, "error": "reconstruction not found for this session"})
        return _dumps(cite_check({"result": env.get("result") or {}}))
    payload = args.get("payload")
    if not isinstance(payload, dict):
        payload = {"text": args.get("text") or ""}
    return _dumps(cite_check(payload))


def register(ctx) -> None:
    global _ctx
    _ctx = ctx
    ctx.register_hook("pre_llm_call", _on_pre_llm)
    ctx.register_hook("pre_tool_call", _on_pre_tool)
    ctx.register_command(
        "achiote",
        handler=_slash,
        description="Achiote food-memory reconstruct (ask/list/save/status).",
        args_hint='ask "<memory>" [--location <city>] | list | save <title> --id <id> | status <id> | help',
    )
    for schema, handler, emoji in (
        (RECONSTRUCT_SCHEMA, _tool_reconstruct, "🍲"),
        (GET_SCHEMA, _tool_get, "🧾"),
        (SAVE_SCHEMA, _tool_save, "💾"),
        (LIST_SCHEMA, _tool_list, "📒"),
        (CITE_SCHEMA, _tool_cite, "📎"),
    ):
        ctx.register_tool(
            name=schema["name"],
            toolset="achiote",
            schema=schema,
            handler=handler,
            description=schema["description"],
            emoji=emoji,
        )
    skills_dir = Path(__file__).parent / "skills"
    if skills_dir.is_dir():
        for child in sorted(skills_dir.iterdir()):
            skill_md = child / "SKILL.md"
            if child.is_dir() and skill_md.exists():
                try:
                    ctx.register_skill(child.name, skill_md)
                except Exception:
                    logger.debug("achiote: register_skill failed for %s", child.name, exc_info=True)
