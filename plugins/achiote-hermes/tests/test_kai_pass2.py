"""Regression tests for Kai's PR #277 re-review @ 46db6c8 (CHANGES STILL REQUIRED). One section per finding."""

import json

import pytest

from conftest import producer_result


# ---- 1. absent / malformed evidence never passes cite-or-die -------------------------------

GOOD_SUB = ["Substitute frozen banana leaves from the Asian market downtown"]
GOOD_DOI = "10.1016/j.foodchem.2020.127001"


def _receipt(share=None, evidence=None):
    rec = {}
    if share is not None:
        rec["shareCard"] = share
    if evidence is not None:
        rec["evidence"] = evidence
    return {"receipt": rec}


def test_p2_1_kai_payloads_fail(plugin):
    a = plugin.cite_check({**_receipt(share={"doi": "unknown"}), "substitutions": ["not provided"]})
    assert a["ok"] is False and a["has_citation"] is False and a["has_local_sub"] is False
    b = plugin.cite_check({**_receipt(evidence={"researched": ["No sources were found."]}), "substitutions": ["not provided"]})
    assert b["ok"] is False and b["has_citation"] is False and b["has_local_sub"] is False


@pytest.mark.parametrize("doi", ["unknown", "n/a", "none", "10.", "10.12/x", "doi:", "https://doi.org/", "see notes", "10.1016"])
def test_p2_1_invalid_share_card_doi_is_not_a_source(plugin, doi):
    c = plugin.cite_check({**_receipt(share={"doi": doi, "citation": "Smith 2020"}), "substitutions": GOOD_SUB})
    assert c["has_citation"] is False and c["ok"] is False


@pytest.mark.parametrize("doi", [GOOD_DOI, f"doi:{GOOD_DOI}", f"https://doi.org/{GOOD_DOI}"])
def test_p2_1_valid_share_card_doi_is_a_source(plugin, doi):
    c = plugin.cite_check({**_receipt(share={"doi": doi}), "substitutions": GOOD_SUB})
    assert c["ok"] is True
    src = plugin.extract_evidence({**_receipt(share={"doi": doi})})["sources"][0]
    assert src["doi"] == GOOD_DOI and src["url"] == f"https://doi.org/{GOOD_DOI}"


@pytest.mark.parametrize("bad", ["unknown", "No sources were found.", {"a": "Sourcing guide: banana leaves"}, 42, True])
def test_p2_1_wrong_collection_type_never_iterated(plugin, bad):
    ev = plugin.extract_evidence(_receipt(evidence={"researched": bad, "userSaid": "unknown"}))
    assert ev["sources"] == [] and ev["local_subs"] == []
    assert "userSaid" not in ev["context"]  # a bare string is not split into characters
    c = plugin.cite_check({**_receipt(share={"doi": GOOD_DOI}, evidence={"researched": bad}), "substitutions": GOOD_SUB})
    assert any("researched" in r for r in c["reasons"])  # malformed shape is reported


def test_p2_1_non_string_researched_items_ignored(plugin):
    ev = plugin.extract_evidence(_receipt(evidence={"researched": [None, 7, {"x": 1}, ["https://example.com"]]}))
    assert ev["sources"] == [] and ev["local_subs"] == []


@pytest.mark.parametrize("absent", ["No sources were found.", "unknown", "none", "N/A", "no citations available",
                                    "Not found", "-", "TBD"])
def test_p2_1_explicitly_absent_researched_is_not_a_source(plugin, absent):
    c = plugin.cite_check({**_receipt(evidence={"researched": [absent]}), "substitutions": GOOD_SUB})
    assert c["has_citation"] is False and c["ok"] is False


@pytest.mark.parametrize("absent", ["not provided", "none", "unknown", "N/A", "no substitutions found",
                                    "no swaps available", "not available", "store not provided",
                                    "unknown -> unknown", "banana leaf -> n/a"])
def test_p2_1_explicitly_absent_substitution_is_not_a_sub(plugin, absent):
    for subs in ([absent], [{"note": absent}], [{"original": "banana leaf", "substitute": absent}]):
        c = plugin.cite_check({**_receipt(share={"doi": GOOD_DOI}), "substitutions": subs})
        assert c["has_local_sub"] is False and c["ok"] is False, subs


@pytest.mark.parametrize("bad", ["Substitute frozen banana leaves from the Asian market downtown",
                                 {"original": "banana leaf", "substitute": "foil"}, 5])
