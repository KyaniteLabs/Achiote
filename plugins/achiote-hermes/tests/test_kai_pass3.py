"""Regression tests for Kai's PR #277 re-review @ c031602 (CHANGES STILL REQUIRED)."""

import json

import pytest

from conftest import producer_result

GOOD_DOI = "10.1016/j.foodchem.2020.127001"


def _labeled_receipt(researched):
    return {
        "receipt": {
            "shareCard": {"doi": GOOD_DOI},
            "evidence": {"researched": researched},
        }
    }


@pytest.mark.parametrize("researched", [
    ["Sourcing guide:"],
    ["Starting points:"],
    ["Sourcing guide: unknown"],
    ["Substitute: unknown -> foil"],
    ["Static regional availability matched:"],
    ["Sourcing guide: not provided"],
])
def test_pass3_receipt_label_without_a_value_fails(plugin, researched):
    check = plugin.cite_check(_labeled_receipt(researched))
    assert check["ok"] is False
    assert check["has_citation"] is True
    assert check["has_local_sub"] is False
    blocked = plugin.ctx.hooks["pre_tool_call"](
        "send_message",
        {"text": "Here is the nostalgia cue", "receipt": _labeled_receipt(researched)["receipt"]},
    )
    assert blocked and blocked.get("action") == "block" and blocked.get("message")


def test_pass3_prefixed_absence_in_a_substitution_list_fails(plugin):
    check = plugin.cite_check({
        "receipt": {"shareCard": {"doi": GOOD_DOI}},
        "substitutions": ["Substitute: unknown -> foil"],
    })
    assert check["has_local_sub"] is False and check["ok"] is False


def test_pass3_real_sourcing_and_substitution_labels_still_pass(plugin):
    sourcing = _labeled_receipt([
        "Leaf-wrapped steaming retains volatile aroma compounds (search snippet)",
        "Sourcing guide: banana leaves, green bananas, yautia near Des Moines Iowa",
    ])
    assert plugin.cite_check(sourcing)["ok"] is True
    pair = _labeled_receipt(["Substitute: banana leaf -> foil from the grocery store"])
    # The DOI is the citation; the labeled pair is the local sub. No second source is required
    # beyond the share card, but this payload's only researched line is the substitution.
    pair["receipt"]["evidence"]["researched"] = ["Substitute: banana leaf -> foil from the grocery store"]
    check = plugin.cite_check(pair)
    assert check["has_local_sub"] is True and check["ok"] is True


def test_pass3_saved_recipe_reopens_from_a_later_session(plugin):
    answer = "Steam masa in a banana leaf."
    plugin.set_mode(stdout=producer_result(answer=answer))
    monday = plugin.reconstruct("grandma pasteles", session_id="monday")
    saved = plugin.save_for_session(
        "Pasteles", reconstruction_id=monday["reconstruction_id"], session_id="monday")
    assert saved["ok"] is True

    plugin.set_mode(stdout=producer_result(answer="private unsaved"))
    private = plugin.reconstruct("not saved", session_id="monday")
    denied = json.loads(plugin.ctx.tools["achiote_get_reconstruction"](
        {"reconstruction_id": private["reconstruction_id"], "section": "answer"},
        session_id="tuesday",
    ))
    assert denied["ok"] is False
    stolen = plugin.save_for_session(
        "steal", reconstruction_id=private["reconstruction_id"], session_id="tuesday")
    assert stolen["ok"] is False

    plugin.set_mode(stdout=producer_result(answer="other"))
    for i in range(plugin.MAX_RECONSTRUCTIONS + 2):
        plugin.reconstruct(f"filler {i}", session_id="tuesday")

    listed = json.loads(plugin.ctx.tools["achiote_list_dishes"]({}))
    rid = listed["dishes"][0]["reconstruction_id"]
    assert rid == monday["reconstruction_id"]
    opened = json.loads(plugin.ctx.tools["achiote_get_reconstruction"](
        {"reconstruction_id": rid, "section": "answer"}, session_id="tuesday"))
    assert opened["ok"] is True and opened["chunk"] == answer
    cited = json.loads(plugin.ctx.tools["achiote_cite_check"](
        {"reconstruction_id": rid}, session_id="tuesday"))
    assert cited["ok"] is True
    # The later session's implicit last result stays its own.
    assert plugin.session_last("tuesday")["reconstruction_id"] != rid
    assert plugin.session_last("tuesday")["memory"].startswith("filler")
