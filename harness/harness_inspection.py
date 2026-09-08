"""Compact, source-bound observation tools; none assigns pattern judgments.

All ranges are half-open source milliseconds and columns are zero-based. Notes
retain their full source endpoints. A perspective summarizes all events in the
range, but its bounded examples do not substitute for inspecting those events.
"""
from bisect import bisect_left, bisect_right
from collections import Counter, defaultdict


NOTE_SCHEMA = ["sourceLine", "column", "kind", "startMs", "endMs"]
MAX_PAGE = 64


def _ref(note):
    return [note[key] for key in NOTE_SCHEMA]


def _rows(chart, start_ms, end_ms):
    rows = defaultdict(list)
    for note in chart["notes"]:
        if start_ms <= note["startMs"] < end_ms:
            rows[note["startMs"]].append(note)
    return [(time, sorted(notes, key=lambda n: (n["column"], n["sourceLine"])))
            for time, notes in sorted(rows.items())]


def _holds(chart, time):
    return sorted((n for n in chart["notes"]
                   if n["kind"] == "long" and n["startMs"] < time < n["endMs"]),
                  key=lambda n: (n["column"], n["sourceLine"]))


def _actions(chart, start_ms, end_ms):
    attacks = dict(_rows(chart, start_ms, end_ms))
    releases = defaultdict(list)
    active = {n["sourceLine"]: n for n in _holds(chart, start_ms)}
    for note in chart["notes"]:
        if note["kind"] == "long" and start_ms <= note["endMs"] < end_ms:
            releases[note["endMs"]].append(note)
    result = []
    for time in sorted(attacks.keys() | releases.keys()):
        ending = sorted(releases[time], key=lambda n: (n["column"], n["sourceLine"]))
        for note in ending:
            active.pop(note["sourceLine"], None)
        continuing = sorted(active.values(), key=lambda n: (n["column"], n["sourceLine"]))
        heads = attacks.get(time, [])
        result.append((time, heads, ending, continuing))
        for note in heads:
            if note["kind"] == "long":
                active[note["sourceLine"]] = note
    return result


def inspect(chart, start_ms, end_ms, view="rows", offset=0, limit=32):
    """Page exact attack rows, LN articulation, or simultaneous actions.

    Entering holds are complete, even if their head is outside the requested
    scope. A hold ending exactly at t is a release, never a continuing hold.
    """
    if offset < 0:
        raise ValueError("offset must be nonnegative; start at 0, then follow nextOffset")
    limit = max(1, min(MAX_PAGE, limit))
    if view in ("rows", "articulation"):
        events = _rows(chart, start_ms, end_ms)
        schema = ["timeMs", "presses"]
    elif view == "actions":
        events = _actions(chart, start_ms, end_ms)
        schema = ["timeMs", "presses", "releases", "continuingHolds"]
    else:
        raise ValueError("view must be rows, actions, or articulation")
    selected = events[offset:offset + limit]
    entering = _holds(chart, start_ms)
    result = {
        "sourceSha256": chart["source"]["sha256"],
        "scope": {"startMs": start_ms, "endMs": end_ms},
        "view": view,
        "conventions": "Half-open source ms; zero-based columns; full note endpoints. Continuing means start < time < end.",
        "noteSchema": NOTE_SCHEMA,
        "rowSchema": schema,
        "enteringHolds": [_ref(n) for n in entering],
        "rows": [[event[0], *[[_ref(n) for n in group] for group in event[1:]]]
                 for event in selected],
        "pagination": {
            "offset": offset, "limit": limit, "total": len(events), "returned": len(selected),
            "nextOffset": offset + len(selected) if offset + len(selected) < len(events) else None,
        },
        "coverage": {
            "domain": "attack and release events" if view == "actions" else "attack rows",
            "allEventsReturned": offset == 0 and len(selected) == len(events),
            "eventsNotInThisPage": len(events) - len(selected),
            "enteringHoldsComplete": True,
        },
    }
    page_entering = _holds(chart, selected[0][0]) if offset and selected else None
    if page_entering is not None:
        result["pageEnteringHolds"] = [_ref(n) for n in page_entering]
    if view == "articulation":
        result.update(_articulation(chart, selected, entering, page_entering))
    return result


