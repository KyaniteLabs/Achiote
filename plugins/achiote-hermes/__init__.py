"""Achiote — native Hermes plugin (food-memory reconstruction).

Surfaces:
  pre_llm_call        -> detect half-remembered dish fragments; inject research brief + cite-or-die
  pre_tool_call       -> soft-block obvious uncited nostalgia claims when cite_or_die is on
  /achiote            -> gateway-safe subcommands: ask | list | save | help (| cook stub)
  tools               -> achiote_reconstruct, achiote_save_dish, achiote_list_dishes, achiote_cite_check
  skill               -> skills/achiote/SKILL.md (achiote:achiote)
  desktop pane        -> desktop/plugin.js + dashboard/plugin_api.py (provenance + saved dishes)

Child processes get a scrubbed env; durable state lives under
<HERMES_HOME>/plugin-data/achiote/ via plugins.plugin_storage.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shlex
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

PLUGIN_NAME = "achiote"
DEFAULTS = {
    "achiote_command": "npx -y achiote@0.2.2",
    "inject_on_fragment": True,
    "cite_or_die": True,
    "timeout_seconds": 180,
    "enable_cook_slash": False,
}

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

_CITE_BLOCK_TOOLS = {
    "achiote_reconstruct",  # never block reconstruct itself
}

_ctx = None


def _cfg(key: str) -> Any:
    try:
        val = _ctx.get_config(key, None) if _ctx is not None else None
    except Exception:
        val = None
    return DEFAULTS[key] if val is None else val


def _data_dir() -> Path:
    from plugins.plugin_storage import plugin_data_dir

    return plugin_data_dir(PLUGIN_NAME)


def _dishes_path() -> Path:
    return _data_dir() / "saved_dishes.json"


def _last_path() -> Path:
    return _data_dir() / "last_reconstruction.json"


def _load_json(path: Path, default: Any) -> Any:
    try:
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.debug("achiote: failed reading %s", path, exc_info=True)
    return default


def _save_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def _scrubbed_env() -> Dict[str, str]:
    """Minimal env for the Achiote child — never hand it full os.environ."""
    allow = (
        "PATH",
        "HOME",
        "USER",
        "LANG",
        "LC_ALL",
        "TMPDIR",
        "TMP",
        "TEMP",
        "NODE_OPTIONS",
        "npm_config_cache",
        "NPM_CONFIG_CACHE",
        "XDG_CACHE_HOME",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "no_proxy",
    )
    env = {k: os.environ[k] for k in allow if os.environ.get(k)}
    # Profile-separate cache + saved state
    data = str(_data_dir())
    env["ACHIOTE_CACHE_PATH"] = str(Path(data) / "culture-cache.db")
    env["ACHIOTE_PLUGIN_DATA"] = data
    # Optional model keys via secret scope (never raw os.environ dump)
    # Secrets only via Hermes secret scope — never copy API keys from os.environ.
    try:
        from agent.secret_scope import get_secret

        for name in (
            "ANTHROPIC_API_KEY",
            "OPENAI_API_KEY",
            "OPENAI_BASE_URL",
            "OPENAI_MODEL",
            "ACHIOTE_ASK_PROVIDER",
            "SERPER_API_KEY",
        ):
            try:
                val = (get_secret(name) or "").strip()
            except Exception:
                val = ""
            if val:
                env[name] = val
    except Exception:
        pass
    return env


def run_achiote(args: List[str]) -> Dict[str, Any]:
    cmd = shlex.split(str(_cfg("achiote_command"))) + args
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=int(_cfg("timeout_seconds")),
            env=_scrubbed_env(),
        )
    except FileNotFoundError as exc:
        return {"ok": False, "error": f"achiote not runnable: {exc}"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "achiote timed out"}
    out = (proc.stdout or "").strip()
    err = (proc.stderr or "").strip()
    if proc.returncode != 0 and not out:
        return {"ok": False, "error": err[-800:] or f"exit {proc.returncode}"}
    # Prefer JSON envelope when --json was used
    start = out.find("{")
    if start >= 0:
        try:
            data = json.loads(out[start:])
            return {"ok": True, "data": data, "raw_text": out[:4000]}
        except json.JSONDecodeError:
            pass
    return {"ok": True, "data": {"answer": out}, "raw_text": out[:4000], "stderr": err[-400:]}


def looks_like_fragment(text: str) -> bool:
    return bool(text and _FRAGMENT_RE.search(text))


def _provenance_from_result(memory: str, data: Dict[str, Any]) -> Dict[str, Any]:
    receipt = data.get("receipt") if isinstance(data.get("receipt"), dict) else {}
    tools_run = data.get("toolsRun") or data.get("tools_run") or []
    nodes = [
        {"id": "memory", "kind": "memory", "label": (memory or "")[:160]},
        {"id": "research", "kind": "sources", "label": "Research / tools", "detail": tools_run},
        {"id": "cue", "kind": "cue", "label": "Minimum viable nostalgia cue"},
        {"id": "subs", "kind": "substitutions", "label": "Local ingredient swaps"},
        {"id": "recipe", "kind": "recipe", "label": "Recipe handoff (optional)"},
    ]
    edges = [
        {"from": "memory", "to": "research"},
        {"from": "research", "to": "cue"},
        {"from": "research", "to": "subs"},
        {"from": "cue", "to": "recipe"},
        {"from": "subs", "to": "recipe"},
    ]
    citations = []
    if isinstance(receipt, dict):
        for key in ("citations", "sources", "evidence", "ledger"):
            val = receipt.get(key)
            if isinstance(val, list):
                citations.extend(val[:20])
            elif isinstance(val, dict):
                citations.append(val)
    return {"nodes": nodes, "edges": edges, "citations": citations, "receipt": receipt, "status": data.get("status")}


def cite_check(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Cite-or-die: require at least one citation-like source AND a local-sub signal."""
    text = json.dumps(payload, ensure_ascii=False)
    has_cite = bool(
        re.search(r"(https?://|doi:\s*\d|isbn|citation|source|provenance|receipt)", text, re.I)
    )
    has_sub = bool(
        re.search(
            r"(substitut|swap|local(?:ly)? available|grocery|store|proxy|stand[- ]?in|where you (?:are|live))",
            text,
            re.I,
        )
    )
    ok = has_cite and has_sub
    reasons = []
    if not has_cite:
        reasons.append("missing citation/source/provenance evidence")
    if not has_sub:
        reasons.append("missing local-substitution / accessibility evidence")
    return {
        "ok": ok,
        "has_citation": has_cite,
        "has_local_sub": has_sub,
        "reasons": reasons,
        "guidance": (
            "Present the cue only after adding at least one concrete source and one local-sub note. "
            "If evidence is thin, say so and ask a gentle family follow-up — do not invent citations."
            if not ok
            else "Cite-or-die passed."
        ),
    }


