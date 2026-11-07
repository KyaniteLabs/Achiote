"""Regression tests for Kai's PR #277 review (FAIL @ 13cfe60). One section per finding."""

import json
import multiprocessing
import os
import shutil
import subprocess
import sys
import threading
import types
from pathlib import Path

import pytest

from conftest import producer_result
from hermes_host_directive import resolve

PLUGIN_DIR = Path(__file__).resolve().parent.parent


# ---- 1. cite-or-die must validate evidence VALUES -------------------------------------------

def test_1_empty_cli_object_fails_cite(plugin):
    plugin.set_mode(stdout={})
    env = plugin.reconstruct("grandma's pasteles")
    assert env["ok"] is True
    assert env["cite"]["ok"] is False
    assert env["cite"]["has_citation"] is False and env["cite"]["has_local_sub"] is False


def test_1_field_names_and_skeleton_never_count(plugin):
    assert plugin.cite_check({"sources": [], "substitutions": []})["ok"] is False
    assert plugin.cite_check({"citation": "", "provenance": {}, "receipt": {}, "source": None})["ok"] is False
    skeleton = plugin._provenance_from_result("m", {})
    assert plugin.cite_check({"result": {}, "provenance": skeleton})["ok"] is False
    assert plugin.cite_check({"text": "Here is your nostalgia cue with local ingredient swaps."})["ok"] is False


def test_1_producer_positive_and_negative(plugin):
    assert plugin.cite_check({"result": producer_result()})["ok"] is True
    no_sub = producer_result(researched=['Dish resolved: "Pasteles" (confidence: High, region: Puerto Rico)'])
    c = plugin.cite_check({"result": no_sub})
    assert c["has_citation"] is True and c["has_local_sub"] is False and c["ok"] is False
    empty = producer_result(researched=[], doi=None, answer="")
    assert plugin.cite_check({"result": empty})["ok"] is False
    # userSaid never counts, even if the user typed a URL or "substitute"
    said = producer_result(researched=[], doi=None, answer="")
    said["receipt"]["evidence"]["userSaid"] = ["see https://example.com I substitute plantain at the store near me"]
    assert plugin.cite_check({"result": said})["ok"] is False


def test_1_text_positive_control(plugin):
    text = ("Cue: steam masa in banana leaf. Source: https://doi.org/10.1016/j.foodchem.2020.127001. "
            "Substitute frozen banana leaves from the Latin market on Ingersoll Ave.")
    assert plugin.cite_check({"text": text})["ok"] is True


# ---- 2. Hermes block directive needs a message; research tools never gated ------------------

UNCITED = {"message": "Here is the minimum viable nostalgia cue for grandma's pasteles: steam it."}


def _host(plugin, tool, args):
    return resolve([plugin.ctx.hooks["pre_tool_call"](tool_name=tool, args=args, session_id="s1")], args)


def test_2_uncited_outbound_is_blocked_by_host_parser(plugin):
    action, message = _host(plugin, "send_message", UNCITED)
    assert action == "block"
    assert message and "cite-or-die" in message


def test_2_cited_outbound_passes(plugin):
    args = {"message": UNCITED["message"] + " Source: https://doi.org/10.1016/j.foodchem.2020.127001. Substitute frozen banana leaves from the Asian market downtown."}
    assert _host(plugin, "send_message", args) == (None, None)


@pytest.mark.parametrize("tool", ["web_search", "web_extract", "browser_navigate", "read_file", "search_files",
                                  "session_search", "achiote_reconstruct", "achiote_cite_check", "terminal"])
def test_2_research_and_read_tools_never_blocked(plugin, tool):
    args = {"query": "minimum viable nostalgia cue pasteles recipe", "message": UNCITED["message"]}
    assert _host(plugin, tool, args) == (None, None)


# ---- 3. structured CLI errors are failures, never saved ------------------------------------