def _timing(chart):
    points = []
    for point in chart["timingPoints"]:
        fields = point["fields"]
        time, beat_length = float(fields[0]), float(fields[1])
        inherited = len(fields) > 6 and str(fields[6]) == "0"
        if beat_length > 0 and not inherited:
            points.append({"timeMs": time, "sourceLine": point["sourceLine"], "kind": "tempo",
                           "beatLengthMs": beat_length, "bpm": round(60000 / beat_length, 3),
                           "meter": int(fields[2]) if len(fields) > 2 else 4})
        elif beat_length < 0:
            points.append({"timeMs": time, "sourceLine": point["sourceLine"], "kind": "sv",
                           "rawSvMultiplier": round(-100 / beat_length, 6)})
    return sorted(points, key=lambda point: (point["timeMs"], point["sourceLine"]))


def _active_tempo(points, time):
    return next((p for p in reversed(points) if p["kind"] == "tempo" and p["timeMs"] <= time), None)


def _beats(points, start, end):
    active = _active_tempo(points, start)
    if active is None:
        return None
    total = 0
    cursor = start
    for point in points:
        if point["kind"] == "tempo" and start < point["timeMs"] < end:
            total += (point["timeMs"] - cursor) / active["beatLengthMs"]
            cursor, active = point["timeMs"], point
    return round(total + (end - cursor) / active["beatLengthMs"], 6)


def _articulation(chart, rows, entering, page_entering):
    """Describe full-source LN head/tail relationships without a duration cutoff."""
    attacks = dict(_rows(chart, chart["range"]["startMs"], chart["range"]["endMs"]))
    times = list(attacks)
    points = _timing(chart)
    holds = [note for note in chart["notes"] if note["kind"] == "long"]

    def next_gap(time):
        index = bisect_right(times, time)
        return times[index] - time if index < len(times) else None

    def ln_facts(note):
        start, end = note["startMs"], note["endMs"]
        release_index = bisect_left(times, end)
        release_position = ("at-attack" if end in attacks else
                            "between-attacks" if release_index < len(times) else "after-last-attack")
        continuing = sorted({other["column"] for other in holds
                             if other["column"] != note["column"] and other["startMs"] < end < other["endMs"]})
        return [note["sourceLine"], end - start, _beats(points, start, end),
                release_index - bisect_right(times, start), release_position,
                [other["column"] for other in attacks.get(end, [])], continuing]

    result = {
        "rowSchema": ["timeMs", "presses", "nextAttackGapMs", "lnArticulation"],
        "lnArticulationSchema": ["sourceLine", "durationMs", "durationBeats", "interiorAttackRows",
                                 "releasePosition", "releaseAttackColumns", "otherHoldColumnsAtRelease"],
        "rows": [[time, [_ref(note) for note in notes], next_gap(time),
                  [ln_facts(note) for note in notes if note["kind"] == "long"]] for time, notes in rows],
        "enteringHoldArticulation": [ln_facts(note) for note in entering],
        "articulationMeaning": (
            "LN facts use full source spans, including beyond the requested scope/page. sourceLine links to a full note ref. "
            "durationBeats integrates tempo changes; SV does not change beats. nextAttackGapMs uses the next source attack row, "
            "or null at the last attack. interiorAttackRows counts distinct times strictly between head and tail. "
            "Other holds continue strictly across release. These timing relationships assign no style or playable role."),
    }
    if page_entering is not None:
        result["pageEnteringHoldArticulation"] = [ln_facts(note) for note in page_entering]
    return result


def _row_example(row):
    return {"timeMs": row[0], "columns": [n["column"] for n in row[1]],
            "sourceLines": [n["sourceLine"] for n in row[1]]}


def _overview(chart, start_ms, end_ms):
    notes = [n for n in chart["notes"] if start_ms <= n["startMs"] < end_ms]
    return {"range": [start_ms, end_ms], "heads": len(notes),
            "attackRows": len({n["startMs"] for n in notes}),
            "holdHeads": sum(n["kind"] == "long" for n in notes)}


