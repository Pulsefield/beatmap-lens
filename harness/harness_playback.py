"""Performance-time companions to unchanged source evidence."""
from bisect import bisect_right

from playback_rate import normalize_playback_rate


def timing_context(start_ms, end_ms, playback_rate):
    rate = normalize_playback_rate(playback_rate)
    return {
        'sourceOriginMs': start_ms,
        'durationMs': (end_ms - start_ms) / rate,
        'conventions': ('Performance milliseconds are elapsed from sourceOriginMs: '
                        '(sourceMs - sourceOriginMs) / playbackRate. Negative or beyond-scope '
                        'times preserve full entering/continuing notes. All outer source fields, '
                        'note refs and query coordinates remain exact source milliseconds; beats are unchanged.'),
    }


def add_inspection_timing(result, chart, start_ms, end_ms, playback_rate):
    rate = normalize_playback_rate(playback_rate)
    if rate == 1:
        return result
    times = sorted({note['startMs'] for note in chart['notes']})
    rows = []
    for row in result['rows']:
        time = row[0]
        index = bisect_right(times, time)
        next_gap = (times[index] - time) / rate if index < len(times) else None
        rows.append([time, (time - start_ms) / rate, next_gap])
    source_lines = {ref[0] for key in ('enteringHolds', 'pageEnteringHolds') for ref in result.get(key, [])}
    for row in result['rows']:
        for group in (row[1:4] if result['view'] == 'actions' else row[1:2]):
            source_lines.update(ref[0] for ref in group)
    notes = [[note['sourceLine'], (note['startMs'] - start_ms) / rate,
              (note['endMs'] - start_ms) / rate, (note['endMs'] - note['startMs']) / rate]
             for note in chart['notes'] if note['sourceLine'] in source_lines]
    result.update(playbackRate=rate, performanceTiming=timing_context(start_ms, end_ms, rate) | {
        'rowSchema': ['sourceTimeMs', 'elapsedMs', 'nextAttackGapMs'], 'rows': rows,
        'noteSchema': ['sourceLine', 'startElapsedMs', 'endElapsedMs', 'durationMs'], 'notes': notes,
    })
    return result


def tempo_timing(point, start_ms, rate):
    result = {'sourceLine': point['sourceLine'], 'sourceTimeMs': point['timeMs'],
              'elapsedMs': (point['timeMs'] - start_ms) / rate, 'kind': point['kind']}
    if point['kind'] == 'tempo':
        result.update(beatLengthMs=point['beatLengthMs'] / rate,
                      bpm=60000 / point['beatLengthMs'] * rate)
    else:
        result['rawSvMultiplier'] = point['rawSvMultiplier']
    return result
