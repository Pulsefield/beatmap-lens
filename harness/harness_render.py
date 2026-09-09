"""Optional PNG inspection views; glyphs express source events, never pattern labels."""
from bisect import bisect_right
from collections import defaultdict
from io import BytesIO
from math import ceil

from PIL import Image, ImageDraw, ImageFont

from harness_playback import timing_context
from playback_rate import normalize_playback_rate


WIDTH, HEIGHT = 1100, 900
TOP, BOTTOM = 150, 804
LEFT, RIGHT = 140, 830
TIME_PAGE_MS = 2500
ROW_PAGE_INTERVALS = 28


def _layout(chart, start_ms, end_ms, view, page, playback_rate=1):
    if view not in ("time", "rows"):
        raise ValueError("view must be 'time' or 'rows'")
    if start_ms >= end_ms:
        raise ValueError("start_ms must be less than end_ms")
    rate = normalize_playback_rate(playback_rate)
    page_source_ms = TIME_PAGE_MS * rate
    notes = chart["notes"]
    events = sorted({start_ms, end_ms} | {
        time for note in notes
        for time in ([note["startMs"], note["endMs"]]
                     if note["kind"] == "long" else [note["startMs"]])
        if start_ms < time < end_ms
    })
    page_count = (ceil((end_ms - start_ms) / page_source_ms) if view == "time"
                  else ceil((len(events) - 1) / ROW_PAGE_INTERVALS))
    if not 0 <= page < page_count:
        raise ValueError(f"page must be between 0 and {page_count - 1}")
    if view == "time":
        start = start_ms + page * page_source_ms
        end = min(end_ms, start + page_source_ms)
        anchors = [start, end]
    else:
        anchors = events[page * ROW_PAGE_INTERVALS:(page + 1) * ROW_PAGE_INTERVALS + 1]
        start, end = anchors[0], anchors[-1]

    def y(time):
        index = min(len(anchors) - 2, max(0, bisect_right(anchors, time) - 1))
        fraction = (time - anchors[index]) / (anchors[index + 1] - anchors[index])
        return TOP + (index + fraction) / (len(anchors) - 1) * (BOTTOM - TOP)

    visible = [note for note in notes
               if (note["startMs"] < end and note["endMs"] >= start
                   if note["kind"] == "long" else start <= note["startMs"] < end)]
    return {"start": start, "end": end, "pageCount": page_count,
            "anchors": anchors, "notes": visible, "y": y}