def reconstruct(memory: str, user_location: str = "", as_json: bool = True) -> Dict[str, Any]:
    memory = (memory or "").strip()
    if not memory:
        return {"ok": False, "error": "memory is required"}
    args = ["ask", memory]
    if as_json:
        args.append("--json")
    if user_location:
        # CLI may ignore; keep in envelope for tools that accept location later
        pass
    res = run_achiote(args)
    if not res.get("ok"):
        return res
    data = res.get("data") if isinstance(res.get("data"), dict) else {"answer": res.get("raw_text")}
    if user_location and isinstance(data, dict):
        data = {**data, "userLocation": user_location}
    prov = _provenance_from_result(memory, data if isinstance(data, dict) else {})
    envelope = {
        "ok": True,
        "memory": memory,
        "result": data,
        "provenance": prov,
        "cite": cite_check({"result": data, "provenance": prov}),
        "saved_at": None,
    }
    _save_json(_last_path(), envelope)
    return envelope


def save_dish(title: str, memory: str = "", notes: str = "", envelope: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    dishes = _load_json(_dishes_path(), [])
    if not isinstance(dishes, list):
        dishes = []
    entry = {
        "id": str(uuid.uuid4()),
        "title": (title or "untitled dish")[:120],
        "memory": (memory or "")[:2000],
        "notes": (notes or "")[:2000],
        "envelope": envelope,
        "saved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    dishes.insert(0, entry)
    dishes = dishes[:100]
    _save_json(_dishes_path(), dishes)
    return {"ok": True, "dish": entry, "count": len(dishes)}


def list_dishes(limit: int = 20) -> Dict[str, Any]:
    dishes = _load_json(_dishes_path(), [])
    if not isinstance(dishes, list):
        dishes = []
    limit = max(1, min(int(limit or 20), 100))
    slim = [
        {"id": d.get("id"), "title": d.get("title"), "memory": (d.get("memory") or "")[:200], "saved_at": d.get("saved_at")}
        for d in dishes[:limit]
        if isinstance(d, dict)
    ]
    return {"ok": True, "dishes": slim, "count": len(dishes)}


# --- hooks ---

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
    parts: List[str] = []
    try:
        if _cfg("cite_or_die"):
            parts.append(_CITE_CONTEXT)
        if _cfg("inject_on_fragment") and looks_like_fragment(user_message or ""):
            parts.append(_FRAGMENT_CONTEXT)
    except Exception:
        logger.debug("achiote: pre_llm_call failed", exc_info=True)
        return None
    if not parts:
        return None
    return {"context": "\n\n".join(parts)}


def _on_pre_tool(tool_name: str = "", args: Optional[Dict[str, Any]] = None, **_: Any) -> Optional[Dict[str, Any]]:
    """Best-effort gate: if a non-Achiote tool is about to emit an uncited nostalgia claim in args, block."""
    if not _cfg("cite_or_die"):
        return None
    name = (tool_name or "").lower()
    if name.startswith("achiote_"):
        return None
    blob = json.dumps(args or {}, ensure_ascii=False)
    if not re.search(r"nostalgia cue|minimum viable nostalgia|heritage (?:taste|recipe)|recreate(?:d)? (?:the )?(?:dish|recipe)", blob, re.I):
        return None
    check = cite_check(args or {})
    if check["ok"]:
        return None
    return {
        "action": "block",
        "reason": "Achiote cite-or-die: " + "; ".join(check["reasons"]) + ". Use achiote_reconstruct + achiote_cite_check.",
    }


# --- slash + tools ---

_SAFE_SLASH = {"ask", "list", "save", "help", "cook", "status"}


def _slash(raw_args: str) -> str:
    raw = (raw_args or "").strip()
    if not raw or raw.split()[0].lower() in {"help", "-h", "--help"}:
        return (
            "Usage:\n"
            "  /achiote ask \"<memory fragment>\"   Reconstruct a cited nostalgia cue\n"
            "  /achiote list                       Saved family dishes\n"
            "  /achiote save <title>               Save last reconstruction\n"
            "  /achiote status                     Last reconstruction + cite check\n"
            "  /achiote cook …                     Monday stretch (disabled unless enable_cook_slash)\n"
            "Gateway-safe: no purge/serve/arbitrary CLI."
        )
    try:
        parts = shlex.split(raw)
    except ValueError:
        parts = raw.split()
    cmd = parts[0].lower()
    if cmd not in _SAFE_SLASH:
        return f"Unknown or blocked subcommand `{cmd}`. Allowed: ask, list, save, status, help, cook."
    if cmd == "ask":
        memory = " ".join(parts[1:]).strip().strip('"')
        if not memory:
            return "Usage: /achiote ask \"pass-teh-lay my mom steamed in banana leaves\""
        env = reconstruct(memory)
        if not env.get("ok"):
            return f"Achiote failed: {env.get('error')}"
        cite = env.get("cite") or {}
        answer = ""
        result = env.get("result") or {}
        if isinstance(result, dict):
            answer = (result.get("answer") or result.get("humanReadable") or "")[:2500]
        flag = "✓ cite-or-die" if cite.get("ok") else "✗ cite-or-die — " + "; ".join(cite.get("reasons") or [])
        return (answer or json.dumps(result, indent=2)[:2500]) + f"\n\n[{flag}]"
    if cmd == "list":
        return json.dumps(list_dishes(), indent=2)[:3500]
    if cmd == "save":
        title = " ".join(parts[1:]).strip() or "family dish"
        last = _load_json(_last_path(), None)
        mem = ""
        if isinstance(last, dict):
            mem = last.get("memory") or ""
        return json.dumps(save_dish(title, memory=mem, envelope=last if isinstance(last, dict) else None), indent=2)[:3500]
    if cmd == "status":
        last = _load_json(_last_path(), None)
        return json.dumps(last or {"ok": False, "error": "no reconstruction yet"}, indent=2)[:3500]
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
    "description": "Reconstruct a half-remembered family dish into a cited minimum-viable nostalgia cue via Achiote (achiote ask). Pass the memory fragment; optional user_location for local swaps.",
    "parameters": {
        "type": "object",
        "properties": {
            "memory": {"type": "string", "description": "Food-memory fragment"},
            "user_location": {"type": "string", "description": "Where the user shops now"},
        },
        "required": ["memory"],
    },
}

SAVE_SCHEMA = {
    "name": "achiote_save_dish",
    "description": "Save a family dish / reconstruction into the Hermes profile plugin-data store.",
    "parameters": {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
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
    "description": "Cite-or-die gate: verify a proposed nostalgia cue/recipe has citation/provenance evidence AND local-substitution evidence before presenting it as done.",
    "parameters": {
        "type": "object",
        "properties": {
            "payload": {
                "type": "object",
                "description": "Cue, recipe, citations, and local-sub notes to validate",
            },
            "text": {"type": "string", "description": "Alternative: free-text cue/recipe to validate"},
        },
        "required": [],
    },
}


def _tool_reconstruct(args: Dict[str, Any], **_: Any) -> str:
    return json.dumps(reconstruct(args.get("memory", ""), args.get("user_location") or ""), indent=2)[:8000]


def _tool_save(args: Dict[str, Any], **_: Any) -> str:
    last = _load_json(_last_path(), None)
    return json.dumps(
        save_dish(
            args.get("title", "family dish"),
            memory=args.get("memory") or (last.get("memory") if isinstance(last, dict) else "") or "",
            notes=args.get("notes") or "",
            envelope=last if isinstance(last, dict) else None,
        ),
        indent=2,
    )[:4000]


def _tool_list(args: Dict[str, Any], **_: Any) -> str:
    return json.dumps(list_dishes(args.get("limit") or 20), indent=2)[:4000]


def _tool_cite(args: Dict[str, Any], **_: Any) -> str:
    payload = args.get("payload")
    if not isinstance(payload, dict):
        payload = {"text": args.get("text") or ""}
    return json.dumps(cite_check(payload), indent=2)


def register(ctx) -> None:
    global _ctx
    _ctx = ctx
    ctx.register_hook("pre_llm_call", _on_pre_llm)
    ctx.register_hook("pre_tool_call", _on_pre_tool)
    ctx.register_command(
        "achiote",
        handler=_slash,
        description="Achiote food-memory reconstruct (ask/list/save/status).",
        args_hint='ask "<memory>" | list | save <title> | status | help',
    )
    ctx.register_tool(
        name="achiote_reconstruct",
        toolset="achiote",
        schema=RECONSTRUCT_SCHEMA,
        handler=_tool_reconstruct,
        description=RECONSTRUCT_SCHEMA["description"],
        emoji="🍲",
    )
    ctx.register_tool(
        name="achiote_save_dish",
        toolset="achiote",
        schema=SAVE_SCHEMA,
        handler=_tool_save,
        description=SAVE_SCHEMA["description"],
        emoji="💾",
    )
    ctx.register_tool(
        name="achiote_list_dishes",
        toolset="achiote",
        schema=LIST_SCHEMA,
        handler=_tool_list,
        description=LIST_SCHEMA["description"],
        emoji="📒",
    )
    ctx.register_tool(
        name="achiote_cite_check",
        toolset="achiote",
        schema=CITE_SCHEMA,
        handler=_tool_cite,
        description=CITE_SCHEMA["description"],
        emoji="📎",
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
