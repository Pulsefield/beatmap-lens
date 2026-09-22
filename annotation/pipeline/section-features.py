"""Deterministic structural measurements for selecting 4K annotation sections.

Input is the full chart's normalized note dictionaries (annotation-facts.py),
with zero-based columns and a positive half-open [start_ms, end_ms) scope.
Attacks and releases belong to the scope by their own timestamps; entering
holds still contribute occupancy and continuing-hold relationships.

MinaCalc's local half-second density, hand split, and same-column timing inspire
the measurements, not its implementation or ratings. The reference is
../ensomi-model/ref-proj/Mug-Diffusion/scripts/MinaCalc-1.0.tar.gz
(MinaCalc.h and Dependent/HD_Sequencers/GenericSequencing.h). These values are
neither style judgments nor difficulty or model-uncertainty scores.
"""
from bisect import bisect_left, bisect_right
from collections import Counter, defaultdict
from math import log2, sqrt


def rhythm_features(gaps):
    """Merge gap lengths differing by at most 1 ms before measuring variation.

    Integer-millisecond rounding can alternate, for example, 39 and 40 ms for
    one rhythm. Each cluster spans at most 1 ms, without transitive chaining.
    """
    counts = Counter(gaps)
    clusters = []
    for gap, count in sorted(counts.items()):
        if not clusters or gap - clusters[-1][0] > 1:
            clusters.append([gap, gap * count, count])
        else:
            clusters[-1][1] += gap * count
            clusters[-1][2] += count
    if not gaps:
        return 0.0, 0.0
    mean = sum(gaps) / len(gaps)
    variance = sum((total / count - mean) ** 2 * count
                   for _, total, count in clusters) / len(gaps)
    entropy = -sum((count / len(gaps)) * log2(count / len(gaps))
                   for _, _, count in clusters)
    return sqrt(variance) / mean, entropy


def section_features(notes, start_ms, end_ms):
    """Return a flat numeric dictionary; undefined sample shares/rates are zero.

    Chord/arity shares use attack rows; lnStartShare uses attack notes. Adjacent
    shares use adjacent row pairs; disjointAlternationShare uses four-row windows
    with exact disjoint ABAB column sets. Chord arity uses heads only.
    Timing pairs never cross scope boundaries. sameColumnMaxHz is
    1000 / the shortest within-column head gap, not a difficulty rating.

    peakHalfSecondAttacks counts heads in a sliding half-open 500 ms window,
    including chords. gapVariation is the coefficient of variation and
    gapEntropyBits is empirical entropy after the 1 ms grouping above.

    lnOccupiedColumnShare is held column-time / (4 * scope duration).
    releaseUnderHoldShare and attackUnderHoldShare count note events at t with
    another hold satisfying start < t < end; equal-time ends/starts do not count
    as continuing. handImbalance is abs(left heads - right heads) / all heads.
    """
    duration = end_ms - start_ms
    attacks = sorted((n for n in notes if start_ms <= n["start_ms"] < end_ms),
                     key=lambda n: (n["start_ms"], n["column"]))
    grouped = defaultdict(set)
    column_times = defaultdict(list)
    for note in attacks:
        grouped[note["start_ms"]].add(note["column"])
        column_times[note["column"]].append(note["start_ms"])
    times = list(grouped)
    rows = list(grouped.values())
    pairs = list(zip(rows, rows[1:]))
    arities = Counter(map(len, rows))
    attack_count = len(attacks)
    row_count = len(rows)

    attack_times = [n["start_ms"] for n in attacks]
    left = peak_count = 0
    for right, time in enumerate(attack_times):
        while time - attack_times[left] >= 500:
            left += 1
        peak_count = max(peak_count, right - left + 1)
    column_gaps = [b - a for values in column_times.values()
                   for a, b in zip(values, values[1:])]
    gap_variation, gap_entropy = rhythm_features([b - a for a, b in zip(times, times[1:])])

    holds = [n for n in notes if n["kind"] == "long"
             and n["start_ms"] < end_ms and n["end_ms"] > start_ms]
    hold_starts = sorted(n["start_ms"] for n in holds)
    hold_ends = sorted(n["end_ms"] for n in holds)
    releases = [n for n in notes if n["kind"] == "long"
                and start_ms <= n["end_ms"] < end_ms]

    def continuing(time):
        return bisect_left(hold_starts, time) > bisect_right(hold_ends, time)

    occupied_ms = sum(min(end_ms, n["end_ms"]) - max(start_ms, n["start_ms"])
                      for n in holds)
    left_count = sum(n["column"] < 2 for n in attacks)
    result = {
        "durationMs": duration,
        "attackCount": attack_count,
        "attackRowCount": row_count,
        "nps": attack_count * 1000 / duration,
        "peakHalfSecondAttacks": peak_count,
        "adjacentSharedColumnShare": sum(bool(a & b) for a, b in pairs) / max(1, len(pairs)),
        "repeatedRowShare": sum(a == b for a, b in pairs) / max(1, len(pairs)),
        "disjointAlternationShare": sum(a == c and b == d and not a & b
                                        for a, b, c, d in zip(rows, rows[1:], rows[2:], rows[3:]))
        / max(1, row_count - 3),
        "chordRowShare": sum(count for arity, count in arities.items() if arity > 1) / max(1, row_count),
        "gapVariation": gap_variation,
        "gapEntropyBits": gap_entropy,
        "lnStartShare": sum(n["kind"] == "long" for n in attacks) / max(1, attack_count),
        "lnOccupiedColumnShare": occupied_ms / (4 * duration),
        "lnReleaseCount": len(releases),
        "releaseUnderHoldShare": sum(continuing(n["end_ms"]) for n in releases) / max(1, len(releases)),
        "attackUnderHoldShare": sum(continuing(n["start_ms"]) for n in attacks) / max(1, attack_count),
        "handImbalance": abs(2 * left_count - attack_count) / max(1, attack_count),
        "sameColumnMinGapMs": min(column_gaps, default=0),
        "sameColumnMaxHz": 1000 / min(column_gaps) if column_gaps else 0.0,
    }
    for arity, name in enumerate(("single", "double", "triple", "quad"), 1):
        result[f"{name}RowShare"] = arities[arity] / max(1, row_count)
    return result