def render_section(chart, start_ms, end_ms, view="time", page=0, playback_rate=1):
    """Render one bounded page. ``rows`` aligns attack AND release events.

    The requested range and attack inclusion are half-open. A release exactly at
    a page boundary remains visible as an endpoint, including at the top edge.
    Time progresses downward; source columns are always zero-based.
    """
    rate = normalize_playback_rate(playback_rate)
    layout = _layout(chart, start_ms, end_ms, view, page, rate)
    start, end, y = layout["start"], layout["end"], layout["y"]
    source = chart["source"]
    keys = source["keyCount"]
    lane_width = (RIGHT - LEFT) / keys
    canvas = Image.new("RGB", (WIDTH, HEIGHT), "#111820")
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default(size=16)
    small = ImageFont.load_default(size=13)
    large = ImageFont.load_default(size=23)
    text = "#e4edf3"
    muted = "#a5b4c0"
    tap, hold, endpoint, continuation = "#f2c14e", "#4ecdc4", "#f8fbff", "#f49d56"
    mode = "TIME PROPORTIONAL" if view == "time" else "EVENT ROWS - TIMING DISTORTED"
    draw.text((28, 22), f"{mode}  |  {rate:g}x", font=large, fill=text)
    draw.text((28, 57), f"{source['sha256'][:16]}  |  {keys}K  |  page {page + 1}/{layout['pageCount']}",
              font=font, fill=muted)
    draw.text((28, 84), f"Source page [{start:g}, {end:g}) ms  |  requested [{start_ms:g}, {end_ms:g}) ms  |  time moves down",
              font=font, fill=text)
    draw.text((12, 116), "Elapsed ms" if rate != 1 else "Source ms", font=small, fill=muted)
    draw.text((LEFT, 110), "Source columns (zero-based)", font=small, fill=muted)
    draw.text((RIGHT + 16, 120), "Source lines: attack / release", font=small, fill=muted)
    for column in range(keys):
        left = LEFT + column * lane_width
        draw.rectangle((left, TOP, left + lane_width, BOTTOM),
                       fill="#1e2b37" if column % 2 else "#18232e", outline="#344657")
        draw.text((left + lane_width / 2, TOP - 12), str(column), font=small,
                  fill=text, anchor="mb")

    if view == "rows":
        ticks = layout["anchors"]
    else:
        desired_step = (end - start) / 8
        step = next(value for value in (1, 2, 5, 10, 20, 50, 100, 200, 500, 1000)
                    if value >= desired_step)
        ticks = [start] + [time for time in range(ceil(start / step) * step, ceil(end / step) * step, step)
                           if start < time < end] + [end]
        # Boundary labels take priority when a regular tick is almost coincident.
        ticks = [time for time in ticks if time in (start, end)
                 or min(y(time) - TOP, BOTTOM - y(time)) >= 16]
    for time in ticks:
        position = y(time)
        draw.line((LEFT, position, RIGHT, position), fill="#3b4b59", width=1)
        label_time = (time - start_ms) / rate if rate != 1 else time
        draw.text((LEFT - 12, position), f"{label_time:g}", font=small, fill=muted, anchor="rm")

    line_labels = defaultdict(lambda: {"attack": [], "release": []})
    entering = continuing = attacks = releases = 0
    # Bodies first so later LN heads and releases cannot disappear under a body.
    for note in layout["notes"]:
        if note["kind"] != "long" or note["endMs"] == start:
            continue
        left = LEFT + note["column"] * lane_width
        middle = left + lane_width / 2
        draw.rectangle((middle - lane_width * .21, y(max(start, note["startMs"])),
                        middle + lane_width * .21, y(min(end, note["endMs"]))), fill="#285b5c")
    for note in layout["notes"]:
        left = LEFT + note["column"] * lane_width + 5
        right = left + lane_width - 10
        middle = (left + right) / 2
        is_long = note["kind"] == "long"
        if start <= note["startMs"] < end:
            position = y(note["startMs"])
            draw.rectangle((left, max(TOP, position - 3), right, min(BOTTOM, position + 3)),
                           fill=hold if is_long else tap)
            line_labels[note["startMs"]]["attack"].append(note["sourceLine"])
            attacks += 1
        if not is_long:
            continue
        if note["startMs"] < start < note["endMs"]:
            draw.line([(middle - 10, TOP + 8), (middle, TOP), (middle + 10, TOP + 8)],
                      fill=continuation, width=3)
            entering += 1
        if start <= note["endMs"] <= end:
            position = y(note["endMs"])
            draw.line((left + 8, position, right - 8, position), fill=endpoint, width=2)
            draw.ellipse((middle - 4, position - 4, middle + 4, position + 4),
                         fill="#111820", outline=endpoint, width=2)
            line_labels[note["endMs"]]["release"].append(note["sourceLine"])
            releases += 1
        if note["endMs"] > end:
            draw.line([(middle - 10, BOTTOM - 8), (middle, BOTTOM), (middle + 10, BOTTOM - 8)],
                      fill=continuation, width=3)
            continuing += 1

    hidden_labels = 0
    previous_label_y = TOP - 16
    for time, refs in sorted(line_labels.items()):
        position = y(time)
        if position - previous_label_y < 15:
            hidden_labels += 1
            continue
        attack_refs = ",".join(str(line) for line in sorted(refs["attack"])) or "-"
        release_refs = ",".join(str(line) for line in sorted(refs["release"])) or "-"
        label = f"{attack_refs} / {release_refs}"
        while draw.textlength(label, font=small) > WIDTH - RIGHT - 32:
            label = label[:-4] + "..."
        draw.text((RIGHT + 16, position), label, font=small, fill=muted, anchor="lm")
        previous_label_y = position

    warnings = []
    if view == "rows":
        warnings.append("Rows align attacks and releases equally; vertical distance is not elapsed time. Read millisecond labels or use time view for rhythm.")
    if hidden_labels:
        warnings.append(f"{hidden_labels} dense source-line labels omitted from the image; narrow the range or use rows view to separate events.")
    draw.text((28, 835), "Gold: tap  |  teal: LN head/body  |  white ring: true release  |  orange chevron: clipped continuation",
              font=small, fill=text)
    footer = ("Attack and release rows have equal spacing. Compare millisecond labels to judge rhythm."
              if view == "rows" else "Vertical distance preserves performance time; each full page spans 2500 elapsed ms.")
    if rate != 1:
        footer += f" Elapsed zero = source {start_ms:g} ms."
    draw.text((28, 861), footer, font=small, fill=muted)
    buffer = BytesIO()
    canvas.save(buffer, format="PNG", optimize=True)
    result = {"png": buffer.getvalue(), "view": view, "page": page, "pageCount": layout["pageCount"],
            "source": source["sha256"], "range": {"startMs": start, "endMs": end},
            "requestedRange": {"startMs": start_ms, "endMs": end_ms}, "columnBase": 0,
            "width": WIDTH, "height": HEIGHT,
            "events": {"attacks": attacks, "visibleReleasesIncludingBoundaries": releases,
                       "enteringHolds": entering, "continuingHolds": continuing},
            "warnings": warnings}
    if rate != 1:
        result.update(playbackRate=rate, performanceTiming=timing_context(start_ms, end_ms, rate) | {
            'pageElapsedRangeMs': {'startMs': (start - start_ms) / rate, 'endMs': (end - start_ms) / rate},
            'axis': 'elapsed performance ms from requested source start',
            'fullPageDurationMs': TIME_PAGE_MS if view == 'time' else None,
        })
    return result
