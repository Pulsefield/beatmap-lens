"""Selection measurements at real annotation boundaries, with no semantic labels."""
import importlib.util
import json
from pathlib import Path
import unittest


SCRIPT = Path(__file__).resolve().parent.parent.joinpath("section-features.py")
spec = importlib.util.spec_from_file_location("section_features", SCRIPT)
features = importlib.util.module_from_spec(spec)
spec.loader.exec_module(features)


def note(start, column, end=None):
    return {"source_line": 1, "column": column, "kind": "tap" if end is None else "long",
            "start_ms": start, "end_ms": start if end is None else end}


class SectionFeaturesTest(unittest.TestCase):
    def test_half_open_scope_and_sliding_half_second(self):
        notes = [note(-1, 0), note(0, 0), note(499, 1), note(500, 2),
                 note(501, 0), note(999, 1), note(1000, 3)]
        result = features.section_features(list(reversed(notes)), 0, 1000)
        self.assertEqual(result["attackCount"], 5)
        self.assertEqual(result["attackRowCount"], 5)
        self.assertEqual(result["nps"], 5)
        self.assertEqual(result["peakHalfSecondAttacks"], 3)
        self.assertEqual(result["sameColumnMinGapMs"], 500)
        self.assertEqual(result["sameColumnMaxHz"], 2)
        shifted = [{**n, "start_ms": n["start_ms"] + 317,
                    "end_ms": n["end_ms"] + 317} for n in notes]
        self.assertEqual(result, features.section_features(shifted, 317, 1317))

    def test_rate_changes_timing_without_changing_recurrence(self):
        slow = [note(t, 0) for t in (0, 200, 400, 600)]
        fast = [note(t, 0) for t in (0, 100, 200, 300)]
        a = features.section_features(slow, 0, 800)
        b = features.section_features(fast, 0, 400)
        self.assertEqual(a["adjacentSharedColumnShare"], 1)
        self.assertEqual(a["repeatedRowShare"], 1)
        self.assertEqual(b["repeatedRowShare"], a["repeatedRowShare"])
        self.assertEqual(b["nps"], 2 * a["nps"])
        self.assertEqual(b["sameColumnMaxHz"], 2 * a["sameColumnMaxHz"])
        self.assertEqual(a["handImbalance"], 1)

    def test_reviewed_crossed_pairs_keep_complete_row_alternation(self):
        fixture = json.loads((SCRIPT.resolve().parents[2] / "scripts/fixtures").joinpath("pattern-queries-reviewed.json").read_text())
        case = next(c for c in fixture["cases"] if c["id"] == "memoria-crossed-pairs")
        result = features.section_features(case["notes"], 259802, 260660)
        self.assertEqual(result["attackRowCount"], 9)
        self.assertEqual(result["doubleRowShare"], 1)
        self.assertEqual(result["chordRowShare"], 1)
        self.assertEqual(result["adjacentSharedColumnShare"], 0)
        self.assertEqual(result["repeatedRowShare"], 0)
        self.assertEqual(result["disjointAlternationShare"], 1)
        self.assertEqual(result["handImbalance"], 0)
        self.assertEqual(result["gapVariation"], 0)
        self.assertEqual(result["gapEntropyBits"], 0)

    def test_rounding_does_not_create_rhythm_variation(self):
        rounded = features.section_features([note(t, i % 4) for i, t in enumerate((0, 39, 79, 118, 158))], 0, 200)
        varied = features.section_features([note(t, i % 4) for i, t in enumerate((0, 40, 120, 160, 240))], 0, 300)
        self.assertEqual(rounded["gapVariation"], 0)
        self.assertEqual(rounded["gapEntropyBits"], 0)
        self.assertAlmostEqual(varied["gapVariation"], 1 / 3)
        self.assertEqual(varied["gapEntropyBits"], 1)

    def test_entering_holds_and_strictly_continuing_event_relations(self):
        notes = [note(-100, 0, 1000), note(-50, 1, 0), note(0, 1, 500),
                 note(250, 2), note(500, 3, 750), note(1000, 2)]
        result = features.section_features(notes, 0, 1000)
        self.assertEqual(result["attackCount"], 3)
        self.assertEqual(result["lnStartShare"], 2 / 3)
        self.assertEqual(result["lnOccupiedColumnShare"], 1750 / 4000)
        self.assertEqual(result["lnReleaseCount"], 3)  # Includes the release at scope start.
        self.assertEqual(result["releaseUnderHoldShare"], 1)
        self.assertEqual(result["attackUnderHoldShare"], 1)

    def test_equal_time_releases_and_starts_are_not_continuing_holds(self):
        notes = [note(0, 0, 500), note(0, 1, 500), note(500, 2, 1000), note(500, 3)]
        result = features.section_features(notes, 0, 1000)
        self.assertEqual(result["lnReleaseCount"], 2)
        self.assertEqual(result["releaseUnderHoldShare"], 0)
        self.assertEqual(result["attackUnderHoldShare"], 0)
        self.assertEqual(result["lnOccupiedColumnShare"], 1500 / 4000)
        self.assertEqual(result["peakHalfSecondAttacks"], 2)

    def test_section_with_only_entering_hold_has_occupancy_without_attacks(self):
        result = features.section_features([note(0, 0, 3000)], 1000, 2000)
        self.assertEqual(result["attackCount"], 0)
        self.assertEqual(result["nps"], 0)
        self.assertEqual(result["sameColumnMaxHz"], 0)
        self.assertEqual(result["gapVariation"], 0)
        self.assertEqual(result["lnOccupiedColumnShare"], 0.25)
        self.assertEqual(result["lnReleaseCount"], 0)


if __name__ == "__main__":
    unittest.main()
