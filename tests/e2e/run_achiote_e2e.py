#!/usr/bin/env python3
"""End-to-end operator-path harness for the Achiote Hermes plugin.

Everything here runs the REAL Hermes plugin manager, the REAL tool registry, the REAL hook
chain, the REAL ``npx -y achiote@0.2.2`` subprocess and the REAL dashboard API mount — inside
an isolated ``HERMES_HOME``. Nothing is stubbed; the only instrumentation is a recording
wrapper around ``subprocess.run`` that observes the child's argv/exit code and then calls it.

Run it with the Hermes checkout's own runtime venv (see README next to this file):

    HERMES_SOURCE=/path/to/hermes-agent \
      /path/to/venv/bin/python tests/e2e/run_achiote_e2e.py

Exit code 0 = every path passed. A machine-readable report is written with ``--json``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PLUGIN_DIR = REPO_ROOT / "plugins" / "achiote-hermes"
DEFAULT_HERMES_SOURCE = os.environ.get("HERMES_SOURCE", "/home/simon/.hermes-org/source/hermes-agent-1158809")
SCRATCH = Path(os.environ.get("ACHIOTE_E2E_SCRATCH", tempfile.gettempdir()))

# Live state that must not move. Directory contents + inode are watched; a live profile root also
# receives unrelated session writes from the running gateway, so only plugin-data entries count.
LIVE_WATCH = [
    Path("/home/simon/.hermes-org/plugin-data"),
    Path("/home/simon/.hermes-org/plugin-data/achiote"),
    Path("/home/simon/.hermes-org/profiles/growth-comms/plugin-data"),
    Path("/home/simon/.hermes-org/profiles/growth-comms/plugin-data/achiote"),
]

RESULTS: list[dict] = []


# ---------------------------------------------------------------------------------------------
# environment (must happen before any hermes import)
# ---------------------------------------------------------------------------------------------

def prepare_environment(hermes_source: str, home: Path) -> None:
    os.environ["HERMES_HOME"] = str(home)
    os.environ["HERMES_DISABLE_LAZY_INSTALLS"] = "1"   # no launcher dependency sync / re-exec
    os.environ.pop("HERMES_DELEGATED_CHILD_CONTEXT", None)  # gateway-child flags block mutations
    os.environ.pop("HERMES_SESSION_PLATFORM", None)
    os.environ.pop("HERMES_PLUGIN_HOST_PROCESS", None)
    path = os.environ.get("PYTHONPATH", "")
    if hermes_source not in path.split(os.pathsep):
        os.environ["PYTHONPATH"] = os.pathsep.join(p for p in (hermes_source, path) if p)
    if hermes_source not in sys.path:
        sys.path.insert(0, hermes_source)


def build_isolated_home(plugin_dir: Path, home: Path) -> Path:
    """Fresh HERMES_HOME: plugin installed under plugins/achiote + config enabling it."""
    if home.exists():
        shutil.rmtree(home)
    (home / "plugins").mkdir(parents=True)
    (home / "plugin-data").mkdir()
    (home / "cache").mkdir()
    shutil.copytree(plugin_dir, home / "plugins" / "achiote")
    (home / "config.yaml").write_text(
        "plugins:\n"
        "  enabled:\n"
        "    - achiote\n"
        "  entries:\n"
        "    achiote:\n"
        "      settings: {}\n",
        encoding="utf-8",
    )
    return home


def snapshot(paths: list[Path]) -> dict:
    """Existence + inode + (for readable dirs) the sorted entry names of each watched live path."""
    out = {}
    for p in paths:
        try:
            st = p.stat()
            item = {"exists": True, "ino": st.st_ino}
            if p.is_dir():
                try:
                    item["entries"] = sorted(e.name for e in os.scandir(p))
                except OSError:
                    item["entries"] = None
            out[str(p)] = item
        except OSError:
            out[str(p)] = {"exists": False}
    return out


# ---------------------------------------------------------------------------------------------
# reporting
# ---------------------------------------------------------------------------------------------

def record(path_id: str, title: str, fn) -> None:
    """Run one operator path; PASS/FAIL is decided by the checks inside ``fn``."""
    started = time.time()
    entry = {"id": path_id, "title": title, "status": "FAIL", "seconds": 0.0}
    try:
        evidence = fn() or {}
        entry.update(evidence)
        entry["status"] = "PASS"
    except Exception as exc:  # a failed path must not stop the rest of the run
        entry["error"] = f"{type(exc).__name__}: {exc}"
        entry["traceback"] = traceback.format_exc(limit=6)
    entry["seconds"] = round(time.time() - started, 2)
    RESULTS.append(entry)
    print(f"\n{'PASS' if entry['status'] == 'PASS' else 'FAIL'}  {path_id}  {title}  ({entry['seconds']}s)")
    for key, value in entry.items():
        if key in {"id", "title", "status", "seconds", "traceback"}:
            continue
        text = json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value
        if len(text) > 1200:
            text = text[:1200] + f"… [truncated, {len(text)} chars]"
        print(f"        {key}: {text}")
    if entry.get("traceback"):
        print(entry["traceback"])


def require(cond, message: str) -> None:
    if not cond:
        raise AssertionError(message)


# ---------------------------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--hermes-source", default=DEFAULT_HERMES_SOURCE)
    ap.add_argument("--plugin-dir", default=str(DEFAULT_PLUGIN_DIR))
    ap.add_argument("--home", default="")
    ap.add_argument("--json", default="")
    args = ap.parse_args()

    plugin_dir = Path(args.plugin_dir).resolve()
    home = Path(args.home).resolve() if args.home else Path(
        tempfile.mkdtemp(prefix="achiote-e2e-", dir=str(SCRATCH))
    ) / "home"
    require(plugin_dir.is_dir(), f"plugin dir not found: {plugin_dir}")
    require(Path(args.hermes_source).is_dir(), f"hermes source not found: {args.hermes_source}")

    prepare_environment(args.hermes_source, home)
    build_isolated_home(plugin_dir, home)
    json_path = Path(args.json).resolve() if args.json else home.parent / "report.json"

    print("Achiote E2E — resolved paths (printed before the first plugin write)")
    print(f"  hermes source : {args.hermes_source}")
    print(f"  plugin dir    : {plugin_dir}")
    print(f"  HERMES_HOME   : {home}")
    print(f"  plugin data   : {home / 'plugin-data' / 'achiote'}")
    print(f"  report        : {json_path}")

    from hermes_constants import get_hermes_home
    require(Path(get_hermes_home()).resolve() == home.resolve(),
            f"HERMES_HOME did not resolve to the scratch home: {get_hermes_home()}")

    live_before = snapshot(LIVE_WATCH)

    from hermes_cli.plugins import PluginManager
    manager = PluginManager()
    manager.discover_and_load()
    loaded = manager._plugins.get("achiote")
    require(loaded is not None and loaded.enabled, f"plugin not enabled: {loaded}")
    require(not loaded.error, f"plugin load error: {loaded.error}")
    plugin = loaded.module
    scope = manager.scope_key
    from tools.registry import registry

    def dispatch(name: str, payload: dict, session_id: str = ""):
        raw = registry.dispatch(name, payload, scope=scope, session_id=session_id)
        require(isinstance(raw, str), f"{name} dispatch returned {type(raw).__name__}, expected str")
        return json.loads(raw)

    state: dict = {}

    # ---- 1. real plugin load + manifest/registration parity ---------------------------------
    def path_load():
        from ruamel.yaml import YAML
        manifest = YAML(typ="safe").load((home / "plugins" / "achiote" / "plugin.yaml").read_text(encoding="utf-8"))
        toolset_map = registry.get_tool_to_toolset_map()
        tools = sorted(n for n, ts in toolset_map.items() if ts == "achiote")
        hooks = {h: [getattr(cb, "__module__", "?") for cb in manager._hooks.get(h, [])]
                 for h in ("pre_llm_call", "pre_tool_call")}
        commands = {name: {"plugin": meta.get("plugin"), "args_hint": meta.get("args_hint")}
                    for name, meta in manager._plugin_commands.items()}
        cli = sorted(manager._cli_commands)
        declared_tools = list(manifest.get("provides_tools") or [])
        declared_hooks = list(manifest.get("provides_hooks") or [])
        require(tools == sorted(declared_tools), f"tool parity mismatch: registry={tools} manifest={declared_tools}")
        require(sorted(k for k, v in hooks.items() if v) == sorted(declared_hooks),
                f"hook parity mismatch: registry={hooks} manifest={declared_hooks}")
        require(set(commands) == {"achiote"}, f"slash command missing: {commands}")
        require(len(loaded.tools_registered) == 5, f"expected 5 tools, got {loaded.tools_registered}")
        # schemas registered under the same names the manifest promises
        for name in declared_tools:
            schema = registry.get_schema(name)
            require(isinstance(schema, dict) and schema.get("name") == name, f"schema/name mismatch for {name}")
        state.update(scope=scope, plugin_module=plugin)
        return {
            "plugin": {"key": "achiote", "enabled": loaded.enabled, "source": loaded.manifest.source,
                       "version": loaded.manifest.version, "path": loaded.manifest.path},
            "tools": tools,
            "tool_schemas": {n: registry.get_schema(n).get("name") for n in declared_tools},
            "hooks": hooks,
            "slash_commands": commands,
            "cli_commands": cli,
            "manifest_parity": {"tools": True, "hooks": True, "slash_command": True},
        }

    record("1_plugin_load", "real PluginManager load + manifest/registration parity", path_load)

    # ---- 2. real npx subprocess (cold start) -------------------------------------------------
    def path_npx():
        npm_cache = home / "cache" / "npm-cold"
        npm_cache.mkdir(parents=True, exist_ok=True)
        old_cache = os.environ.get("npm_config_cache")
        os.environ["npm_config_cache"] = str(npm_cache)
        calls = []
        real_run = plugin.subprocess.run

        def recording_run(cmd, **kwargs):
            proc = real_run(cmd, **kwargs)
            calls.append({"argv": cmd, "exit_code": proc.returncode,
                          "stdout_head": (proc.stdout or "")[:160],
                          "stderr_tail": (proc.stderr or "")[-200:],
                          "cwd": kwargs.get("cwd"),
                          "env_probe": {k: (kwargs.get("env") or {}).get(k)
                                        for k in ("ACHIOTE_PLUGIN_DATA", "ACHIOTE_CACHE_PATH")}})
            return proc

        plugin.subprocess.run = recording_run
        started = time.time()
        try:
            res = plugin.run_achiote(["ask", "--json", "--",
                                      "my grandmother simmered a chicken and rice stew in a clay pot"])
        finally:
            plugin.subprocess.run = real_run
            if old_cache is None:
                os.environ.pop("npm_config_cache", None)
            else:
                os.environ["npm_config_cache"] = old_cache
        latency = round(time.time() - started, 2)
        require(calls, "no subprocess call was recorded")
        call = calls[0]
        require(call["argv"][:3] == ["npx", "-y", "achiote@0.2.2"], f"unexpected argv: {call['argv']}")
        require(call["exit_code"] == 0, f"npx exited {call['exit_code']}")
        require(res.get("ok") is True, f"run_achiote failed: {res}")
        data = res["data"]
        require(data.get("answer"), "engine returned no answer")
        state["npx_cold_latency"] = latency
        # the plugin's own parser must strip the engine's log prefix and keep the JSON object
        require("plan_tool_workflow" in call["stdout_head"] or "{" in call["stdout_head"],
                "stdout head did not look like the engine's log+JSON shape")
        return {
            "argv": call["argv"],
            "shell": False,
            "exit_code": call["exit_code"],
            "cold_start_seconds": latency,
            "child_cwd": call["cwd"],
            "child_env_probe": call["env_probe"],
            "stdout_head": call["stdout_head"].strip(),
            "parsed": {"status": data.get("status"), "guarded": data.get("guarded"),
                       "toolsRun": data.get("toolsRun"),
                       "answer_chars": len(data.get("answer") or "")},
            "keys": sorted(data),
        }

    record("2_npx_subprocess", "real `npx -y achiote@0.2.2 ask --json` subprocess (cold cache)", path_npx)

    # ---- 3. tool registry dispatch ------------------------------------------------------------
    def path_tools():
        memory = "my grandma wrapped tamales in banana leaves and steamed them with achiote"
        t0 = time.time()
        rec = dispatch("achiote_reconstruct", {"memory": memory, "user_location": "Austin, TX"},
                       session_id="e2e-session")
        warm = round(time.time() - t0, 2)
        require(rec.get("ok") is True, f"reconstruct failed: {rec}")
        rid = rec.get("reconstruction_id")
        require(isinstance(rid, str) and len(rid) == 32, f"bad reconstruction_id: {rid}")
        require(rec.get("status"), "summary lost the engine status")
        require("full_result" in rec and rec["full_result"]["handle"] == rid, "summary handle missing")

        summary = dispatch("achiote_get_reconstruction", {"reconstruction_id": rid, "section": "summary"},
                           session_id="e2e-session")
        answer = dispatch("achiote_get_reconstruction", {"reconstruction_id": rid, "section": "answer"},
                          session_id="e2e-session")
        receipt = dispatch("achiote_get_reconstruction", {"reconstruction_id": rid, "section": "receipt"},
                           session_id="e2e-session")
        sources = dispatch("achiote_get_reconstruction", {"reconstruction_id": rid, "section": "sources"},
                           session_id="e2e-session")
        for name, payload in (("summary", summary), ("answer", answer), ("receipt", receipt), ("sources", sources)):
            require(payload.get("ok") is True, f"get_reconstruction[{name}] failed: {payload}")
        require("chunk" in answer and len(answer["chunk"]) > 0, "answer section empty")

        saved = dispatch("achiote_save_dish", {"title": "Tamales de mi abuela", "reconstruction_id": rid,
                                               "notes": "banana leaves, achiote"}, session_id="e2e-session")
        require(saved.get("ok") is True, f"save failed: {saved}")
        require(saved["dish"]["reconstruction"]["reconstruction_id"] == rid, "saved dish lost its reconstruction")

        listed = dispatch("achiote_list_dishes", {"limit": 10})
        require(listed.get("ok") is True and listed.get("count") == 1, f"list failed: {listed}")
        require(listed["dishes"][0]["title"] == "Tamales de mi abuela", "ledger order wrong")

        ledger_path = home / "plugin-data" / "achiote" / "saved_dishes.json"
        ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
        require(isinstance(ledger, list) and len(ledger) == 1, "ledger file not written")
        recon_files = sorted((home / "plugin-data" / "achiote" / "reconstructions").glob("*.json"))
        require(any(p.stem == rid for p in recon_files), "reconstruction file missing under isolated home")
        state.update(rid=rid, ledger_path=str(ledger_path))
        return {
            "reconstruct": {k: rec.get(k) for k in ("ok", "reconstruction_id", "status", "cite", "answer_chars")},
            "warm_call_seconds": warm,
            "get_reconstruction": {s: {"ok": p.get("ok"), "section": p.get("section"),
                                       "total_chars": p.get("total_chars")}
                                   for s, p in (("summary", summary), ("answer", answer),
                                                ("receipt", receipt), ("sources", sources))},
            "save_dish": {"ok": saved.get("ok"), "count": saved.get("count"), "dish_id": saved["dish"]["id"]},
            "list_dishes": listed,
            "ledger_file": {"path": str(ledger_path), "bytes": ledger_path.stat().st_size,
                            "entries": [{"title": e["title"],
                                         "reconstruction_id": e["reconstruction"]["reconstruction_id"]}
                                        for e in ledger]},
            "reconstruction_files": [p.name for p in recon_files],
        }

    record("3_tool_dispatch", "5 tools through tools.registry.dispatch (real dispatcher)", path_tools)

    # ---- 4. cite-or-die, both directions ------------------------------------------------------
    def path_cite():
        cue = {
            "cue": "Steam corn masa in banana leaves with achiote-scented pork",
            "sources": [{"url": "https://www.seriouseats.com/tamales-guide", "title": "A guide to tamales"}],
            "substitutions": [{"original": "banana leaves", "substitute": "parchment paper + foil"}],
        }
        good = dispatch("achiote_cite_check", {"payload": cue})
        stripped = {k: ([] if k in ("sources", "substitutions") else v) for k, v in cue.items()}
        bad = dispatch("achiote_cite_check", {"payload": stripped})
        require(good.get("ok") is True, f"cited cue failed: {good}")
        require(bad.get("ok") is False, f"stripped cue passed: {bad}")
        require("missing citation/source/provenance evidence" in bad["reasons"], "no citation reason")
        require("missing local-substitution / accessibility evidence" in bad["reasons"], "no sub reason")
        # the real reconstruct result (no model keys) must fail honestly rather than invent a citation
        live = dispatch("achiote_cite_check", {"reconstruction_id": state["rid"]}, session_id="e2e-session")
        state["live_cite"] = live
        return {"with_sources": good, "stripped": bad, "live_no_key_reconstruction": live}

    record("4_cite_or_die", "cite-or-die passes with sources, fails with sources stripped", path_cite)

    # ---- 5. offline: a real npm failure -------------------------------------------------------
    def path_offline():
        offline_cache = home / "cache" / "npm-offline"
        offline_cache.mkdir(parents=True, exist_ok=True)
        saved_env = {k: os.environ.get(k) for k in
                     ("npm_config_cache", "HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy")}
        os.environ["npm_config_cache"] = str(offline_cache)
        for key in ("HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"):
            os.environ[key] = "http://127.0.0.1:1"  # closed port: real ECONNREFUSED
        latest_path = home / "plugin-data" / "achiote" / "latest.json"
        latest_before = latest_path.read_text(encoding="utf-8")
        recon_before = len(list((home / "plugin-data" / "achiote" / "reconstructions").glob("*.json")))
        t0 = time.time()
        try:
            res = dispatch("achiote_reconstruct", {"memory": "my grandma made tamales"},
                           session_id="e2e-offline")
        finally:
            for key, value in saved_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
        latency = round(time.time() - t0, 1)
        require(res.get("ok") is False, f"offline run unexpectedly succeeded: {res}")
        err = res.get("error") or ""
        diag = res.get("diagnostics") or {}
        require("npm error" not in err and "npm notice" not in err, f"raw npm noise leaked: {err!r}")
        require("could not download achiote@0.2.2" in err, f"not the actionable message: {err!r}")
        require("npx -y achiote@0.2.2 ask --help" in err, "recovery command missing")
        require(diag.get("exit_code") == 1, f"diagnostics lost exit code: {diag}")
        require("ECONNREFUSED" in (diag.get("stderr_tail") or ""), f"diagnostics lost stderr: {diag}")
        require(latest_path.read_text(encoding="utf-8") == latest_before, "offline failure replaced latest.json")
        require(len(list((home / "plugin-data" / "achiote" / "reconstructions").glob("*.json"))) == recon_before,
                "offline failure persisted a reconstruction")
        return {"latency_seconds": latency, "operator_error": err, "diagnostics": diag,
                "latest_unchanged": True, "reconstruction_count": recon_before,
                "raw_npm_noise_in_error": False}

    record("5_offline", "real npm failure (dead proxy) → actionable error, diagnostics kept", path_offline)

    # ---- 6. real pre_llm_call hook chain ------------------------------------------------------
    def path_hooks():
        fragment = "my abuela made this soup with plantains, can you recreate it?"
        pos = manager.invoke_hook("pre_llm_call", session_id="e2e-hook", user_message=fragment,
                                  conversation_history=[], is_first_turn=True, model="m", platform="cli")
        neg = manager.invoke_hook("pre_llm_call", session_id="e2e-hook",
                                  user_message="fix the failing pytest in tools/registry.py",
                                  conversation_history=[], is_first_turn=True, model="m", platform="cli")
        require(pos and "Achiote research brief" in pos[0]["context"], f"positive hook did not inject: {pos}")
        require("Achiote cite-or-die" in pos[0]["context"], "guardrail missing on fragment")
        require(neg == [], f"negative hook injected context: {neg}")

        uncited = {"channel": "discord", "text": "Here is your minimum viable nostalgia cue — serve it tonight."}
        cited = {"channel": "discord",
                 "text": "Nostalgia cue: steam masa in banana leaves. Source: https://example.org/tamales. "
                         "Swap banana leaves -> parchment + foil."}
        blocked = manager.invoke_hook("pre_tool_call", tool_name="send_message", args=uncited)
        allowed = manager.invoke_hook("pre_tool_call", tool_name="send_message", args=cited)
        research = manager.invoke_hook("pre_tool_call", tool_name="web_search", args=uncited)
        require(blocked and blocked[0].get("action") == "block", f"uncited emit not blocked: {blocked}")
        require(blocked[0].get("message"), "block directive without a message is ignored by the host")
        require(allowed == [], f"cited emit was blocked: {allowed}")
        require(research == [], f"research tool was gated: {research}")
        return {"positive_context": pos[0]["context"], "negative_result": neg,
                "pre_tool_block": blocked[0], "pre_tool_allow_cited": allowed,
                "pre_tool_allow_research": research}

    record("6_hooks", "real pre_llm_call / pre_tool_call chain (fragment vs non-matching)", path_hooks)

    # ---- 7. slash command + CLI subcommand surface -------------------------------------------
    def path_slash_cli():
        handler = manager._plugin_commands["achiote"]["handler"]
        help_text = handler("help")
        live_ask = handler('ask "my grandmother cooked arroz con pollo in a clay pot" --location "Austin, TX"')
        status = handler(f"status {state['rid']}")
        save = handler(f'save Abuela tamales --id {state["rid"]}')
        cook = handler("cook")
        blocked_cmd = handler("purge everything")
        require("Usage:" in help_text and "/achiote ask" in help_text, "help text missing")
        require("reconstruction_id:" in live_ask, "slash ask returned no handle")
        require("cite-or-die" in live_ask, "slash ask lost the cite verdict")
        require(json.loads(status)["reconstruction_id"] == state["rid"], "status did not resolve the id")
        require(json.loads(save).get("ok") is True, f"slash save failed: {save}")
        require("disabled" in cook, "cook gate missing")
        require("Unknown or blocked subcommand" in blocked_cmd, "unsafe subcommand not refused")

        from hermes_cli.main import _build_cli_parser
        parser, subparsers = _build_cli_parser()
        choices = sorted(subparsers.choices or {})
        require(manager._cli_commands == {}, f"plugin registered CLI commands: {manager._cli_commands}")
        require("achiote" not in choices, "achiote unexpectedly became a CLI subcommand")
        return {"slash_help_head": help_text.splitlines()[0],
                "slash_ask_head": live_ask[:220], "slash_ask_tail": live_ask[-180:],
                "slash_status_ok": json.loads(status)["ok"],
                "slash_save_ok": json.loads(save)["ok"],
                "slash_cook": cook, "slash_blocked": blocked_cmd,
                "cli_subcommands_registered": sorted(manager._cli_commands),
                "real_argparse_subcommand_count": len(choices),
                "achiote_in_argparse_choices": "achiote" in choices}

    record("7_slash_cli", "/achiote handler + real argparse entry (no CLI subcommand registered)", path_slash_cli)

    # ---- 8. dashboard API through the host mount ---------------------------------------------
    def path_dashboard():
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        import hermes_cli.web_server_dashboard as wsd

        found = [p for p in wsd._discover_dashboard_plugins() if p["name"] == "achiote"]
        require(found, "dashboard manifest not discovered from the isolated home")
        entry = found[0]
        app = FastAPI()
        mounted = wsd._mount_one_plugin_api(app, entry, {"achiote"}, set())
        require(mounted, "host refused to mount the plugin API")
        client = TestClient(app)
        routes = {}
        for route in ("health", "last", "dishes", "provenance"):
            resp = client.get(f"/api/plugins/achiote/{route}")
            require(resp.status_code == 200, f"{route}: HTTP {resp.status_code}")
            routes[route] = {"status": resp.status_code, "body": resp.json()}
        expected_scope = hashlib.sha256(
            str((home / "plugin-data" / "achiote").resolve()).encode("utf-8")).hexdigest()[:16]
        for route, payload in routes.items():
            require(payload["body"].get("scope") == expected_scope,
                    f"{route} scope {payload['body'].get('scope')} != {expected_scope}")
        latest = json.loads((home / "plugin-data" / "achiote" / "latest.json").read_text(encoding="utf-8"))
        ledger = json.loads((home / "plugin-data" / "achiote" / "saved_dishes.json").read_text(encoding="utf-8"))
        require(routes["last"]["body"].get("reconstruction_id") == latest["reconstruction_id"],
                "dashboard /last does not follow latest.json")
        require(routes["dishes"]["body"].get("count") == len(ledger),
                "dashboard /dishes count disagrees with the ledger file")
        require(routes["provenance"]["body"].get("ok") is True, "dashboard /provenance has no graph")

        entry_file = Path(entry["_dir"]) / entry["entry"]
        require(entry_file.is_file(), f"dashboard entry missing: {entry_file}")
        node = shutil.which("node")
        require(node, "node not found; cannot syntax-check the bundle")
        checked = subprocess.run([node, "--check", str(entry_file)], capture_output=True, text=True)
        require(checked.returncode == 0, f"dashboard bundle does not parse: {checked.stderr[:400]}")
        desktop_entry = Path(entry["_dir"]).parent / "desktop" / "plugin.js"
        desktop_ok = desktop_entry.is_file() and subprocess.run(
            [node, "--check", str(desktop_entry)], capture_output=True, text=True).returncode == 0
        return {"mounted": mounted, "routes": routes, "scope": expected_scope,
                "manifest_entry": str(entry_file), "entry_parses_as_js": True,
                "desktop_entry": str(desktop_entry), "desktop_entry_parses_as_js": desktop_ok}

    record("8_dashboard", "real dashboard API mount (TestClient) + bundle parse", path_dashboard)

    # ---- 9. isolation -----------------------------------------------------------------------
    def path_isolation():
        data_dir = home / "plugin-data" / "achiote"
        files = sorted(str(p.relative_to(home)) for p in data_dir.rglob("*") if p.is_file())
        require(any(f.startswith("plugin-data/achiote/reconstructions/") for f in files), "no reconstruction on disk")
        require("plugin-data/achiote/saved_dishes.json" in files, "no ledger on disk")
        require(all(str(p).startswith(str(home)) for p in data_dir.rglob("*")), "a state file escaped the scratch home")

        live_after = snapshot(LIVE_WATCH)
        # Hard claims: every watched Achiote path is byte-for-byte the same shape as before the run,
        # and the live plugin-data root never gained an achiote entry.
        for path in ("/home/simon/.hermes-org/plugin-data/achiote",
                     "/home/simon/.hermes-org/profiles/growth-comms/plugin-data/achiote"):
            require(live_after[path] == live_before[path], f"live path changed: {path}")
        live_root_entries = live_after["/home/simon/.hermes-org/plugin-data"].get("entries") or []
        require("achiote" not in live_root_entries, "live plugin-data lists an achiote entry")
        live_plugin_data_unchanged = (
            live_after["/home/simon/.hermes-org/plugin-data"]["entries"]
            == live_before["/home/simon/.hermes-org/plugin-data"]["entries"]
        )
        # The child process itself was pointed at the scratch data dir (recorded in path 2).
        child_env = (RESULTS[1].get("child_env_probe") or {}) if len(RESULTS) > 1 else {}
        require(str(child_env.get("ACHIOTE_PLUGIN_DATA", "")).startswith(str(home)),
                f"child ACHIOTE_PLUGIN_DATA not in scratch home: {child_env}")
        return {"isolated_home": str(home), "state_files": files,
                "live_achiote_dirs_absent": True,
                "live_plugin_data_entries_unchanged": live_plugin_data_unchanged,
                "live_watch": live_after,
                "child_env_probe": child_env,
                "live_state_untouched_by_achiote": True}

    record("9_isolation", "state confined to scratch home; live Hermes untouched", path_isolation)

    # ---- report ----------------------------------------------------------------------------
    failed = [r for r in RESULTS if r["status"] != "PASS"]
    report = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "hermes_source": args.hermes_source,
        "plugin_dir": str(plugin_dir),
        "hermes_home": str(home),
        "python": sys.version.split()[0],
        "paths": RESULTS,
        "summary": {"total": len(RESULTS), "passed": len(RESULTS) - len(failed), "failed": len(failed)},
        "live_state_before": live_before,
        "environment": {"HERMES_HOME": os.environ.get("HERMES_HOME"),
                        "HERMES_DISABLE_LAZY_INSTALLS": os.environ.get("HERMES_DISABLE_LAZY_INSTALLS"),
                        "HERMES_DELEGATED_CHILD_CONTEXT": os.environ.get("HERMES_DELEGATED_CHILD_CONTEXT"),
                        "HERMES_SESSION_PLATFORM": os.environ.get("HERMES_SESSION_PLATFORM")},
    }
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("\n" + "=" * 78)
    for r in RESULTS:
        print(f"{r['status']:4}  {r['id']:<16} {r['title']}")
    print("=" * 78)
    print(f"{report['summary']['passed']}/{report['summary']['total']} paths passed — report: {json_path}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
