import asyncio
import importlib.util
import sys
import types
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parent.parent


def _load_api(monkeypatch):
    fastapi = types.ModuleType("fastapi")

    class APIRouter:
        def get(self, _path):
            return lambda fn: fn

    fastapi.APIRouter = APIRouter
    monkeypatch.setitem(sys.modules, "fastapi", fastapi)
    spec = importlib.util.spec_from_file_location("achiote_api_under_test", PLUGIN_DIR / "dashboard" / "plugin_api.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_dashboard_reads_latest_pointer_and_scopes(plugin, monkeypatch):
    from conftest import producer_result

    api = _load_api(monkeypatch)
    empty = asyncio.run(api.last_reconstruction())
    assert empty["ok"] is False and empty["scope"]
    plugin.set_mode(stdout=producer_result())
    env = plugin.reconstruct("abuela pasteles", session_id="s1")
    last = asyncio.run(api.last_reconstruction())
    assert last["ok"] and last["reconstruction_id"] == env["reconstruction_id"]
    assert last["provenance"]["sources"] and last["scope"] == empty["scope"]
    assert asyncio.run(api.dishes())["scope"] == empty["scope"]