def test_3_errored_envelope_exit_1_is_failure(plugin):
    plugin.set_mode(stdout=producer_result())
    good = plugin.reconstruct("first memory")
    assert good["ok"]
    latest = json.loads((plugin.data / "latest.json").read_text())
    err = {"answer": "", "status": None, "toolsRun": [], "receipt": None, "errored": True,
           "errorMessage": "provider 401: invalid api key"}
    plugin.set_mode(stdout=err, code=1, stderr="boom")
    bad = plugin.reconstruct("second memory", session_id="s1")
    assert bad["ok"] is False
    assert "provider 401" in bad["error"]
    assert bad["diagnostics"]["exit_code"] == 1
    assert json.loads((plugin.data / "latest.json").read_text()) == latest  # last success kept
    assert not (plugin.data / "sessions").exists() or not list((plugin.data / "sessions").glob("*.json"))
    out = json.loads(plugin.ctx.tools["achiote_reconstruct"]({"memory": "x"}, session_id="s1"))
    assert out["ok"] is False


def test_3_errored_true_with_exit_0_and_nonzero_without_json(plugin):
    plugin.set_mode(stdout={"answer": "", "errored": True, "errorMessage": "engine error"}, code=0)
    assert plugin.reconstruct("m")["ok"] is False
    plugin.set_mode(stdout="partial human text", code=1, stderr="crash")
    r = plugin.reconstruct("m")
    assert r["ok"] is False and r["diagnostics"]["stderr_tail"] == "crash"


# ---- 4. controlled cwd; no dotenv / NODE_OPTIONS bypass ------------------------------------

def _fake_secret_scope(monkeypatch, mapping=None, multiplex=False):
    """Install a fake ``agent.secret_scope`` that models the REAL provenance API.

    The real module's ``get_secret`` falls through to ``os.environ`` when no scope is bound and
    multiplexing is inactive. Faking only ``get_secret`` therefore hides the leak this suite
    exists to catch — every test here must stub the scope itself.
    """
    scope_mod = types.ModuleType("agent.secret_scope")
    mapping = mapping or {}
    scope_mod.current_secret_scope = lambda: (mapping or None)
    scope_mod.is_multiplex_active = lambda: multiplex

    def get_secret(name, default=None):
        if mapping and name in mapping:
            return mapping[name]
        if multiplex:
            return default
        return os.environ.get(name, default)  # the real fall-through

    scope_mod.get_secret = get_secret
    agent = types.ModuleType("agent")
    agent.secret_scope = scope_mod
    monkeypatch.setitem(sys.modules, "agent", agent)
    monkeypatch.setitem(sys.modules, "agent.secret_scope", scope_mod)
    return scope_mod


def test_4_child_runs_in_controlled_cwd_with_scrubbed_env(plugin, tmp_path, monkeypatch):
    work = tmp_path / "workspace"
    work.mkdir()
    (work / ".env").write_text("OPENAI_API_KEY=sentinel-leak\n")
    monkeypatch.chdir(work)
    monkeypatch.setenv("OPENAI_API_KEY", "parent-env-leak")
    monkeypatch.setenv("NODE_OPTIONS", "--env-file=/tmp/x.env")
    _fake_secret_scope(monkeypatch, mapping=None, multiplex=False)  # no scope -> nothing must flow
    plugin.set_mode(stdout=producer_result())
    assert plugin.reconstruct("m")["ok"]
    call = plugin.calls()[-1]
    assert Path(call["cwd"]).resolve() == (plugin.data / "run").resolve()
    assert "OPENAI_API_KEY" not in call["env"]
    assert "NODE_OPTIONS" not in call["env"]


def test_4_secret_scope_values_still_flow(plugin, monkeypatch):
    _fake_secret_scope(monkeypatch, mapping={"ANTHROPIC_API_KEY": "scoped-key"})
    monkeypatch.setenv("OPENAI_API_KEY", "ambient-only")
    plugin.set_mode(stdout=producer_result())
    plugin.reconstruct("m")
    env = plugin.calls()[-1]["env"]
    assert env["ANTHROPIC_API_KEY"] == "scoped-key"
    assert "OPENAI_API_KEY" not in env


