"""Write one source-backed notes Parquet per chart and duration-bounded blind assignments."""
import argparse
import hashlib
import json
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

parser = argparse.ArgumentParser()
parser.add_argument('--normalized', type=Path, required=True)
parser.add_argument('--out', type=Path, required=True)
parser.add_argument('--max-duration-ms', type=int, default=2400000)
args = parser.parse_args()
agent = args.out / 'agent'
charts_dir = agent / 'charts'
assignments_dir = agent / 'assignments'
charts_dir.mkdir(parents=True, exist_ok=True)
assignments_dir.mkdir(parents=True, exist_ok=True)

columns = [
    ('note_id', 'id', pa.string()),
    ('source_line', 'sourceLine', pa.int32()),
    ('column', 'column', pa.int8()),
    ('kind', 'kind', pa.string()),
    ('source_kind', 'sourceKind', pa.string()),
    ('start_ms', 'startMs', pa.int64()),
    ('end_ms', 'endMs', pa.int64()),
    ('x', 'x', pa.int32()),
    ('hit_sound', 'hitSound', pa.int32()),
]
source_keys = ['sha256', 'byteLength', 'osuFormatVersion', 'beatmapId', 'beatmapSetId',
               'keyCount', 'noteCount', 'normalizerId']
charts = []
for line in args.normalized.open():
    facts = json.loads(line)
    source = {key: facts['source'][key] for key in source_keys if key in facts['source']}
    metadata = {
        'format': 'beatmap-lens-normalized-notes-parquet-v1',
        'source': source,
        'range': facts['range'],
        'durationMs': facts['durationMs'],
        'timingPoints': facts['timingPoints'],
        'columnBase': 0,
        'sourceLineBase': 1,
        'scopeConvention': 'Half-open [startMs,endMs); entering holds satisfy startMs < scope.startMs < endMs.',
    }
    schema = pa.schema([(name, data_type) for name, _, data_type in columns],
                       metadata={b'beatmap_lens': json.dumps(metadata, separators=(',', ':')).encode()})
    rows = [{name: note[key] for name, key, _ in columns} for note in facts['notes']]
    table = pa.Table.from_pylist(rows, schema=schema)
    path = charts_dir / f"{source['sha256']}.parquet"
    pq.write_table(table, path, compression='zstd', use_dictionary=['kind', 'source_kind'])
    restored = pq.read_table(path)
    assert restored.equals(table, check_metadata=True), path
    assert restored.num_rows == source['noteCount']
    assert 0 < facts['durationMs'] <= args.max_duration_ms
    charts.append({'sourceSha256': source['sha256'], 'parquetPath': str(path.resolve()),
                   'parquetSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                   'durationMs': facts['durationMs'], 'noteCount': source['noteCount']})

# Duration packing is independent of administrative voting order.
shards = []
for chart in sorted(charts, key=lambda item: (-item['durationMs'], item['sourceSha256'])):
    shard = next((item for item in shards
                  if item['durationMs'] + chart['durationMs'] <= args.max_duration_ms), None)
    if shard is None:
        shard = {'durationMs': 0, 'charts': []}
        shards.append(shard)
    shard['durationMs'] += chart['durationMs']
    shard['charts'].append(chart)
for shard in shards:
    # Neither chart order nor assignment ID carries selection rank.
    shard['charts'].sort(key=lambda item: item['sourceSha256'])
    identity = '\n'.join(item['sourceSha256'] for item in shard['charts'])
    shard['assignmentId'] = hashlib.sha256(identity.encode()).hexdigest()[:20]
    shard['kind'] = 'beatmap-lens-blind-chart-assignment-v1'
    shard['maximumDurationMs'] = args.max_duration_ms
    (assignments_dir / f"{shard['assignmentId']}.json").write_text(json.dumps(shard, indent=2) + '\n')
shards.sort(key=lambda item: item['assignmentId'])
assert len({chart['sourceSha256'] for chart in charts}) == len(charts)
assert sum(len(shard['charts']) for shard in shards) == len(charts)
assert all(shard['durationMs'] <= args.max_duration_ms for shard in shards)
summary = {
    'chartCount': len(charts), 'noteCount': sum(chart['noteCount'] for chart in charts),
    'totalDurationMs': sum(chart['durationMs'] for chart in charts),
    'maximumChartDurationMs': max(chart['durationMs'] for chart in charts),
    'assignmentCount': len(shards), 'maximumAssignmentDurationMs': max(shard['durationMs'] for shard in shards),
    'durationDefinition': 'Exact Lens chart.range.endMs - chart.range.startMs; includes leading time from zero and the final +1 ms half-open endpoint.',
    'packing': 'First-fit decreasing duration; ties and within-assignment order use source SHA-256, never selection rank.',
    'pyarrowVersion': pa.__version__, 'roundTripVerifiedCharts': len(charts),
    'assignments': [{key: shard[key] for key in ['assignmentId', 'durationMs']} for shard in shards],
}
(args.out / 'admin' / 'preparation-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({key: value for key, value in summary.items() if key != 'assignments'}, indent=2))
