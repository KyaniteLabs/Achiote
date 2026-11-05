"""Achiote Desktop/Dashboard backend — reads profile plugin-data only."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter

router = APIRouter()


def _data_dir() -> Path:
    from plugins.plugin_storage import plugin_data_dir

    return plugin_data_dir("achiote")


def _read(name: str, default):
    path = _data_dir() / name
    try:
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        pass
    return default


@router.get("/health")
async def health():
    return {"ok": True, "plugin": "achiote"}


@router.get("/last")
async def last_reconstruction():
    return _read("last_reconstruction.json", {"ok": False, "error": "no reconstruction yet"})


@router.get("/dishes")
async def dishes():
    items = _read("saved_dishes.json", [])
    if not isinstance(items, list):
        items = []
    return {"ok": True, "dishes": items[:50], "count": len(items)}


@router.get("/provenance")
async def provenance():
    last = _read("last_reconstruction.json", {})
    if isinstance(last, dict):
        return {"ok": True, "provenance": last.get("provenance") or {}, "cite": last.get("cite") or {}}
    return {"ok": False, "error": "no reconstruction yet"}
