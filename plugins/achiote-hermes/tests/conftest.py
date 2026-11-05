import importlib.util
import json
import os
import sys
import textwrap
import types
from pathlib import Path

import pytest

PLUGIN_DIR = Path(__file__).resolve().parent.parent


class FakeCtx:
    def __init__(self, cfg):
        self.cfg = cfg
        self.tools, self.hooks, self.commands, self.skills = {}, {}, {}, {}

    def get_config(self, key, default=None):
        return self.cfg.get(key, default)

    def register_hook(self, name, fn):
        self.hooks[name] = fn

    def register_command(self, name, handler, **kw):
        self.commands[name] = handler

    def register_tool(self, name, handler, **kw):
        self.tools[name] = handler

    def register_skill(self, name, path):
        self.skills[name] = path


FAKE_CLI = textwrap.dedent(
    r'''
    import json, os, sys
    data = os.environ.get("ACHIOTE_PLUGIN_DATA", ".")
    with open(os.path.join(data, "calls.jsonl"), "a") as fh:
        fh.write(json.dumps({"argv": sys.argv[1:], "cwd": os.getcwd(), "env": dict(os.environ)}) + "\n")
    mode_path = os.path.join(data, "fake_mode.json")
    mode = json.load(open(mode_path)) if os.path.exists(mode_path) else {"stdout": {}, "code": 0}
    out = mode.get("stdout")
    if out is not None:
        sys.stdout.write(out if isinstance(out, str) else json.dumps(out))
    sys.stderr.write(mode.get("stderr", ""))
    sys.exit(mode.get("code", 0))
    '''
)


@pytest.fixture
def plugin(tmp_path, monkeypatch):
    data = tmp_path / "plugin-data" / "achiote"
    data.mkdir(parents=True)
    storage = types.ModuleType("plugins.plugin_storage")
    storage.plugin_data_dir = lambda name: data
    pkg = types.ModuleType("plugins")
    pkg.plugin_storage = storage
    monkeypatch.setitem(sys.modules, "plugins", pkg)
    monkeypatch.setitem(sys.modules, "plugins.plugin_storage", storage)
    cli = tmp_path / "fake_achiote.py"
    cli.write_text(FAKE_CLI)
    spec = importlib.util.spec_from_file_location("achiote_hermes_under_test", PLUGIN_DIR / "__init__.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    ctx = FakeCtx({"achiote_command": f"{sys.executable} {cli}", "timeout_seconds": 30})
    mod.register(ctx)
    mod.ctx = ctx
    mod.data = data

    def set_mode(stdout=None, code=0, stderr=""):
        (data / "fake_mode.json").write_text(json.dumps({"stdout": stdout, "code": code, "stderr": stderr}))

    def calls():
        p = data / "calls.jsonl"
        return [json.loads(l) for l in p.read_text().splitlines()] if p.exists() else []

    mod.set_mode, mod.calls = set_mode, calls
    return mod


def producer_result(answer="Try a banana-leaf steam cue.", researched=None, doi="10.1016/j.foodchem.2020.127001",
                    status="first_test_ready"):
    """Shape of `achiote ask --json` (src/cli-ask.ts + src/lib/memory-receipt.ts)."""
    return {
        "answer": answer,
        "status": status,
        "toolsRun": ["collect_food_memory", "resolve_dish_name", "source_ingredients"],
        "guarded": None,
        "receipt": {
            "title": "Achiote Memory Receipt",
            "status": status,
            "evidence": {
                "userSaid": ["pass-teh-lay my grandma steamed in banana leaves"],
                "ruledOut": [],
                "inferred": ["Puerto Rico (medium confidence): pasteles"],
                "researched": researched if researched is not None else [
                    'Dish resolved: "Pasteles" (confidence: High, region: Puerto Rico)',
                    "Sourcing guide: banana leaves, green bananas, yautia near Des Moines Iowa",
                ],
                "unknown": ["exact meat filling"],
            },
            "hypotheses": [],
            "nextBestQuestions": ["Was the masa made from green banana?"],
            "firstTinyTasteTest": {"title": "Banana-leaf steam sniff", "cue": "Steam masa in banana leaf", "estimatedTime": "15 minutes"},
            "assistantSummary": "",
            "shareCard": ({"dishName": "Pasteles", "fact": "Leaf wrapping transfers volatile aroma.", "doi": doi,
                           "citation": "Smith et al. 2020, Food Chemistry"} if doi else None),
        },
        "errored": False,
    }