def test_4_scoped_secret_equal_to_ambient_is_still_forwarded(plugin, monkeypatch):
    """Equality is not provenance: a scope legitimately holding the same key as the shell
    must keep its credential, or the child 401s."""
    monkeypatch.setenv("OPENAI_API_KEY", "same-value-both-sides")
    _fake_secret_scope(monkeypatch, mapping={"OPENAI_API_KEY": "same-value-both-sides"})
    plugin.set_mode(stdout=producer_result())
    assert plugin.reconstruct("m")["ok"]
    env = plugin.calls()[-1]["env"]
    assert env["OPENAI_API_KEY"] == "same-value-both-sides"


def test_4_routing_config_falls_back_to_ambient(plugin, monkeypatch):
    """Endpoints/models are not credentials. Dropping them with the keys would send a scoped
    key to the provider's default endpoint instead of ours."""
    monkeypatch.setenv("OPENAI_BASE_URL", "https://gateway.internal/v1")
    monkeypatch.setenv("OPENAI_MODEL", "org-model")
    _fake_secret_scope(monkeypatch, mapping={"OPENAI_API_KEY": "scoped-key"})
    plugin.set_mode(stdout=producer_result())
    assert plugin.reconstruct("m")["ok"]
    env = plugin.calls()[-1]["env"]
    assert env["OPENAI_BASE_URL"] == "https://gateway.internal/v1"
    assert env["OPENAI_MODEL"] == "org-model"
    assert env["OPENAI_API_KEY"] == "scoped-key"


def test_4_refuses_if_dotenv_planted_in_run_dir(plugin):
    run = plugin.data / "run"
    run.mkdir(parents=True, exist_ok=True)
    (run / ".env").write_text("X=1\n")
    r = plugin.reconstruct("m")
    assert r["ok"] is False and ".env" in r["error"]


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_4_real_node_loadEnvFile_sentinel(plugin, tmp_path, monkeypatch):
    """Exact producer statement from src/cli.ts:1 with a fake sentinel; no secrets, no network."""
    ok = subprocess.run(["node", "-e", "process.exit(typeof process.loadEnvFile==='function'?0:1)"])
    if ok.returncode != 0:
        pytest.skip("node lacks process.loadEnvFile")
    script = tmp_path / "cli.mjs"
    script.write_text(
        "try { process.loadEnvFile(); } catch {}\n"
        "process.stdout.write(JSON.stringify({answer: process.env.ACHIOTE_SENTINEL || 'none', errored: false}))\n"
    )
    work = tmp_path / "ws"
    work.mkdir()
    (work / ".env").write_text("ACHIOTE_SENTINEL=leaked\n")
    # Positive control: the statement DOES load from an inherited cwd.
    ctl = subprocess.run(["node", str(script)], cwd=work, capture_output=True, text=True,
                         env={"PATH": os.environ["PATH"]})
    assert json.loads(ctl.stdout)["answer"] == "leaked"
    monkeypatch.chdir(work)
    plugin.ctx.cfg["achiote_command"] = f"node {script}"
    env = plugin.reconstruct("m")
    assert env["ok"] and env["result"]["answer"] == "none"


# ---- 5. user_location reaches the engine ----------------------------------------------------

def test_5_location_is_sent_before_engine(plugin):
    plugin.set_mode(stdout=producer_result())
    env = plugin.reconstruct("grandma's pasteles", user_location="Des Moines, Iowa")
    argv = plugin.calls()[-1]["argv"]
    assert argv[:3] == ["ask", "--json", "--"]
    assert argv[3].endswith("I live in Des Moines Iowa.")
    assert env["location_context"] == {"supplied": "Des Moines Iowa", "sent_to_engine": True}
    plugin.reconstruct("grandma's pasteles")
    assert "I live in" not in plugin.calls()[-1]["argv"][3]


