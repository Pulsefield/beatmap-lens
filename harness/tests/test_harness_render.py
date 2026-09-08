"""Source-to-image inspection semantics, without pixel snapshots or external data."""
from io import BytesIO
import unittest

from PIL import Image

import harness_render as renderer


def note(line, time, column, end=None):
    return {"sourceLine": line, "column": column, "kind": "normal" if end is None else "long",
            "startMs": time, "endMs": time if end is None else end}


def chart(notes, keys=4):
    return {"source": {"sha256": "c" * 64, "keyCount": keys, "title": "Inspection fixture"},
            "range": {"startMs": 0, "endMs": 10000}, "notes": notes, "timingPoints": []}


class HarnessRenderTest(unittest.TestCase):
    def test_time_view_preserves_time_and_rows_exposes_release_event(self):
        source = chart([note(1, 0, 0, 150), note(2, 100, 1), note(3, 400, 2)])
        time = renderer._layout(source, 0, 500, "time", 0)
        rows = renderer._layout(source, 0, 500, "rows", 0)
        self.assertAlmostEqual((time["y"](400) - time["y"](100)) /
                               (time["y"](100) - time["y"](0)), 3)
        self.assertEqual(rows["anchors"], [0, 100, 150, 400, 500])
        self.assertEqual(rows["y"](150) - rows["y"](100), rows["y"](400) - rows["y"](150))
        output = renderer.render_section(source, 0, 500, "rows")
        self.assertIn("not elapsed time", output["warnings"][0])

    def test_half_open_attacks_and_true_boundary_releases(self):
        source = chart([note(1, -100, 0, 1000), note(2, -50, 1, 0),
                        note(3, 0, 2, 500), note(4, 250, 3), note(5, 500, 1)])
        output = renderer.render_section(source, 0, 500)
        self.assertEqual(output["events"], {"attacks": 2, "visibleReleasesIncludingBoundaries": 2,
                                           "enteringHolds": 1, "continuingHolds": 1})
        self.assertEqual(output["range"], {"startMs": 0, "endMs": 500})
        self.assertEqual(output["columnBase"], 0)

    def test_time_pagination_preserves_attacks_and_entering_hold(self):
        source = chart([note(1, 0, 0, 5100), note(2, 2499, 1), note(3, 2500, 2),
                        note(4, 4999, 3), note(5, 5000, 1), note(6, 5100, 2)])
        pages = [renderer.render_section(source, 0, 5100, page=page) for page in range(3)]
        self.assertEqual([page["range"] for page in pages], [
            {"startMs": 0, "endMs": 2500}, {"startMs": 2500, "endMs": 5000},
            {"startMs": 5000, "endMs": 5100}])
        self.assertEqual(sum(page["events"]["attacks"] for page in pages), 5)
        self.assertEqual([page["events"]["enteringHolds"] for page in pages], [0, 1, 1])
        self.assertEqual([page["events"]["continuingHolds"] for page in pages], [1, 1, 0])
        self.assertTrue(all(page["pageCount"] == 3 for page in pages))

    def test_row_pagination_keeps_chords_together_and_counts_release_rows(self):
        source = chart([note(index * 2 + lane, index * 100, lane, index * 100 + 50)
                        for index in range(40) for lane in (0, 1)])
        first = renderer.render_section(source, 0, 4000, "rows")
        pages = [first] + [renderer.render_section(source, 0, 4000, "rows", page)
                           for page in range(1, first["pageCount"])]
        self.assertEqual(first["pageCount"], 3)
        self.assertEqual(sum(page["events"]["attacks"] for page in pages), 80)
        self.assertTrue(all(page["events"]["attacks"] % 2 == 0 for page in pages))
        self.assertEqual(pages[-1]["range"]["endMs"], 4000)

    def test_png_lane_mapping_and_bounded_size(self):
        # Check the semantic mapping of column zero to the left lane, not a snapshot.
        source = chart([note(24, 200, 0)])
        output = renderer.render_section(source, 0, 400)
        image = Image.open(BytesIO(output["png"]))
        self.assertEqual(image.format, "PNG")
        self.assertEqual(image.size, (1100, 900))
        y = round(renderer._layout(source, 0, 400, "time", 0)["y"](200))
        width = (renderer.RIGHT - renderer.LEFT) / 4
        self.assertEqual(image.getpixel((round(renderer.LEFT + width / 2), y)), (242, 193, 78))
        self.assertNotEqual(image.getpixel((round(renderer.RIGHT - width / 2), y)), (242, 193, 78))

    def test_hold_only_range_and_supported_key_counts(self):
        for keys in (4, 7, 10):
            output = renderer.render_section(chart([note(10, -100, keys - 1, 2000)], keys),
                                             0, 1000, "rows")
            self.assertEqual(output["pageCount"], 1)
            self.assertEqual(output["events"]["attacks"], 0)
            self.assertEqual(output["events"]["enteringHolds"], 1)
            self.assertEqual(output["events"]["continuingHolds"], 1)


if __name__ == "__main__":
    unittest.main()
