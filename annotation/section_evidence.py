"""Source-bound selected-section inputs shared by production and evaluation."""
from collections import defaultdict
import json

import pyarrow.parquet as pq

from annotation_runtime import sha
from playback_rate import normalize_playback_rate, playback_rate_fields

NOTE_FIELDS = ('source_line', 'column', 'kind', 'start_ms', 'end_ms')


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def source_cases(design, campaign, sources):
    cases = []
    for case in design['cases']:
        source = case['sourceSha256']
        parquet = campaign / 'agent/charts' / f'{source}.parquet'
        table = pq.ParquetFile(parquet).read()
        meta = json.loads(table.schema.metadata[b'beatmap_lens'])
        if meta['source']['sha256'] != source:
            raise ValueError(f'Parquet source binding differs: {source}')
        context = case['reviewContext']
        notes = table.to_pylist()
        selected = [note for note in notes if note['start_ms'] < context['endMs'] and
                    (note['end_ms'] > context['startMs'] if note['kind'] == 'long'
                     else note['start_ms'] >= context['startMs'])]
        boundary = [note for note in notes if note['kind'] == 'long' and note['end_ms'] == context['startMs']]
        cases.append({
            'caseId': case['benchmarkCaseId'], 'sectionId': case['benchmarkCaseId'],
            **playback_rate_fields(case),
            'sourceSha256': source, 'sourceMetadata': sources[source]['source'],
            'scope': case['scope'], 'reviewContext': context, 'parquetSha256': sha(parquet),
            'notes': [{key: note[key] for key in NOTE_FIELDS} for note in selected],
            'boundaryReleases': [{key: note[key] for key in NOTE_FIELDS} for note in boundary],
            'timingPoints': meta['timingPoints'],
        })
    return cases


def brief(cases):
    lines = ['# Selected sections', '',
             'Judge each complete target scope across all five dimensions. Context explains entry/exit; '
             'keep the target scope unchanged. Metadata identifies the difficulty and does not establish a style.', '',
             'All intervals are half-open source milliseconds; columns are zero-based. Every attack in each '
             'review context is listed. Row notation is timeMs followed by [sourceLine,column,kind,endMs] '
             'tuples; T is a normal tap and L is a long note. Entering holds retain their original head and end.', '',
             'Full-note tuples use [sourceLine,column,kind,startMs,endMs]. Notes ending exactly at the left '
             'context boundary are listed separately as release facts, not entering holds. Do not cite those '
             'endpoint-only notes in noteLines/contextLines: the unchanged reference contract requires overlap.', '',
             'brief.md is the compact initial evidence. cases.json contains the same notes in verbose scorer '
             'form and full timing-point facts; reread only a needed record, not the whole duplicate file.', '']
    for case in cases:
        source = case['sourceMetadata']
        scope, context = case['scope'], case['reviewContext']
        metadata = {key: source[key] for key in ('title', 'artist', 'difficulty', 'creator', 'keyCount',
                                               'beatmapId', 'beatmapSetId') if key in source}
        lines.extend([f"## {case['caseId']}", '', compact(metadata),
                      f"sourceSha256={case['sourceSha256']}; sectionId={case['sectionId']}",
                      f"scope=[{scope['startMs']},{scope['endMs']}); reviewContext=[{context['startMs']},{context['endMs']})"])
        rate = normalize_playback_rate(case.get('playbackRate'))
        if rate != 1:
            lines.extend([
                f"Playback rate: {rate:g}x. Judge this rate only. All scope and witness coordinates remain source-ms.",
                f"Performance duration: {(scope['endMs'] - scope['startMs']) / rate:g} ms. "
                f"Performance time, gaps and hold lengths = source milliseconds / {rate:g}; BPM = source BPM * {rate:g}.",
            ])
        points = sorted(case['timingPoints'], key=lambda p: (float(p['fields'][0]), p['sourceLine']))
        prior_tempo = next((p for p in reversed(points) if float(p['fields'][0]) <= context['startMs']
                            and float(p['fields'][1]) > 0), None)
        prior_scroll = next((p for p in reversed(points) if float(p['fields'][0]) <= context['startMs']), None)
        selected_points = {p['sourceLine']: p for p in (prior_tempo, prior_scroll) if p is not None}
        selected_points.update({p['sourceLine']: p for p in points
                                if context['startMs'] < float(p['fields'][0]) < context['endMs']})
        lines.append('Timing [sourceLine,osu timing fields]: ' + compact(
            [[p['sourceLine'], p['fields']] for p in selected_points.values()]))
        if rate != 1:
            lines.append('Effective tempo [sourceLine,performance BPM]: ' + compact([
                [p['sourceLine'], 60000 / float(p['fields'][1]) * rate]
                for p in selected_points.values() if float(p['fields'][1]) > 0]))

        def full(note):
            return [note['source_line'], note['column'], 'L' if note['kind'] == 'long' else 'T',
                    note['start_ms'], note['end_ms']]

        for label, start in (('Entering review context', context['startMs']), ('Entering target scope', scope['startMs'])):
            lines.append(label + ': ' + compact([full(n) for n in case['notes']
                                                if n['kind'] == 'long' and n['start_ms'] < start < n['end_ms']]))
        if case['boundaryReleases']:
            lines.append('Release facts exactly at context start (endpoint-only, not citable refs): ' +
                         compact([full(n) for n in case['boundaryReleases']]))
        rows = defaultdict(list)
        for note in case['notes']:
            if context['startMs'] <= note['start_ms'] < context['endMs']:
                rows[note['start_ms']].append(note)
        lines.append('```text')
        for time, notes in sorted(rows.items()):
            lines.append(str(time) + ' ' + compact([[n['source_line'], n['column'],
                                                    'L' if n['kind'] == 'long' else 'T', n['end_ms']]
                                                   for n in sorted(notes, key=lambda n: (n['column'], n['source_line']))]))
        lines.extend(['```', ''])
        if rate != 1:
            previous = None
            performance_rows = []
            for time, notes in sorted(rows.items()):
                performance_rows.append([time, (time - scope['startMs']) / rate,
                    None if previous is None else (time - previous) / rate,
                    [[n['source_line'], (n['end_ms'] - n['start_ms']) / rate]
                     for n in notes if n['kind'] == 'long']])
                previous = time
            lines.append('Performance rows [sourceMs,msFromTargetStart,gapMs,LN[sourceLine,lengthMs]]: ' +
                         compact(performance_rows))
    return '\n'.join(lines)
