"""Build a read-only coverage report and a diverse next-section queue from current feedback."""
import argparse
from bisect import bisect_left, bisect_right
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import random
from urllib.request import urlopen

TAGS = ('jack-organization', 'stream-organization', 'trill-organization', 'tech', 'ln-coordination')
FEATURES = ('nps', 'peakHalfSecondAttacks', 'adjacentSharedColumnShare', 'disjointAlternationShare',
            'chordRowShare', 'gapVariation', 'lnOccupiedColumnShare', 'releaseUnderHoldShare', 'handImbalance',
            'lnStartShare', 'durationMs', 'sameColumnMaxHz')
WEIGHTS = {'feedbackSimilarity': .30, 'openReview': .25, 'dimensionGap': .20,
           'rarity': .10, 'chartGap': .10, 'demand': .05}


def read(path):
    return json.loads(Path(path).read_text())


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), (Path(__file__).resolve().parents[2] / 'harness' if name == 'annotation-facts' else Path(__file__).parent) / (name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def union(ranges):
    result = []
    for start, end in sorted(ranges):
        if start >= end:
            continue
        if result and start <= result[-1][1]:
            result[-1][1] = max(end, result[-1][1])
        else:
            result.append([start, end])
    return result


def intersect(left, right):
    return union((max(a, c), min(b, d)) for a, b in left for c, d in right if max(a, c) < min(b, d))


def subtract(ranges, cuts):
    result = union(ranges)
    for a, b in union(cuts):
        result = [(x, y) for start, end in result for x, y in
                  ((start, min(end, a)), (max(start, b), end)) if x < y]
    return result


def length(ranges):
    return sum(b - a for a, b in union(ranges))


def bounds(claim):
    return claim['scope']['startMs'], claim['scope']['endMs']


def known(claim):
    return claim['assessment']['presence'] in ('present', 'absent')


def feedback_labels(feedback):
    """Human coverage overrides overlapping machine coverage, independently per dimension."""
    human, machine, signals = [], [], []
    for row in feedback.get('agentReviews', []):
        if row['status'] == 'superseded':
            continue
        claim = row.get('modifiedClaim', row['summary'])
        if 'effectiveHumanObservations' not in feedback and row['status'] in ('accepted', 'modified') and known(claim):
            human.append(claim)
        elif row['status'] == 'agent-reviewed' and row['baseStatus'] == 'current' and known(claim):
            machine.append(claim)
        if row['status'] in ('needs-expert', 'needs-revision'):
            signals.append({'kind': 'openReview', 'claim': claim, 'claimId': row['claimId'], 'handoffId': row['handoffId'],
                            **{key: row[key] for key in ('status', 'expertReason', 'question') if key in row},
                            'audits': row.get('audits', [])})
        if row.get('decision', {}).get('disposition') in ('modified', 'rejected'):
            signals.append({'kind': 'correction', 'claim': claim, 'claimId': row['claimId'],
                            'handoffId': row['handoffId'], 'decisionId': row['decision'].get('id')})
    for observation in feedback.get('effectiveHumanObservations', feedback.get('directObservations', [])):
        claim = observation.get('claim', observation.get('summary'))
        if known(claim) and all(value == 'current' for value in observation.get('trust', {}).values()):
            human.append(claim)
    return human, machine, signals


def confidence_counts(feedback):
    """Report evidence currency separately; it never creates an automatic repair request."""
    machine = [row for row in feedback.get('agentReviews', []) if not row.get('decision') and row['status'] != 'superseded']
    gold = feedback.get('effectiveHumanObservations', [])
    return {
        'machine': {layer: dict(Counter(row.get('trust', {}).get(layer, 'untracked') for row in machine))
                    for layer in ('source', 'foundation', 'humanContext')},
        'human': {layer: dict(Counter(row.get('trust', {}).get(layer, 'untracked') for row in gold))
                  for layer in ('source', 'foundation')},
    }


def human_conflicts(claims):
    """Overlapping settled assessments that disagree need review, not a latest-wins guess."""
    conflicts = []
    for index, claim in enumerate(claims):
        for other in claims[index + 1:]:
            if claim['tagId'] != other['tagId'] or claim['assessment'] == other['assessment']:
                continue
            overlap = intersect([bounds(claim)], [bounds(other)])
            if overlap:
                conflicts.append({'tagId': claim['tagId'], 'ranges': overlap,
                                  'claimIds': [claim['id'], other['id']],
                                  'assessments': [claim['assessment'], other['assessment']]})
    return conflicts


def coverage(claims, chart_range, times):
    per_tag = {tag: intersect(union(bounds(c) for c in claims if c['tagId'] == tag), [chart_range]) for tag in TAGS}
    all_tags = [chart_range]
    for ranges in per_tag.values():
        all_tags = intersect(all_tags, ranges)
    any_tag = union(r for ranges in per_tag.values() for r in ranges)
    duration = chart_range[1] - chart_range[0]
    def measure(ranges):
        ms = length(ranges)
        count = sum(bisect_left(times, b) - bisect_left(times, a) for a, b in ranges)
        return {'ms': ms, 'timeRate': ms / duration, 'noteStarts': count,
                'noteRate': count / len(times) if times else 0}
    return {'anyDimension': measure(any_tag), 'allDimensions': measure(all_tags),
            'dimensions': {tag: measure(ranges) for tag, ranges in per_tag.items()}}, per_tag


def candidate_ranges(chart_range, claims, window_ms, stride_ms):
    start, end = chart_range
    return sorted({(a, min(a + window_ms, end)) for a in range(start, end, stride_ms)
                   if a == start or end - a >= window_ms / 2} |
                  {bounds(c) for c in claims if start <= bounds(c)[0] < bounds(c)[1] <= end
                   and bounds(c)[1] - bounds(c)[0] <= 2 * window_ms})


def repair_ranges(issues):
    """For one source, merge overlapping full scopes while retaining every issue identity."""
    result = []
    for issue in sorted(issues, key=lambda i: (*bounds(i), i['issueId'])):
        start, end = bounds(issue)
        if result and start < result[-1]['scope']['endMs']:
            result[-1]['scope']['endMs'] = max(end, result[-1]['scope']['endMs'])
            result[-1]['issueIds'].append(issue['issueId'])
            context = result[-1]['reviewContext']
            context['startMs'] = min(context['startMs'], issue['reviewContext']['startMs'])
            context['endMs'] = max(context['endMs'], issue['reviewContext']['endMs'])
        else:
            result.append({'scope': {'startMs': start, 'endMs': end}, 'issueIds': [issue['issueId']],
                           'reviewContext': dict(issue['reviewContext'])})
    return result


def rank_candidates(candidates, corrections):
    """Empirical ranks keep feature units separate; distance is a retrieval proxy, not uncertainty."""
    populations = {key: sorted(c['features'][key] for c in candidates) for key in FEATURES}
    def vector(features):
        return [(bisect_left(populations[key], features[key]) + bisect_right(populations[key], features[key]))
                / (2 * len(candidates)) for key in FEATURES]
    correction_vectors = [(item, vector(item['features'])) for item in corrections]
    for candidate in candidates:
        candidate['featureRanks'] = vector(candidate['features'])
        candidate['stratum'] = ':'.join(str(min(3, int(value * 4))) for value in candidate['featureRanks'][::2])
    frequencies = Counter(c['stratum'] for c in candidates)
    for candidate in candidates:
        vec = candidate['featureRanks']
        nearest = sorted(((sum(abs(a-b) for a, b in zip(vec, other)) / len(vec), item)
                          for item, other in correction_vectors if item['sourceSha256'] != candidate['sourceSha256']),
                         key=lambda pair: (pair[0], pair[1]['sourceSha256'], pair[1]['claimId']))[:1]
        similarity = max(0, 1 - nearest[0][0] / .25) if nearest else 0
        candidate['components'].update(feedbackSimilarity=similarity,
                                       rarity=1 / frequencies[candidate['stratum']] ** .5,
                                       demand=(vec[0] + vec[1]) / 2)
        candidate['priority'] = sum(candidate['components'][key] * weight for key, weight in WEIGHTS.items())
        candidate['feedbackExample'] = ({key: nearest[0][1][key] for key in ('sourceSha256', 'claimId', 'scope', 'tagId', 'handoffId', 'decisionId')}
                                        if nearest else None)
        candidate['reasons'] = [key for key, value in sorted(candidate['components'].items(),
                               key=lambda pair: -pair[1] * WEIGHTS[pair[0]]) if value > 0][:3]
    return sorted(candidates, key=lambda c: (-c['priority'], c['sourceSha256'], c['scope']['startMs'], c['scope']['endMs']))


def select_batch(ranked, size, seed, max_per_group=2, max_repairs=10):
    """Reserve exploration, repair whole issues, then diversify the remaining discovery slots."""
    chosen, groups, strata = [], Counter(), Counter()
    def add(candidate, route):
        if route != 'repair' and (groups[candidate['selectionGroup']] >= max_per_group or strata[candidate['stratum']] >= 2):
            return False
        if any(c['sourceSha256'] == candidate['sourceSha256'] and intersect([bounds(c)], [bounds(candidate)]) for c in chosen):
            return False
        chosen.append({**candidate, 'selectionRoute': route})
        if route != 'repair':
            groups[candidate['selectionGroup']] += 1
            strata[candidate['stratum']] += 1
        return True
    exploitation = size - (max(1, round(size * .2)) if size > 1 else 0)
    repairs = [c for c in ranked if c['candidateKind'] == 'repair']
    discovery = [c for c in ranked if c['candidateKind'] == 'discovery']
    for candidate in repairs:
        if len(chosen) >= min(max_repairs, exploitation):
            break
        add(candidate, 'repair')
    for candidate in discovery:
        if len(chosen) >= exploitation:
            break
        add(candidate, 'priority')
    exploration = discovery.copy()
    random.Random(seed).shuffle(exploration)
    for candidate in exploration:
        if len(chosen) >= size:
            break
        add(candidate, 'seeded-exploration')
    return chosen


def aggregate(charts, tier):
    duration = sum(c['durationMs'] for c in charts)
    notes = sum(c['noteCount'] for c in charts)
    def total(items):
        ms = sum(i['ms'] for i in items)
        count = sum(i['noteStarts'] for i in items)
        return {'ms': ms, 'timeRate': ms / duration if duration else 0,
                'noteStarts': count, 'noteRate': count / notes if notes else 0}
    return {**{key: total([c[tier][key] for c in charts]) for key in ('anyDimension', 'allDimensions')},
            'dimensions': {tag: total([c[tier]['dimensions'][tag] for c in charts]) for tag in TAGS}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--campaign', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True, help='New derived-output directory; never a campaign worker directory.')
    parser.add_argument('--feedback-dir', type=Path, help='Replay a saved feedback snapshot instead of reading the service.')
    parser.add_argument('--song-groups', type=Path, help='Optional JSON object mapping every source SHA to a curated song ID.')
    parser.add_argument('--batch-size', type=int, default=24)
    parser.add_argument('--exclude-sections', type=Path, help='Previously attempted section scopes; skip overlapping targets during recurring fine annotation.')
    parser.add_argument('--seed', type=int, default=20260907)
    parser.add_argument('--window-ms', type=int, default=10000)
    parser.add_argument('--stride-ms', type=int, default=5000)
    args = parser.parse_args()
    if min(args.window_ms, args.stride_ms, args.batch_size) <= 0:
        parser.error('Window, stride, and batch size must be positive.')
    args.out.mkdir(parents=True, exist_ok=False)
    config = read(args.campaign / 'controller/config.json')
    sources = read(args.campaign / 'admin/source-map.json')
    song_groups = read(args.song_groups) if args.song_groups else None
    if song_groups is not None and any(c['source']['sha256'] not in song_groups for c in sources):
        parser.error('--song-groups must identify every corpus source.')
    feedback_dir = args.out / 'feedback'
    feedback_dir.mkdir()
    started = datetime.now(timezone.utc).isoformat()
    def fetch(source):
        sha = source['source']['sha256']
        if args.feedback_dir:
            value = read(args.feedback_dir / f'{sha}.json')
        elif (Path(config['workspace']) / 'workflow' / f'{sha}.v2.json').exists():
            with urlopen(config['server'] + '/api/review/feedback/' + sha, timeout=60) as response:
                value = json.load(response)
        else:
            value = {'sourceSha256': sha, 'agentReviews': [], 'directObservations': [], 'unregistered': True}
        if value['sourceSha256'] != sha:
            raise ValueError(f'Feedback source identity differs: {sha}')
        if not value.get('unregistered') and value['taskBinding']['foundationSha256'] != config['foundationSha256']:
            raise ValueError(f'Feedback Foundation differs: {sha}')
        (feedback_dir / f'{sha}.json').write_text(json.dumps(value, separators=(',', ':')) + '\n')
        return sha, value
    with ThreadPoolExecutor(max_workers=4) as pool:
        feedback = dict(pool.map(fetch, sources))
    print(f'Read feedback for {len(sources)} sources.', flush=True)
    facts, scorer = module('annotation-facts'), module('section-features')
    charts, candidates, corrections, conflicts, open_issues = [], [], [], [], []
    states = Counter()
    for index, source in enumerate(sources):
        sha = source['source']['sha256']
        parquet = args.campaign / 'agent/charts' / f'{sha}.parquet'
        notes, meta = facts.read_chart(parquet)
        if meta['source']['sha256'] != sha:
            raise ValueError(f'Source identity differs: {parquet}')
        times = sorted(n['start_ms'] for n in notes)
        chart_range = (meta['range']['startMs'], meta['range']['endMs'])
        human, machine, signals = feedback_labels(feedback[sha])
        states.update(row['status'] for row in feedback[sha].get('agentReviews', []))
        chart_conflicts = human_conflicts(human)
        conflicts.extend({'sourceSha256': sha, **item} for item in chart_conflicts)
        _, human_ranges = coverage(human, chart_range, times)
        # Conflicting human coverage remains visible as reviewed but is excluded from usable labels.
        conflict_ranges = {tag: union(r for item in chart_conflicts if item['tagId'] == tag for r in item['ranges']) for tag in TAGS}
        human = [{**c, 'scope': {'startMs': a, 'endMs': b}} for c in human
                 for a, b in subtract([bounds(c)], conflict_ranges[c['tagId']])]
        human_metrics, _ = coverage(human, chart_range, times)
        # A human judgment owns its exact target/scope even when a prior proposal overlaps it.
        machine = [{**c, 'scope': {'startMs': a, 'endMs': b}} for c in machine
                   for a, b in subtract([bounds(c)], human_ranges.get(c['tagId'], []))]
        machine_metrics, _ = coverage(machine, chart_range, times)
        combined_metrics, covered = coverage(human + machine, chart_range, times)
        set_id = source['source'].get('beatmapSetId')
        group = str(song_groups[sha]) if song_groups is not None else f'mapset:{set_id}' if set_id and set_id > 0 else f'source:{sha}'
        label_counts = {}
        for tier, labels in (('human', human), ('machineOnly', machine)):
            unique = {(c['tagId'], *bounds(c), c['assessment'].get('salience', c['assessment']['presence'])) for c in labels}
            label_counts[tier] = {tag: dict(Counter(item[3] for item in unique if item[0] == tag)) for tag in TAGS}
        chart = {'title': source['source'].get('title', sha[:12]),
                 'difficulty': source['source'].get('difficulty', ''),
                 'labelCounts': label_counts, 'sourceSha256': sha, 'beatmapSetId': set_id, 'selectionGroup': group,
                 'confidenceCounts': confidence_counts(feedback[sha]),
                 'durationMs': chart_range[1] - chart_range[0], 'noteCount': len(notes),
                 'human': human_metrics, 'machineOnly': machine_metrics, 'combined': combined_metrics,
                 'parquetSha256': digest(parquet), 'feedbackSha256': digest(feedback_dir / f'{sha}.json')}
        charts.append(chart)
        for signal in signals:
            if signal['kind'] == 'correction':
                claim = signal['claim']
                corrections.append({'sourceSha256': sha, 'claimId': signal['claimId'], 'scope': claim['scope'],
                                    'tagId': claim['tagId'], 'handoffId': signal['handoffId'], 'decisionId': signal['decisionId'],
                                    'features': scorer.section_features(notes, *bounds(claim))})
        issues = [{'issueId': '/'.join((sha, s['handoffId'], s['claimId'])),
                   'sourceSha256': sha, 'handoffId': s['handoffId'], 'claimId': s['claimId'],
                   'scope': s['claim']['scope'], 'tagId': s['claim']['tagId'],
                   'reviewContext': s['claim']['reviewContext'],
                   **{key: s[key] for key in ('status', 'expertReason', 'question', 'audits') if key in s}}
                  for s in signals if s['kind'] == 'openReview']
        open_issues.extend(issues)
        repairs = repair_ranges(issues)
        ordinary = [{'scope': {'startMs': start, 'endMs': end}, 'issueIds': []}
                    for start, end in candidate_ranges(chart_range, human + machine, args.window_ms, args.stride_ms)
                    if not any(intersect([bounds(issue)], [(start, end)]) for issue in issues)]
        for target in repairs + ordinary:
            start, end = bounds(target)
            context = target.get('reviewContext', target['scope'])
            features = scorer.section_features(notes, start, end)
            if not target['issueIds'] and not features['attackCount'] and not features['lnOccupiedColumnShare']:
                continue
            missing = {tag: 1 - length(intersect(ranges, [(start, end)])) / (end - start) for tag, ranges in covered.items()}
            open_review = bool(target['issueIds'])
            open_review = open_review or any(intersect(ranges, [(start, end)]) for ranges in conflict_ranges.values())
            # Fully judged scopes need no new annotation unless a current review is still open.
            if max(missing.values()) < 1e-9 and not open_review:
                continue
            candidates.append({'sourceSha256': sha, **target,
                               'candidateKind': 'repair' if target['issueIds'] else 'discovery',
                               'reviewContext': {'startMs': max(chart_range[0], min(start - 2000, context['startMs'])),
                                                 'endMs': min(chart_range[1], max(end + 2000, context['endMs']))},
                               'selectionGroup': group, 'features': features, 'missingDimensions': missing,
                               'components': {'openReview': int(open_review), 'dimensionGap': sum(missing.values()) / len(TAGS),
                                              'chartGap': 1 - sum(combined_metrics['dimensions'][t]['timeRate'] for t in TAGS) / len(TAGS)}})
        if (index + 1) % 100 == 0:
            print(f'Scored {index + 1}/{len(sources)} charts.', flush=True)
    ranked = rank_candidates(candidates, corrections) if candidates else []
    excluded = read(args.exclude_sections)['sections'] if args.exclude_sections else []
    eligible = [candidate for candidate in ranked if not any(
        candidate['sourceSha256'] == previous['sourceSha256']
        and intersect([bounds(candidate)], [bounds(previous)]) for previous in excluded)]
    batch = select_batch(eligible, args.batch_size, args.seed)
    selected_issue_ids = {issue_id for c in batch for issue_id in c['issueIds']}
    groups = sorted({c['selectionGroup'] for c in charts})
    grouped = [{'id': group, 'charts': sum(c['selectionGroup'] == group for c in charts),
                **{tier: aggregate([c for c in charts if c['selectionGroup'] == group], tier) for tier in ('human', 'combined')}} for group in groups]
    report = {'kind': 'annotation-priorities-v2', 'excludedSectionsSha256': digest(args.exclude_sections) if args.exclude_sections else None, 'startedAt': started, 'finishedAt': datetime.now(timezone.utc).isoformat(),
              'foundationSha256': config['foundationSha256'], 'campaignSkill': config['skill'],
              'scriptSha256': digest(__file__), 'featureScriptSha256': digest(Path(__file__).with_name('section-features.py')),
              'sourceMapSha256': digest(args.campaign / 'admin/source-map.json'),
              'songGroupsSha256': digest(args.song_groups) if args.song_groups else None,
              'config': {'weights': WEIGHTS, 'seed': args.seed, 'windowMs': args.window_ms, 'strideMs': args.stride_ms,
                         'minGridWindowFraction': .5,
                         'requestedBatchSize': args.batch_size, 'explorationFraction': .2, 'maxRepairSections': 10,
                         'discoveryMaxPerGroup': 2, 'discoveryMaxPerStratum': 2, 'feedbackRetrieval': 'cross-source'},
              'limits': ['Experimental, unvalidated heuristic weights; no measured annotation value, cost model, V3 uncertainty or calibrated difficulty.',
                         'Repairs retain full open-claim scopes; discovery excludes every open-issue overlap, including pending repairs.',
                         'Correction similarity retrieves different sources only; settled human cells are reused, never inferred from similarity.',
                         'Grid windows are inspection targets; labelers choose semantic episode boundaries.',
                         'Coverage counts explicit present/absent judgments only; review context and unresolved are excluded.',
                         'Machine coverage is not publication eligibility: consult confidenceCounts for source, Foundation and referenced human evidence separately.',
                         'Time denominator is full Lens chart range including leading silence; note coverage counts attack starts.',
                         'Live per-source snapshots are captured over the reported interval, not an atomic workspace snapshot.',
                         'Exploration is a coverage check, not an unbiased accuracy estimate.',
                         'No full-chart discovery count is inferred from scoped claims.',
                         'Human-first clipping is a report policy; conflicting human assessments are listed and excluded from usable coverage.'],
              'unregisteredSources': sum(bool(value.get('unregistered')) for value in feedback.values()),
              'feedbackDirectory': str(feedback_dir.resolve()),
              'chartCount': len(charts), 'candidateCount': len(candidates), 'humanCorrectionExamples': len(corrections),
              'openIssues': open_issues, 'selectedIssueIds': sorted(selected_issue_ids),
              'pendingIssueIds': sorted(i['issueId'] for i in open_issues if i['issueId'] not in selected_issue_ids),
              'selectionRoutes': dict(Counter(c['selectionRoute'] for c in batch)),
              'labelCounts': {tier: {tag: dict(sum((Counter(c['labelCounts'][tier][tag]) for c in charts), Counter())) for tag in TAGS} for tier in ('human', 'machineOnly')},
              'humanConflicts': conflicts, 'reviewStates': dict(states), 'grouping': 'curated-song' if song_groups else 'mapset (not unique song)',
              'confidenceCounts': {tier: {layer: dict(sum((Counter(c['confidenceCounts'][tier][layer]) for c in charts), Counter()))
                                         for layer in (('source', 'foundation', 'humanContext') if tier == 'machine' else ('source', 'foundation'))}
                                   for tier in ('human', 'machine')},
              'groupCount': len(groups),
              'groupsWithHumanLabels': sum(g['human']['anyDimension']['ms'] > 0 for g in grouped),
              'groupsWithAnyLabels': sum(g['combined']['anyDimension']['ms'] > 0 for g in grouped),
              **{tier: aggregate(charts, tier) for tier in ('human', 'machineOnly', 'combined')}, 'charts': charts, 'groups': grouped}
    (args.out / 'quality.json').write_text(json.dumps(report, indent=2) + '\n')
    (args.out / 'queue.json').write_text(json.dumps({'reportSha256': digest(args.out / 'quality.json'), 'sections': batch}, indent=2) + '\n')
    by_sha = {c['sourceSha256']: c for c in charts}
    target_groups = defaultdict(list)
    for item in batch:
        target_groups[item['sourceSha256']].append(item['scope'])
    assignment = {'assignmentId': 'selected-' + digest(args.out / 'queue.json')[:16],
                  'coverageMode': 'selected-sections', 'queueSha256': digest(args.out / 'queue.json'),
                  'charts': [{'sourceSha256': sha, 'parquetPath': str((args.campaign / 'agent/charts' / f'{sha}.parquet').resolve()),
                              'parquetSha256': by_sha[sha]['parquetSha256'], 'durationMs': by_sha[sha]['durationMs'],
                              'targetRanges': ranges} for sha, ranges in sorted(target_groups.items())]}
    (args.out / 'assignment.proposed.json').write_text(json.dumps(assignment, indent=2) + '\n')
    with (args.out / 'candidates.jsonl').open('w') as file:
        for c in ranked:
            file.write(json.dumps(c, separators=(',', ':')) + '\n')
    lines = ['# Annotation coverage and next sections', '',
             f"{len(charts)} charts; {len(groups)} {report['grouping']} groups; {len(candidates)} candidate windows.", '',
             '| Coverage | Any dimension (time) | All five (time) | All five (note starts) |', '| --- | ---: | ---: | ---: |']
    for tier in ('human', 'machineOnly', 'combined'):
        value = report[tier]
        lines.append(f"| {tier} | {value['anyDimension']['timeRate']:.2%} | {value['allDimensions']['timeRate']:.2%} | {value['allDimensions']['noteRate']:.2%} |")
    lines += ['', '| Dimension | Combined time | Human time | Combined note starts |', '| --- | ---: | ---: | ---: |']
    for tag in TAGS:
        c, h = report['combined']['dimensions'][tag], report['human']['dimensions'][tag]
        lines.append(f"| {tag} | {c['timeRate']:.2%} | {h['timeRate']:.2%} | {c['noteRate']:.2%} |")
    lines += ['', '| Dimension | Machine absent / supporting / prominent | Human absent / supporting / prominent |', '| --- | ---: | ---: |']
    for tag in TAGS:
        counts = [' / '.join(str(report['labelCounts'][tier][tag].get(label, 0)) for label in ('absent', 'supporting', 'prominent')) for tier in ('machineOnly', 'human')]
        lines.append(f"| {tag} | {counts[0]} | {counts[1]} |")
    lines += ['', 'Counts deduplicate equal scoped judgments within a source after human clipping; split remnants are distinct scopes.',
              '', f"Open issues: {len(open_issues)} total; {len(selected_issue_ids)} scheduled in {report['selectionRoutes'].get('repair', 0)} repair targets; {len(report['pendingIssueIds'])} pending.",
              'Issue identities are source SHA / handoff ID / claim ID; full issue scopes and selected identities are recorded in quality.json and queue.json.',
              '', 'Pending issue IDs:', *(['- ' + i for i in report['pendingIssueIds']] or ['- None.']),
              '', '## Next batch', '', '| Chart | Scope (seconds) | Route | Issues | Leading reasons |', '| --- | --- | --- | ---: | --- |']
    for c in batch:
        chart = by_sha[c['sourceSha256']]
        title = f"{chart['title']} [{chart['difficulty']}]".replace('|', '\\|').replace('\n', ' ')
        lines.append(f"| {title} · {c['sourceSha256'][:12]} | {c['scope']['startMs']/1000:.3f}–{c['scope']['endMs']/1000:.3f} | {c['selectionRoute']} | {len(c['issueIds'])} | {', '.join(c['reasons'])} |")
    lines += ['', *['- ' + limit for limit in report['limits']], '']
    (args.out / 'report.md').write_text('\n'.join(lines))
    print(json.dumps({'output': str(args.out.resolve()), 'charts': len(charts), 'candidates': len(candidates), 'selected': len(batch)}))


if __name__ == '__main__':
    main()