def test_p2_1_substitutions_must_be_a_list(plugin, bad):
    # A bare string/dict under a collection key is a wrong-typed collection, not a record list.
    ev = plugin.extract_evidence({"substitutions": bad})
    assert all(s["origin"] != "payload.substitutions" for s in ev["local_subs"])


def test_p2_1_two_words_are_not_a_substitution_record(plugin):
    for words in (["frozen leaves"], ["plantain please"], [{"note": "ask grandma"}]):
        c = plugin.cite_check({**_receipt(share={"doi": GOOD_DOI}), "substitutions": words})
        assert c["has_local_sub"] is False, words


@pytest.mark.parametrize("sub", [
    "Substitute frozen banana leaves from the Asian market downtown",
    "banana leaf -> foil packet",
    {"original": "banana leaf", "substitute": "parchment and foil"},
    {"ingredient": "yautia", "store": "La Tiendita on Ingersoll Ave"},
])
def test_p2_1_real_substitution_records_pass(plugin, sub):
    c = plugin.cite_check({**_receipt(share={"doi": GOOD_DOI}), "substitutions": [sub]})
    assert c["ok"] is True, sub


def test_p2_1_producer_happy_path_still_passes(plugin):
    assert plugin.cite_check({"result": producer_result()})["ok"] is True
    researched_only = producer_result(doi=None, researched=[
        "Leaf-wrapped steaming retains volatile aroma compounds (search snippet)",
        "Sourcing guide: banana leaves, green bananas, yautia near Des Moines Iowa"])
    assert plugin.cite_check({"result": researched_only})["ok"] is True


# ---- 3. a saved dish keeps its full reconstruction past the rolling cache -------------------

def test_p2_3_saved_reconstruction_survives_prune(plugin):
    plugin.set_mode(stdout=producer_result(answer="A: steam masa in banana leaf. " * 40))
    a = plugin.reconstruct("grandma's pasteles", session_id="s1")
    saved = plugin.save_for_session("Pasteles", reconstruction_id=a["reconstruction_id"], session_id="s1")
    assert saved["ok"] is True
    plugin.set_mode(stdout=producer_result(answer="other"))
    for i in range(plugin.MAX_RECONSTRUCTIONS + 5):
        plugin.reconstruct(f"memory {i}", session_id="s1")
    rid = plugin.list_dishes()["dishes"][0]["reconstruction_id"]
    assert rid == a["reconstruction_id"]
    ans = plugin.get_reconstruction_view(rid, section="answer", session_id="s1")
    assert ans["ok"] is True and ans["chunk"].startswith("A: steam masa")
    assert ans["total_chars"] == len(a["result"]["answer"])
    rec = plugin.get_reconstruction_view(rid, section="receipt", session_id="s1")
    assert rec["ok"] is True and json.loads(rec["chunk"]) == a["result"]["receipt"]
    # The rolling cache still bounds UNSAVED results.
    files = list((plugin.data / "reconstructions").glob("*.json"))
    assert len(files) == plugin.MAX_RECONSTRUCTIONS + 1


def test_p2_3_save_restores_result_pruned_between_load_and_save(plugin):
    """save_for_session loads outside the lock; a concurrent prune may delete the file before the save
    commits. The saved dish must still resolve to the complete result."""
    plugin.set_mode(stdout=producer_result(answer="A answer"))
    a = plugin.reconstruct("grandma's pasteles", session_id="s1")
    env = plugin.load_reconstruction(a["reconstruction_id"], "s1")
    (plugin.data / "reconstructions" / f"{a['reconstruction_id']}.json").unlink()
    plugin.save_dish("Pasteles", memory="m", envelope=env)
    ans = plugin.get_reconstruction_view(a["reconstruction_id"], section="answer", session_id="s1")
    assert ans["ok"] is True and ans["chunk"] == "A answer"


def test_p2_3_dish_dropped_from_list_unpins_its_result(plugin):
    plugin.set_mode(stdout=producer_result(answer="A answer"))
    a = plugin.reconstruct("m", session_id="s1")
    plugin.save_for_session("A", reconstruction_id=a["reconstruction_id"], session_id="s1")
    dishes = json.loads((plugin.data / "saved_dishes.json").read_text())
    (plugin.data / "saved_dishes.json").write_text(json.dumps([d for d in dishes if d["title"] != "A"]))
    for i in range(plugin.MAX_RECONSTRUCTIONS + 1):
        plugin.reconstruct(f"memory {i}", session_id="s1")
    assert plugin.load_reconstruction(a["reconstruction_id"], "s1") is None
