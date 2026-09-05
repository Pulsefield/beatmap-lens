"""Factual query regressions from exact reviewed chart excerpts (requires PyArrow)."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import pyarrow as pa
import pyarrow.parquet as pq


SCRIPT = Path(__file__).with_name("annotation-queries.py")
spec = importlib.util.spec_from_file_location("annotation_queries", SCRIPT)
queries = importlib.util.module_from_spec(spec)
spec.loader.exec_module(queries)
fixture = json.loads(SCRIPT.with_name("fixtures").joinpath("pattern-queries-reviewed.json").read_text())
CASES = {case["id"]: case for case in fixture["cases"]}


def matches(query, case_id, start=None, end=None, columns=()):
    case = CASES[case_id]
    return list(queries.query_chart(
        query, case["notes"],
        case["scope"]["startMs"] if start is None else start,
        case["scope"]["endMs"] if end is None else end,
        columns,
    ))


class StructuralQueriesTest(unittest.TestCase):
    def test_crossed_disjoint_pairs_preserve_complete_rows(self):
        result, = matches("alternation", "memoria-crossed-pairs")
        self.assertEqual(result["groups"], [[1, 3], [0, 2]])
        self.assertEqual(len(result["rows"]), 9)
        self.assertEqual(result["bounds"], {"startMs": 259802, "endMs": 260660})
        self.assertEqual(result["rowGapsMs"], [107, 107, 107, 107, 107, 108, 107, 107])
        self.assertEqual([n["sourceLine"] for row in result["rows"] for n in row], list(range(3073, 3091)))
        self.assertEqual(result["previousRow"][0]["startMs"], 259695)
        self.assertEqual(result["nextRow"][0]["startMs"], 260766)
        # Three rows do not establish the query's minimal ABAB relationship.
        self.assertEqual(matches("alternation", "memoria-crossed-pairs", end=260123), [])

    def test_rolls_keep_all_four_groups_without_rounding(self):
        result = matches("roll", "cyber-four-directional-groups")
        self.assertEqual(len(result), 4)
        self.assertEqual([r["literalEqualSpacing"] for r in result], [True, True, False, False])
        self.assertEqual([r["rowGapsMs"] for r in result], [[39, 39, 39], [39, 39, 39], [39, 39, 40], [39, 39, 40]])
        self.assertEqual([r["bounds"]["startMs"] for r in result], [81521, 81678, 81835, 81992])
        self.assertEqual([n["sourceLine"] for r in result for row in r["rows"] for n in row], list(range(1526, 1542)))
        self.assertTrue(all(r["direction"] == "descending" for r in result))
        self.assertEqual(matches("roll", "memoria-crossed-pairs"), [])

    def test_slow_repetition_is_a_structural_fact(self):
        result, = matches("fixed-group", "300-nuts-slow-repetition")
        self.assertEqual(result["columns"], [3])
        self.assertEqual(len(result["rows"]), 7)
        self.assertEqual(result["rowGapsMs"], [400] * 6)
        self.assertTrue(result["literalEqualSpacing"])
        self.assertEqual([row[0]["sourceLine"] for row in result["rows"]], list(range(71, 78)))

    def test_added_chord_members_end_complete_row_repetition(self):
        result = matches("fixed-group", "decorated-repeated-pair")
        self.assertEqual([len(r["rows"]) for r in result], [8, 2])
        self.assertEqual(result[0]["bounds"], {"startMs": 32197, "endMs": 33161})
        self.assertEqual([n["column"] for n in result[0]["nextRow"]], [0, 1, 3])
        # The continuing {0,1} subset across decorated chords is outside this query.
        self.assertEqual(result[1]["bounds"], {"startMs": 33435, "endMs": 33574})

    def test_repeated_subset_preserves_the_core_and_every_extra_note(self):
        result, = matches("repeated-subset", "decorated-repeated-pair", columns=(0, 1))
        self.assertEqual(len(result["rows"]), 13)
        self.assertEqual(result["bounds"], {"startMs": 32197, "endMs": 33849})
        self.assertEqual(result["selectionRule"], {
            "kind": "persistent-columns-consecutive-attack-rows",
            "columns": [0, 1], "allowsRowSkipping": False,
        })
        self.assertEqual(len(result["selectedNoteRefs"]), 26)
        self.assertEqual({n["column"] for n in result["selectedNoteRefs"]}, {0, 1})
        self.assertEqual([n["sourceLine"] for n in result["incidentalNoteRefs"]], [246, 253, 256, 257])
        self.assertEqual(
            sorted(n["sourceLine"] for row in result["rows"] for n in row),
            sorted(n["sourceLine"] for n in result["selectedNoteRefs"] + result["incidentalNoteRefs"]),
        )
        self.assertEqual(result["nextRow"][0]["startMs"], 34123)
        # Neither one group nor one column can skip the other group's rows.
        for core in ((1, 3), (0, 2), (1,)):
            self.assertEqual(matches("repeated-subset", "memoria-crossed-pairs", columns=core), [])

    def test_each_row_match_includes_holds_entering_that_candidate(self):
        case = CASES["memoria-repetition-under-entering-hold"]
        self.assertEqual(queries.entering_holds(case["notes"], case["scope"]["startMs"]), [])
        for query in ("fixed-group", "repeated-subset"):
            with self.subTest(query=query):
                results = matches(query, case["id"], columns=(1,))
                self.assertEqual(len(results), 1 if query == "fixed-group" else 2)
                result = results[0]
                self.assertEqual(result["bounds"], {"startMs": 135730, "endMs": 135946})
                for candidate in results:
                    self.assertEqual(candidate["enteringHolds"], [{
                        "sourceLine": 1505, "column": 2, "kind": "long",
                        "startMs": 135516, "endMs": 136802,
                    }])
                self.assertEqual([row[0]["sourceLine"] for row in result["rows"]], [1507, 1508])

    def test_one_ms_occupancy_and_equal_time_release_remain_distinct(self):
        events = {r["bounds"]["startMs"]: r for r in matches("ln-events", "aleph-one-ms-overlap")}
        overlap = events[50803]
        self.assertEqual(overlap["attacks"][0]["sourceLine"], 6683)
        self.assertEqual(overlap["continuingHolds"], [{
            "sourceLine": 6681, "column": 3, "kind": "long",
            "startMs": 50577, "endMs": 50804,
        }])
        release = events[50804]
        self.assertEqual(release["continuingHolds"], [])
        self.assertEqual(release["releases"], overlap["continuingHolds"])
        self.assertEqual(release["heldAfter"][0]["sourceLine"], 6684)
        terminal = events[51029]
        self.assertEqual(terminal["attacks"][0]["column"], 0)
        self.assertEqual(terminal["continuingHolds"], [])
        self.assertEqual(terminal["heldAfter"], [])
        self.assertNotIn(51141, events)  # Half-open requested scope.

    def test_entering_hold_and_simultaneous_releases_preserve_endpoints(self):
        case = CASES["aleph-one-ms-overlap"]
        entering, = queries.entering_holds(case["notes"], 50000)
        self.assertEqual((entering["source_line"], entering["start_ms"], entering["end_ms"]), (6675, 49893, 50122))
        self.assertEqual(queries.entering_holds(case["notes"], 50122), [])
        events = matches("ln-events", "300-nuts-shared-release", start=187000)
        self.assertEqual(len(events[0]["continuingHolds"]), 3)
        self.assertEqual(events[-1]["bounds"], {"startMs": 188038, "endMs": 188039})
        self.assertEqual(len(events[-1]["releases"]), 4)
        self.assertEqual(events[-1]["continuingHolds"], [])
        self.assertEqual(events[-1]["heldAfter"], [])

    def test_cli_reads_parquet_and_binds_exact_provenance(self):
        case = CASES["aleph-one-ms-overlap"]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            chart = root / "chart.parquet"
            skill = root / "SKILL.md"
            skill.write_text("Fixture skill provenance; no semantic decisions.\n")
            table = pa.Table.from_pylist(case["notes"]).replace_schema_metadata({
                b"beatmap_lens": json.dumps({"source": case["source"], "range": case["availableRange"]}).encode(),
            })
            pq.write_table(table, chart)
            output = subprocess.check_output([
                sys.executable, str(SCRIPT), "ln-events", str(chart),
                "--start-ms", "50000", "--end-ms", "51030", "--skill-file", str(skill),
            ], text=True)
            records = [json.loads(line) for line in output.splitlines()]
            header = records[0]
            self.assertEqual(header["source"]["sha256"], case["source"]["sha256"])
            self.assertEqual(header["query"], "ln-events")
            self.assertEqual(header["version"], 2)
            self.assertEqual(header["parquetSha256"], hashlib.sha256(chart.read_bytes()).hexdigest())
            self.assertEqual(header["querySha256"], hashlib.sha256(SCRIPT.read_bytes()).hexdigest())
            self.assertEqual(header["skillFiles"], [{"path": str(skill), "sha256": hashlib.sha256(skill.read_bytes()).hexdigest()}])
            self.assertEqual(header["enteringHolds"][0]["startMs"], 49893)
            self.assertEqual(records[-1], {"record": "complete", "matches": len(records) - 2})
            self.assertTrue(any(r.get("bounds", {}).get("startMs") == 50803 for r in records))
            for key in ('"tagId"', '"assessment"', '"salience"', '"agent-reviewed"'):
                self.assertNotIn(key, output)

    def test_subset_cli_records_the_selected_columns(self):
        case = CASES["decorated-repeated-pair"]
        with tempfile.TemporaryDirectory() as directory:
            chart = Path(directory) / "chart.parquet"
            table = pa.Table.from_pylist(case["notes"]).replace_schema_metadata({
                b"beatmap_lens": json.dumps({"source": case["source"], "range": case["availableRange"]}).encode(),
            })
            pq.write_table(table, chart)
            command = [sys.executable, str(SCRIPT), "repeated-subset", str(chart),
                       "--start-ms", "32197", "--end-ms", "34123", "--skill-file", str(SCRIPT)]
            missing = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(missing.returncode, 2)
            self.assertIn("--columns is required", missing.stderr)
            output = subprocess.check_output([*command, "--columns", "1,0"], text=True)
            header, result, complete = [json.loads(line) for line in output.splitlines()]
            self.assertEqual(header["columns"], [0, 1])
            self.assertEqual(result["selectionRule"]["columns"], [0, 1])
            self.assertEqual(len(result["selectedNoteRefs"]), 26)
            self.assertEqual(complete, {"record": "complete", "matches": 1})


if __name__ == "__main__":
    unittest.main()