def chart_context(chart, start_ms, end_ms, timing_offset=0, timing_limit=12):
    """Return metadata, timing and neighboring arrangement, without loading labels."""
    if timing_offset < 0:
        raise ValueError("timing_offset must be nonnegative; start at 0, then follow nextOffset")
    timing_limit = max(1, min(32, timing_limit))
    points = _timing(chart)
    tempo = _active_tempo(points, start_ms)
    changes = [p for p in points if start_ms <= p["timeMs"] < end_ms]
    page = changes[timing_offset:timing_offset + timing_limit]
    prior = next((p for p in reversed(points) if p["timeMs"] <= start_ms), None)
    rows = _rows(chart, chart["range"]["startMs"], chart["range"]["endMs"])
    before = next((r for r in reversed(rows) if r[0] < start_ms), None)
    after = next((r for r in rows if r[0] >= end_ms), None)
    chart_start, chart_end = chart["range"]["startMs"], chart["range"]["endMs"]
    width = (chart_end - chart_start) / 8
    overview = [_overview(chart, round(chart_start + i * width), round(chart_start + (i + 1) * width))
                for i in range(8)]
    return {
        "source": chart["source"], "chartRange": chart["range"],
        "scope": {"startMs": start_ms, "endMs": end_ms},
        "activeTempoAtStart": tempo,
        "activeSvAtStart": {"rawMultiplier": prior.get("rawSvMultiplier", 1), "sourceLine": prior["sourceLine"]}
        if prior else None,
        "timingChanges": {
            "total": len(changes), "points": page, "omitted": len(changes) - len(page),
            "offset": timing_offset, "limit": timing_limit, "returned": len(page),
            "nextOffset": timing_offset + len(page) if timing_offset + len(page) < len(changes) else None,
            "allChangesReturned": timing_offset == 0 and len(page) == len(changes),
        },
        "timingMeaning": "Tempo points establish beat length/meter; inherited SV points change scroll velocity, not beat duration. A tempo point resets SV to 1.",
        "chartSummary": _overview(chart, chart_start, chart_end),
        "overview": overview,
        "neighbors": {"previousAttackRow": _row_example(before) if before else None,
                      "nextAttackRow": _row_example(after) if after else None},
        "contextSuggestion": {"startMs": max(chart_start, start_ms - 2000),
                              "endMs": min(chart_end, end_ms + 2000)},
    }


def _recurrences(rows):
    groups = [tuple(n["column"] for n in notes) for _, notes in rows]
    found = []

    def add(kind, first, end, columns):
        found.append({"kind": kind, "attackRows": end - first,
                      "range": [rows[first][0], rows[end - 1][0] + 1], "columns": columns,
                      "firstRow": _row_example(rows[first]), "lastRow": _row_example(rows[end - 1])})

    i = 0
    while i < len(rows):
        end = i + 1
        while end < len(rows) and groups[end] == groups[i]:
            end += 1
        if end - i >= 2:
            add("identical complete press group", i, end, list(groups[i]))
        i = end
    i = 0
    while i + 3 < len(rows):
        if groups[i] != groups[i + 1] and not set(groups[i]) & set(groups[i + 1]):
            end = i + 2
            while end < len(rows) and groups[end] == groups[i + (end - i) % 2]:
                end += 1
            if end - i >= 4:
                add("disjoint complete-group alternation", i, end, [list(groups[i]), list(groups[i + 1])])
                i = end - 1
                continue
        i += 1
    for column in sorted({c for group in groups for c in group}):
        i = 0
        while i < len(rows):
            if column not in groups[i]:
                i += 1
                continue
            end = i + 1
            while end < len(rows) and column in groups[end]:
                end += 1
            if end - i >= 3 and len(set(groups[i:end])) > 1:
                add("persistent column with changing surrounding presses", i, end, [column])
            i = end
    examples = []
    for kind in dict.fromkeys(item["kind"] for item in found):
        examples.extend(sorted((item for item in found if item["kind"] == kind),
                               key=lambda item: -item["attackRows"])[:1])
    return {"count": len(found), "examples": examples,
            "examplePolicy": "Longest run per listed recurrence kind; boundary rows cited, interior rows omitted. No rows are skipped inside a run."}


