"""Verbatim directive-resolution loop from Hermes' host parser, pinned for regression tests.

Source: NousResearch/hermes-agent@5014f407dfce8e1a73c9c242cd4b6b9821043332
hermes_cli/plugins.py `_get_pre_tool_call_directive_details` (lines ~1930-1957). Only the
hook-invocation call is replaced by the ``hook_results`` argument; the parsing is unchanged.
"""

from typing import Any, Optional


def resolve(hook_results: list, args: Optional[dict] = None):
    modified_args = None
    first_approve = None
    for result in hook_results:
        if not isinstance(result, dict):
            continue
        action = result.get("action")
        if action == "modify":
            partial = result.get("args")
            if isinstance(partial, dict) and partial:
                modified_args = {**(modified_args if modified_args is not None else
                                    (args if isinstance(args, dict) else {})), **partial}
            continue
        if action not in ("block", "approve"):
            continue
        message = result.get("message")
        message = message if isinstance(message, str) and message else None
        if action == "block" and not message:
            continue
        if action == "block":
            return ("block", message)
        if first_approve is None:
            first_approve = (message, None)
    if first_approve is not None:
        return ("approve", first_approve[0])
    return (None, None)
