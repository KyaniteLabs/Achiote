"""Read-only, profile-local API. No most-recent/global-session fallback."""
import importlib.util
from pathlib import Path
from fastapi import APIRouter, HTTPException, Query

router = APIRouter()


def entry_module():
    spec = importlib.util.spec_from_file_location('achiote_api_entry', Path(__file__).resolve().parents[1] / '__init__.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@router.get('/case')
def get_case(session_id: str = Query(..., min_length=1, max_length=256)):
    try:
        case = entry_module().load_case(session_id)
    except Exception:
        raise HTTPException(status_code=503, detail='Achiote local storage unavailable') from None
    return {'case': case}
