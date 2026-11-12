#!/usr/bin/env python3
"""Offline demo of the Achiote Hermes plugin. No gateway, no NucBox, no network, no model.

Must-ship path, on a fixture reconstruction:

  fragment → cite-or-die fail → cited cue → provenance graph (source → claim)
  → save in one session → reopen the full answer in a later session.

Exits 0 only when that path finishes in under 90 seconds.
Photo→memory, /achiote cook, and heritage locale are not part of this demo.
"""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import time
import types
from pathlib import Path

LIMIT_SECONDS = 90
PLUGIN_DIR = Path(__file__).resolve().parent

DOI = "10.1016/j.foodchem.2020.127001"
ANSWER = "Steam the masa in a banana leaf, then finish on foil if leaves are scarce."
MEMORY = "pass-teh-lay my Puerto Rican grandma steamed in banana leaves, maybe pork"


def _load(data_dir: Path):
    storage = types.ModuleType("plugins.plugin_storage")
    storage.plugin_data_dir = lambda name: data_dir
    pkg = types.ModuleType("plugins")
    pkg.plugin_storage = storage
    sys.modules["plugins"] = pkg
    sys.modules["plugins.plugin_storage"] = storage
    spec = importlib.util.spec_from_file_location("achiote_hermes_demo", PLUGIN_DIR / "__init__.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _fixture() -> dict:
    return {
        "answer": ANSWER,
        "status": "first_test_ready",
        "receipt": {
            "evidence": {
                "userSaid": ["pass-teh-lay steamed in banana leaves"],
                "researched": [
                    "Leaf wrapping transfers volatile aroma (Food Chemistry).",
                    "Sourcing guide: banana leaves and green bananas near Des Moines",
                ],
                "unknown": ["exact meat filling"],
            },
            "shareCard": {
                "doi": DOI,
                "fact": "Leaf wrapping transfers volatile aroma.",
                "citation": "Smith et al. 2020, Food Chemistry",
            },
            "firstTinyTasteTest": {"title": "Banana-leaf steam sniff", "cue": "Steam masa in a banana leaf"},
        },
    }


def _die(message: str) -> None:
    print(f"demo failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    started = time.perf_counter()
    print("Achiote Hermes — offline demo (no gateway, no model)")
    print(f"fragment: {MEMORY}")

    with tempfile.TemporaryDirectory(prefix="achiote-demo-") as tmp:
        data = Path(tmp) / "plugin-data" / "achiote"
        data.mkdir(parents=True)
        mod = _load(data)

        empty = mod.cite_check({"receipt": {"shareCard": {"doi": DOI}, "evidence": {"researched": ["Sourcing guide:"]}}})
        if empty["ok"] or empty["has_local_sub"]:
            _die("cite-or-die accepted a sourcing label with no value")
        print("cite-or-die fail: sourcing label with no value")

        mod.run_achiote = lambda args: {"ok": True, "data": _fixture()}
        monday = mod.reconstruct(MEMORY, user_location="Des Moines", session_id="monday")
        if not monday.get("ok") or not monday["cite"]["ok"]:
            _die(f"cited reconstruction did not pass: {monday.get('cite')}")
        print(f"cited cue: {ANSWER}")
        print(f"reconstruction_id: {monday['reconstruction_id']}")

        edges = monday["provenance"]["edges"]
        support = [e for e in edges if e.get("rel") == "supports" and e.get("to") == "cue" and str(e.get("from", "")).startswith("src")]
        if not support:
            _die("provenance graph has no source → claim edge")
        print("provenance:")
        for edge in edges:
            print(f"  {edge['from']} -{edge['rel']}-> {edge['to']}")

        saved = mod.save_for_session("Pasteles", reconstruction_id=monday["reconstruction_id"], session_id="monday")
        if not saved.get("ok"):
            _die("save failed")
        opened = mod.get_reconstruction_view(monday["reconstruction_id"], section="answer", session_id="tuesday")
        if not opened.get("ok") or opened.get("chunk") != ANSWER:
            _die("later session could not reopen the saved answer")
        print("saved on monday, reopened the full answer on tuesday")

    elapsed = time.perf_counter() - started
    print(f"elapsed: {elapsed:.2f}s (limit {LIMIT_SECONDS}s)")
    if elapsed >= LIMIT_SECONDS:
        _die(f"demo took {elapsed:.2f}s")


if __name__ == "__main__":
    main()
