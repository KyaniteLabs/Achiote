"""QA evidence tests: host-contract shape, offline/npx failure paths, fragment injection, ledger.

These complement the Kai regression suite. The fake ctx here mirrors the REAL PluginContext
signatures (name, toolset, schema, handler / name, handler, description, args_hint) so a
regression to the old stub-only shape fails here too.
"""

import inspect
import json
import sys
import textwrap
import types

import pytest

from conftest import producer_result


class RealSignatureCtx:
    """Signature-faithful stand-in for hermes_cli.plugins.PluginContext."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.tools, self.hooks, self.commands, self.skills = {}, {}, {}, {}

    def get_config(self, key, default=None):
        return self.cfg.get(key, default)

    def register_hook(self, hook_name, callback, *, hold_stream=False):
        self.hooks[hook_name] = callback

    def register_command(self, name, handler, description="", args_hint="", argument_mode=None):
        self.commands[name] = handler

    def register_tool(self, name, toolset, schema, handler, check_fn=None,
                      requires_env=None, is_async=False, description="", emoji="", override=False):
        self.tools[name] = (toolset, schema, handler)


# ---- tool contract -----------------------------------------------------------------------------

TOOL_CALLS = {
    "achiote_reconstruct": {"memory": "grandma's pasteles"},
    "achiote_get_reconstruction": {},
    "achiote_save_dish": {"title": "Pasteles", "memory": "m"},
    "achiote_list_dishes": {},
    "achiote_cite_check": {"text": "a cue"},
}


@pytest.mark.parametrize("tool", sorted(TOOL_CALLS))
def test_tool_handlers_return_json_strings_with_and_without_session(plugin, tool):
    handler = plugin.ctx.tools[tool]
    for kwargs in ({}, {"session_id": "s1"}):
        out = handler(dict(TOOL_CALLS[tool]), **kwargs)
        assert isinstance(out, str), (tool, type(out))
        parsed = json.loads(out)
        assert isinstance(parsed, dict)


def test_register_accepts_real_host_signatures(plugin):
    """register() must use (name, toolset, schema, handler) and keyword command args."""
    ctx = RealSignatureCtx({"achiote_command": plugin.ctx.cfg["achiote_command"], "timeout_seconds": 30})
    plugin.register(ctx)
    assert set(ctx.tools) == set(TOOL_CALLS)
    for toolset, schema, _handler in ctx.tools.values():
        assert toolset == "achiote" and schema["name"] in TOOL_CALLS
    assert callable(ctx.commands["achiote"])
    assert set(ctx.hooks) == {"pre_llm_call", "pre_tool_call"}


def test_plugin_handler_signatures_accept_host_dispatch(plugin):
    """Dispatch calls handler(args, **accepted_context); args-only must stay valid."""
    for name, handler in plugin.ctx.tools.items():
        params = inspect.signature(handler).parameters
        assert "args" in params or len(params) >= 1
        assert any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values()), name


# ---- offline / npx-missing / timeout ------------------------------------------------------------

NPM_OFFLINE_STDERR = textwrap.dedent(
    """\
    npm error code ECONNREFUSED
    npm error errno ECONNREFUSED
    npm error network request to https://registry.npmjs.org/achiote failed
    npm error network This is a problem related to network connectivity.
    npm error If you are behind a proxy, please make sure that the 'proxy' config is set properly.
    """
)


def test_offline_npm_failure_is_actionable_and_not_saved(plugin, tmp_path):
    fake = tmp_path / "npx_offline.py"
    fake.write_text(
        "import sys\n"
        f"sys.stderr.write({NPM_OFFLINE_STDERR!r})\n"
        "sys.exit(1)\n"
    )
    plugin.ctx.cfg["achiote_command"] = f"{sys.executable} {fake}"
    env = plugin.reconstruct("grandma's pasteles", session_id="s1")
    assert env["ok"] is False
    assert "could not download achiote@0.2.2 from npm" in env["error"]
    assert "offline or registry blocked" in env["error"]
    assert "achiote_command" in env["error"]
    assert env["diagnostics"]["exit_code"] == 1
    assert "ECONNREFUSED" in env["diagnostics"]["stderr_tail"]
    # failure is never persisted as the latest reconstruction
    assert not plugin._latest_path().is_file()
    # the model sees the same actionable message through the tool surface
    out = json.loads(plugin.ctx.tools["achiote_reconstruct"]({"memory": "x"}, session_id="s1"))
    assert out["ok"] is False and "could not download" in out["error"]


def test_missing_binary_names_the_binary_and_the_setting(plugin):
    plugin.ctx.cfg["achiote_command"] = "definitely-no-such-achiote-binary-xyz"
    env = plugin.reconstruct("grandma's pasteles")
    assert env["ok"] is False
    assert "achiote CLI not found" in env["error"]
    assert "definitely-no-such-achiote-binary-xyz" in env["error"]
    assert "Node >=22" in env["error"]
    assert env["diagnostics"]["exit_code"] is None


def test_timeout_explains_first_run_download(plugin, tmp_path):
    slow = tmp_path / "slow.py"
    slow.write_text("import time\ntime.sleep(5)\n")
    plugin.ctx.cfg["achiote_command"] = f"{sys.executable} {slow}"
    plugin.ctx.cfg["timeout_seconds"] = 1
    env = plugin.reconstruct("grandma's pasteles")
    assert env["ok"] is False
    assert "timed out after 1s" in env["error"]
    assert "downloads" in env["error"] and "timeout_seconds" in env["error"]


# ---- pre_llm_call fragment detection -----------------------------------------------------------

FRAGMENT = "my abuela made this soup with plantains, can you recreate it?"


def _pre_llm(plugin, message="", **cfg):
    for key, value in cfg.items():
        plugin.ctx.cfg[key] = value
    return plugin.ctx.hooks["pre_llm_call"](user_message=message, session_id="s1", is_first_turn=True)


def test_fragment_injects_research_brief_and_guardrails(plugin):
    ctx = _pre_llm(plugin, FRAGMENT)
    assert "Achiote research brief" in ctx["context"]
    assert "Achiote cite-or-die" in ctx["context"]
    assert "achiote_reconstruct" in ctx["context"]


def test_plain_turn_gets_guardrails_but_no_brief(plugin):
    ctx = _pre_llm(plugin, "fix the failing pytest in tools/registry.py")
    assert "cite-or-die" in ctx["context"]
    assert "research brief" not in ctx["context"]


def test_fragment_injection_can_be_disabled(plugin):
    ctx = _pre_llm(plugin, FRAGMENT, inject_on_fragment=False)
    assert "research brief" not in ctx["context"]
    assert "cite-or-die" in ctx["context"]


def test_no_injection_when_both_switches_are_off(plugin):
    assert _pre_llm(plugin, FRAGMENT, inject_on_fragment=False, cite_or_die=False) is None


# ---- saved-dish ledger ------------------------------------------------------------------------

def test_save_dish_ledger_order_count_limit_and_persistence(plugin):
    for title in ("first", "second", "third"):
        saved = plugin.save_dish(title, memory=f"memory of {title}")
        assert saved["ok"] is True
    listed = plugin.list_dishes()
    assert listed["count"] == 3
    assert [d["title"] for d in listed["dishes"]] == ["third", "second", "first"]
    assert plugin.list_dishes(limit=2)["count"] == 3  # count is the ledger size
    assert len(plugin.list_dishes(limit=2)["dishes"]) == 2
    assert plugin.list_dishes(limit=0)["dishes"]  # clamped to 1, never empty-by-limit

    # durable: a fresh module instance over the same data dir reads the same ledger
    import importlib.util
    spec = importlib.util.spec_from_file_location("achiote_ledger_reload", plugin.__file__)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.register(plugin.ctx)
    assert mod.list_dishes()["count"] == 3


def test_save_dish_keeps_full_reconstruction_snapshot(plugin):
    plugin.set_mode(stdout=producer_result())
    env = plugin.reconstruct("grandma pasteles", session_id="s1")
    saved = plugin.save_dish("Pasteles", memory="m", envelope=env)
    snap = saved["dish"]["reconstruction"]
    assert snap["reconstruction_id"] == env["reconstruction_id"]
    assert snap["cite_ok"] is True
    assert snap["sources"] and snap["local_subs"]


# ---- dashboard manifest -----------------------------------------------------------------------

def test_dashboard_manifest_points_at_files_that_exist(plugin):
    from pathlib import Path
    dashboard = Path(plugin.__file__).parent / "dashboard"
    manifest = json.loads((dashboard / "manifest.json").read_text())
    assert manifest["name"] == "achiote"
    for key in ("name", "label", "tab", "entry", "api"):
        assert key in manifest
    assert (dashboard / manifest["entry"]).is_file(), "declared dashboard entry bundle is missing"
    assert (dashboard / manifest["api"]).is_file()
    assert manifest["tab"]["path"].startswith("/")
    bundle = (dashboard / manifest["entry"]).read_text()
    assert '__HERMES_PLUGINS__.register("achiote"' in bundle