def test_5_location_and_memory_are_data_not_flags(plugin):
    plugin.set_mode(stdout=producer_result())
    plugin.reconstruct("--help me remember", user_location="Austin\n--json; rm -rf /")
    argv = plugin.calls()[-1]["argv"]
    assert argv[2] == "--" and argv[3].startswith("--help me remember")
    assert "\n--json" not in argv[3].split("I live in")[-1]


# ---- 6. bounded, valid JSON with handle --------------------------------------------------------

def test_6_large_outputs_stay_valid_json(plugin):
    big = producer_result(answer="A" * 20000, researched=[f"Research fact {i} " + "x" * 2000 for i in range(30)]
                          + ["Sourcing guide: banana leaves near Des Moines Iowa"])
    plugin.set_mode(stdout=big)
    raw = plugin.ctx.tools["achiote_reconstruct"]({"memory": "M" * 5000}, session_id="s1")
    out = json.loads(raw)
    assert out["ok"] and out["cite"]["ok"] is True
    assert out["answer_truncated"] is True and out["full_result"]["handle"] == out["reconstruction_id"]
    assert len(raw) < 20000
    # page the full answer back through the handle
    got, off = "", 0
    while off is not None:
        page = json.loads(plugin.ctx.tools["achiote_get_reconstruction"](
            {"reconstruction_id": out["reconstruction_id"], "section": "answer", "offset": off}, session_id="s1"))
        got += page["chunk"]
        off = page["next_offset"]
    assert got == "A" * 20000
    saved = json.loads(plugin.ctx.tools["achiote_save_dish"]({"title": "T" * 500, "notes": "n" * 9000}, session_id="s1"))
    assert saved["ok"]
    listed = json.loads(plugin.ctx.tools["achiote_list_dishes"]({"limit": 100}))
    assert listed["count"] == 1


# ---- 7. session-scoped last reconstruction --------------------------------------------------

def test_7_save_uses_own_session(plugin):
    plugin.set_mode(stdout=producer_result())
    a = json.loads(plugin.ctx.tools["achiote_reconstruct"]({"memory": "A private memory"}, session_id="A"))
    b = json.loads(plugin.ctx.tools["achiote_reconstruct"]({"memory": "B private memory"}, session_id="B"))
    saved = json.loads(plugin.ctx.tools["achiote_save_dish"]({"title": "A dish"}, session_id="A"))
    assert saved["dish"]["memory"] == "A private memory"
    assert saved["dish"]["reconstruction"]["reconstruction_id"] == a["reconstruction_id"]
    # cross-session explicit ID is refused
    x = json.loads(plugin.ctx.tools["achiote_save_dish"]({"title": "steal", "reconstruction_id": b["reconstruction_id"]}, session_id="A"))
    assert x["ok"] is False
    # no session + no id -> explicit error, never "whatever was last"
    assert json.loads(plugin.ctx.tools["achiote_save_dish"]({"title": "x"}))["ok"] is False
    assert "--id" in plugin.ctx.commands["achiote"]("save my dish")


def test_7_slash_save_by_explicit_id(plugin):
    plugin.set_mode(stdout=producer_result())
    out = plugin.ctx.commands["achiote"]('ask "abuela pasteles" --location "San Juan"')
    rid = out.split("reconstruction_id: ")[1].split()[0]
    saved = json.loads(plugin.ctx.commands["achiote"](f"save Abuela pasteles --id {rid}"))
    assert saved["ok"] and saved["dish"]["reconstruction"]["reconstruction_id"] == rid
    assert json.loads(plugin.ctx.commands["achiote"](f"status {rid}"))["reconstruction_id"] == rid
    assert "Unknown or blocked" in plugin.ctx.commands["achiote"]("purge --yes")


