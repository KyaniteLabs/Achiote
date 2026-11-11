"""Achiote Desktop/Dashboard backend — reads this profile's plugin-data only.

Every response carries ``scope`` (a stable, non-reversible id of this profile's plugin-data dir) so
the pane can refuse to render data that was fetched for a different profile/connection.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from fastapi import APIRouter

router = APIRouter()


def _data_dir() -> Path:
    from plugins.plugin_storage import plugin_data_dir

    return plugin_data_dir("achiote")


def _scope() -> str:
    return hashlib.sha256(str(_data_dir().resolve()).encode("utf-8")).hexdigest()[:16]


def _read(path: Path, default):
    try:
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        pass
    return default


def _latest():
    ptr = _read(_data_dir() / "latest.json", None)
    rid = ptr.get("reconstruction_id") if isinstance(ptr, dict) else None
    if not isinstance(rid, str) or not re.fullmatch(r"[0-9a-f]{32}", rid):
        return None
    rec = _read(_data_dir() / "reconstructions" / f"{rid}.json", None)
    return rec if isinstance(rec, dict) else None


@router.get("/health")
async def health():
    return {"ok": True, "plugin": "achiote", "scope": _scope()}


@router.get("/last")
async def last_reconstruction():
    rec = _latest()
    if rec is None:
        return {"ok": False, "error": "no reconstruction yet", "scope": _scope()}
    result = rec.get("result") if isinstance(rec.get("result"), dict) else {}
    return {
        "ok": True,
        "scope": _scope(),
        "reconstruction_id": rec.get("reconstruction_id"),
        "memory": rec.get("memory"),
        "location_context": rec.get("location_context"),
        "result": {"answer": result.get("answer"), "status": result.get("status")},
        "provenance": rec.get("provenance") or {},
        "cite": rec.get("cite") or {},
    }


@router.get("/dishes")
async def dishes():
    items = _read(_data_dir() / "saved_dishes.json", [])
    if not isinstance(items, list):
        items = []
    return {"ok": True, "scope": _scope(), "dishes": items[:50], "count": len(items)}


@router.get("/provenance")
async def provenance():
    rec = _latest()
    if rec is None:
        return {"ok": False, "error": "no reconstruction yet", "scope": _scope()}
    return {"ok": True, "scope": _scope(), "provenance": rec.get("provenance") or {}, "cite": rec.get("cite") or {}}
