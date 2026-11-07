"""Pytest wrapper for the Achiote operator-path E2E harness.

Runs ``run_achiote_e2e.py`` as a real subprocess (the harness sets its own HERMES_HOME and the
Hermes env flags before importing anything), so pytest collection never has to import Hermes in
an unprepared process. Set ``ACHIOTE_E2E=0`` to skip on machines without a Hermes checkout/node.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
RUNNER = HERE / "run_achiote_e2e.py"
HERMES_SOURCE = os.environ.get("HERMES_SOURCE", "/home/simon/.hermes-org/source/hermes-agent-1158809")
DEFAULT_HERMES_PYTHON = ("/home/simon/.hermes-org/installs/6bdf4c969cf45c8a/environments/"
                         "676fbd68ad8d4d8486a42af67207fb93/venv/bin/python")


def _runner_python() -> str:
    """Interpreter that has the Hermes runtime deps (fastapi/httpx/ruamel), not necessarily pytest."""
    for candidate in (os.environ.get("ACHIOTE_E2E_PYTHON"), DEFAULT_HERMES_PYTHON, sys.executable):
        if candidate and Path(candidate).exists():
            probe = subprocess.run([candidate, "-c", "import fastapi, ruamel.yaml"],
                                   capture_output=True, text=True)
            if probe.returncode == 0:
                return candidate
    pytest.skip("no interpreter with Hermes runtime deps; set ACHIOTE_E2E_PYTHON to the runtime venv")


@pytest.fixture(scope="module")
def e2e_report(tmp_path_factory):
    if os.environ.get("ACHIOTE_E2E", "1") == "0":
        pytest.skip("ACHIOTE_E2E=0")
    if not Path(HERMES_SOURCE).is_dir():
        pytest.skip(f"no Hermes checkout at {HERMES_SOURCE} (set HERMES_SOURCE)")
    python = _runner_python()
    report_path = tmp_path_factory.mktemp("achiote-e2e") / "report.json"
    scratch = Path(os.environ.get("ACHIOTE_E2E_SCRATCH") or tempfile.gettempdir())
    proc = subprocess.run(
        [python, str(RUNNER), "--json", str(report_path)],
        capture_output=True, text=True, timeout=900, cwd=str(HERE.parents[2]),
        env={**os.environ, "HERMES_SOURCE": HERMES_SOURCE, "ACHIOTE_E2E_SCRATCH": str(scratch)},
    )
    report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.is_file() else {}
    return proc, report


def test_every_operator_path_passes(e2e_report):
    proc, report = e2e_report
    assert report, f"harness produced no report; stderr tail:\n{proc.stderr[-2000:]}"
    failed = [p for p in report["paths"] if p["status"] != "PASS"]
    assert not failed, json.dumps(failed, indent=2)[:4000]
    assert proc.returncode == 0, proc.stdout[-3000:]
    assert report["summary"] == {"total": 9, "passed": 9, "failed": 0}


def test_paths_cover_every_required_surface(e2e_report):
    _, report = e2e_report
    ids = {p["id"] for p in report["paths"]}
    assert ids == {
        "1_plugin_load", "2_npx_subprocess", "3_tool_dispatch", "4_cite_or_die", "5_offline",
        "6_hooks", "7_slash_cli", "8_dashboard", "9_isolation",
    }