# ---- 8. concurrency ----------------------------------------------------------------------------

def test_8_concurrent_atomic_writes_no_shared_tmp(plugin):
    target = plugin.data / "x.json"
    barrier = threading.Barrier(16)
    errors = []

    def w(i):
        try:
            barrier.wait()
            plugin._save_json(target, {"i": i})
        except Exception as exc:  # pragma: no cover - the bug under test
            errors.append(exc)

    ts = [threading.Thread(target=w, args=(i,)) for i in range(16)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert not errors
    json.loads(target.read_text())
    assert not list(plugin.data.glob(".x.json.*.tmp"))


def test_8_concurrent_saves_threads_no_lost_update(plugin):
    barrier = threading.Barrier(20)

    def s(i):
        barrier.wait()
        plugin.save_dish(f"dish {i}", memory="m")

    ts = [threading.Thread(target=s, args=(i,)) for i in range(20)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert plugin.list_dishes(100)["count"] == 20


def _proc_saver(plugin_init, data_dir, n):
    import importlib.util as iu
    import types as ty
    storage = ty.ModuleType("plugins.plugin_storage")
    storage.plugin_data_dir = lambda name: Path(data_dir)
    pkg = ty.ModuleType("plugins")
    pkg.plugin_storage = storage
    sys.modules["plugins"], sys.modules["plugins.plugin_storage"] = pkg, storage
    spec = iu.spec_from_file_location("achiote_proc", plugin_init)
    mod = iu.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for i in range(n):
        mod.save_dish(f"p{os.getpid()}-{i}", memory="m")


@pytest.mark.skipif(sys.platform.startswith("win"), reason="flock path")
def test_8_concurrent_saves_separate_processes(plugin):
    ctx = multiprocessing.get_context("spawn")
    procs = [ctx.Process(target=_proc_saver, args=(str(PLUGIN_DIR / "__init__.py"), str(plugin.data), 10)) for _ in range(4)]
    [p.start() for p in procs]
    [p.join(60) for p in procs]
    assert all(p.exitcode == 0 for p in procs)
    assert plugin.list_dishes(100)["count"] == 40


# ---- 10. citations: real sources/DOI extracted separately -----------------------------------

def test_10_sources_and_doi_extracted_separately_from_user_said(plugin):
    long_memory = "my grandma " * 60
    res = producer_result()
    res["receipt"]["evidence"]["userSaid"] = [long_memory]
    plugin.set_mode(stdout=res)
    env = plugin.reconstruct(long_memory)
    prov = env["provenance"]
    dois = [s for s in prov["sources"] if s["type"] == "doi"]
    assert dois and dois[0]["doi"] == "10.1016/j.foodchem.2020.127001"
    assert dois[0]["url"] == "https://doi.org/10.1016/j.foodchem.2020.127001"
    assert any(s["type"] == "researched" and "Pasteles" in s["text"] for s in prov["sources"])
    assert all(long_memory.strip()[:40] not in s["text"] for s in prov["sources"])
    assert prov["context"]["userSaid"] == [long_memory.strip()]
    assert any(s["type"] == "sourcing" for s in prov["local_subs"])
    rels = {(e["from"][:3], e["to"], e["rel"]) for e in prov["edges"]}
    assert ("src", "cue", "supports") in rels and ("sub", "cue", "local_swap_for") in rels


# ---- 11. install command ----------------------------------------------------------------------

def test_11_readme_install_uses_trailing_path_form():
    readme = (PLUGIN_DIR / "README.md").read_text()
    assert "hermes plugins install KyaniteLabs/Achiote/plugins/achiote-hermes" in readme
    assert "--subdir" not in readme


def test_manifest_lists_every_registered_tool(plugin):
    yaml_text = (PLUGIN_DIR / "plugin.yaml").read_text()
    for name in plugin.ctx.tools:
        assert f"  - {name}" in yaml_text