def perspective(chart, start_ms, end_ms):
    """A bounded player-action lens: recurrence, pulse and simultaneous duties.

    Definitions are observational, not thresholds for a style or salience.
    Counts cover the whole scope. Examples are bounded and explicitly partial.
    """
    rows = _rows(chart, start_ms, end_ms)
    actions = _actions(chart, start_ms, end_ms)
    points = _timing(chart)
    heads = [n for _, notes in rows for n in notes]
    groups = [set(n["column"] for n in notes) for _, notes in rows]
    gaps = [b[0] - a[0] for a, b in zip(rows, rows[1:])]
    changes = sorted((i for i in range(1, len(gaps)) if abs(gaps[i] - gaps[i - 1]) > 1),
                     key=lambda i: -max(gaps[i] / gaps[i - 1], gaps[i - 1] / gaps[i]))
    pulse_examples = [{"rows": [_row_example(row) for row in rows[i - 1:i + 2]],
                       "gapsMs": gaps[i - 1:i + 1],
                       "beatDistances": [_beats(points, a[0], b[0])
                                         for a, b in zip(rows[i - 1:i + 1], rows[i:i + 2])]}
                      for i in changes[:2]]
    event_counts = {
        "pressEvents": len(rows), "releaseEvents": sum(bool(e[2]) for e in actions),
        "releaseOnlyEvents": sum(bool(e[2]) and not e[1] for e in actions),
        "simultaneousPressReleaseEvents": sum(bool(e[1]) and bool(e[2]) for e in actions),
        "pressWhileOtherHoldsContinueEvents": sum(bool(e[1]) and bool(e[3]) for e in actions),
        "releaseWhileOtherHoldsContinueEvents": sum(bool(e[2]) and bool(e[3]) for e in actions),
    }
    # One example for each relationship. Source lines can be expanded with inspect.
    action_examples = []
    predicates = (
        ("simultaneous press and release", lambda e: e[1] and e[2]),
        ("press while other holds continue", lambda e: e[1] and e[3]),
        ("release while other holds continue", lambda e: e[2] and e[3]),
    )
    for relationship, predicate in predicates:
        event = next((e for e in actions if predicate(e)), None)
        if event:
            action_examples.append({"relationship": relationship, "timeMs": event[0],
                                    **{key: [[n["sourceLine"], n["column"]] for n in notes]
                                       for key, notes in zip(("presses", "releases", "continuingHolds"), event[1:])}})
    return {
        "sourceSha256": chart["source"]["sha256"], "scope": {"startMs": start_ms, "endMs": end_ms},
        "perspective": "player-action relationships v1",
        "definition": "Read each timestamp as presses, releases, and holds continuing strictly across it. Compare how those duties repeat or change, alongside the attack pulse; these facts assign no style or strength.",
        "coverage": "Counts use every attack/release in the half-open scope and full-source entering holds. Examples are selected summaries, not complete inspection.",
        "pressOrganization": {
            "heads": len(heads), "holdHeads": sum(n["kind"] == "long" for n in heads),
            "rowArities": sorted(Counter(map(len, groups)).items()),
            "adjacentPairs": len(gaps),
            "identicalPressGroups": sum(a == b for a, b in zip(groups, groups[1:])),
            "disjointPressGroups": sum(not a & b for a, b in zip(groups, groups[1:])),
            "sharedColumnsWithChangedGroup": sum(bool(a & b) and a != b for a, b in zip(groups, groups[1:])),
            "recurrences": _recurrences(rows),
        },
        "pulse": {
            "gapCount": len(gaps), "commonGapsMsAndCounts": Counter(gaps).most_common(4),
            "distinctExactGaps": len(set(gaps)), "successiveGapChangesOver1Ms": len(changes),
            "examples": pulse_examples,
            "examplePolicy": "Up to two largest adjacent gap ratios differing by more than 1 ms. Beat distances integrate tempo changes; SV does not change them. Rounding-sized gaps remain exact source facts.",
        },
        "pressHoldRelease": {
            **event_counts, "enteringHoldCount": len(_holds(chart, start_ms)),
            "examples": action_examples, "exampleRefSchema": ["sourceLine", "column"],
            "examplePolicy": "First occurrence per listed relationship. Release at the same time as a press is separate from a hold continuing across that press.",
        },
        "compareQuestions": [
            "What familiar organization accounts for most of the section? Follow complete press groups and persistent columns before treating changed chord sizes as a new style.",
            "How do ordered presses, releases and accents shape each cell and its continuation? A repeated cell may itself carry expression; interruption and repetition alone decide no style. Inspect neighboring rows if needed.",
            "Which retrieved human supporting and prominent examples have the same relationships, and where does this section differ in typicality or how much of the episode they govern?",
        ],
    }
