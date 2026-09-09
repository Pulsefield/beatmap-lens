"""Scoped human examples, with bounded discovery and explicit full-record retrieval.

Search interleaves available labels and uses literal keywords, not relevance ranking.
The caller supplies the immutable feedback snapshot and evaluation exclusions.
"""
from collections import defaultdict
from copy import deepcopy
import hashlib
from itertools import zip_longest

from playback_rate import normalize_playback_rate, playback_rate_fields


LABELS = ('absent', 'supporting', 'prominent')
MAX_CARDS = 6
RATIONALE_CHARS = 280
HUMAN_COMMENT_ORIGINS = ('decision.rationale', 'directObservation.claim.evidence.rationale',
                         'directObservation.summary.rationale', 'effectiveHumanObservation.humanComment')


def _label(record):
    assessment = record['assessment']
    return assessment.get('salience') if assessment['presence'] == 'present' else assessment['presence']


def _record(feedback, groups, claim, identity, rationale, origin, provenance):
    source = feedback['sourceSha256']
    return deepcopy({
        'id': 'human-' + hashlib.sha256(f'{source}\0{identity}'.encode()).hexdigest()[:24],
        'sourceSha256': source,
        'groupId': groups.get(source, source),
        **{key: claim[key] for key in ('tagId', 'assessment', 'scope', 'reviewContext')},
        **playback_rate_fields(claim),
        'rationale': rationale,
        'rationaleOrigin': origin,
        'provenance': {**provenance, 'documentVersion': feedback.get('documentVersion')},
    })


def extract_examples(feedbacks, source_groups):
    """Keep settled human labels and exact human rationale; rejection is not absence.

    A human-confirmed claim stays authoritative if its machine task base later
    becomes stale. Its Foundation comes from its own handoff, not the latest task.
    """
    records = []
    for feedback in feedbacks:
        handoffs = {row['handoffId']: row for row in feedback.get('handoffs', [])}
        if 'effectiveHumanObservations' in feedback:
            # The service resolves append-only revisions. Never reintroduce an old
            # accepted proposal or direct observation from its history collections.
            decisions = {row['decision']['observationId']: row for row in feedback.get('agentReviews', [])
                         if row.get('decision', {}).get('observationId')}
            for observation in feedback['effectiveHumanObservations']:
                trust = observation.get('trust', {})
                if any(trust.get(layer, 'current') != 'current' for layer in ('source', 'foundation')):
                    continue
                claim = observation.get('claim', observation.get('summary'))
                if claim['assessment']['presence'] not in ('present', 'absent'):
                    continue
                provenance = {key: observation[key] for key in
                              ('humanId', 'confirmedAt', 'foundationSha256', 'observationSha256')
                              if key in observation}
                provenance.update(observationId=observation['id'], claimId=claim['id'])
                identity = observation['id']
                review = decisions.get(identity)
                if review:
                    decision = review['decision']
                    identity = decision['id']
                    handoff = handoffs[review['handoffId']]
                    provenance.update({key: handoff[key] for key in
                                       ('handoffId', 'handoffSha256', 'taskId', 'taskSha256') if key in handoff})
                    provenance.update({key: decision[key] for key in ('disposition', 'decidedAt') if key in decision})
                    provenance['decisionId'] = decision['id']
                else:
                    provenance['disposition'] = 'direct-human'
                records.append(_record(feedback, source_groups, claim, identity,
                                       observation['humanComment'], 'effectiveHumanObservation.humanComment', provenance))
            continue
        for review in feedback.get('agentReviews', []):
            if review['status'] not in ('accepted', 'modified'):
                continue
            claim = review['modifiedClaim'] if review['status'] == 'modified' else review['summary']
            if claim['assessment']['presence'] not in ('present', 'absent'):
                continue
            decision = review['decision']
            handoff = handoffs[review['handoffId']]
            provenance = {key: handoff[key] for key in
                          ('handoffId', 'handoffSha256', 'taskId', 'taskSha256', 'foundationSha256')
                          if key in handoff}
            provenance.update({key: decision[key] for key in
                               ('observationId', 'humanId', 'disposition', 'decidedAt') if key in decision})
            provenance.update(decisionId=decision['id'], claimId=review['claimId'])
            observation_sha = decision.get('observationSha256', review.get('observationSha256'))
            if observation_sha:
                provenance['observationSha256'] = observation_sha
            records.append(_record(feedback, source_groups, claim, decision['id'],
                                   decision['rationale'], 'decision.rationale', provenance))
        for observation in feedback.get('directObservations', []):
            claim = observation.get('claim', observation.get('summary'))
            if claim['assessment']['presence'] not in ('present', 'absent'):
                continue
            rationale = claim['evidence']['rationale'] if 'evidence' in claim else claim['rationale']
            origin = ('directObservation.claim.evidence.rationale' if 'evidence' in claim else
                      'directObservation.summary.rationale')
            provenance = {key: observation[key] for key in ('humanId', 'confirmedAt', 'foundationSha256')}
            provenance.update(observationId=observation['id'], claimId=claim['id'], disposition='direct-human')
            if observation.get('observationSha256'):
                provenance['observationSha256'] = observation['observationSha256']
            records.append(_record(feedback, source_groups, claim, observation['id'], rationale, origin, provenance))
    return sorted(records, key=lambda record: record['id'])


def evidence_ref(record):
    """Bind a human example to its full canonical observation, when available.

    Legacy compact feedback cannot reproduce the canonical observation hash, so
    it must remain untracked instead of hashing a lossy summary as if equivalent.
    """
    provenance = record['provenance']
    if not provenance.get('observationId') or not provenance.get('observationSha256'):
        return None
    return {'sourceSha256': record['sourceSha256'],
            **{key: provenance[key] for key in ('observationId', 'observationSha256')}}


def _allowed(record, excluded_sources, excluded_groups):
    return record['sourceSha256'] not in excluded_sources and record['groupId'] not in excluded_groups


def _human_comment(record):
    comment = record.get('humanComment')
    if 'humanComment' not in record and record.get('rationaleOrigin') in HUMAN_COMMENT_ORIGINS:
        comment = record.get('rationale')
    if not comment or not comment.strip(' \t\r\n/') or comment.strip() == 'Human confirmed the original proposal.':
        return None
    return comment


def public_example(record, comment_chars=None):
    """Project an extracted record or prior projection to judgment + human comment."""
    result = {key: record[key] for key in ('id', 'sourceSha256', 'tagId')}
    result.update(playback_rate_fields(record))
    result['assessment'] = {key: record['assessment'][key] for key in ('presence', 'salience')
                            if key in record['assessment']}
    for key in ('scope', 'reviewContext'):
        result[key] = {bound: record[key][bound] for bound in ('startMs', 'endMs')}
    comment = _human_comment(record)
    if comment is not None:
        result['humanComment'] = comment if comment_chars is None else comment[:comment_chars]
        if comment_chars is not None:
            result['humanCommentTruncated'] = bool(record.get('humanCommentTruncated')) or len(comment) > comment_chars
        elif record.get('humanCommentTruncated'):
            result['humanCommentTruncated'] = True
    return deepcopy(result)


def filter_contrast_sets(contrast_sets, records):
    """Keep only available members; never advertise an empty or excluded-only set."""
    allowed_ids = {record['id'] for record in records}
    result = []
    for item in contrast_sets:
        members = [identity for identity in item['exampleIds'] if identity in allowed_ids]
        if members:
            result.append({'id': item['id'], 'description': item['description'], 'exampleIds': members})
    return result


def _assessment_counts(records):
    counts = dict.fromkeys(LABELS, 0)
    for record in records:
        counts[_label(record)] += 1
    return counts


def search_examples(records, tag_id='tech', assessment=None, text='', offset=0, limit=3,
                    excluded_sources=(), excluded_groups=(), contrast_sets=(), contrast_set=None, playback_rate=None):
    """Return at most six cards, with no note arrays or full provenance.

    Assessment accepts absent, supporting, prominent, or present. Keywords match
    substantive human comments and title/difficulty identity metadata, never
    machine reasoning or evidence.
    Results interleave matching labels deterministically, without promising all
    three labels. Curated sets intersect normal filters; available set descriptors
    ignore assessment/text but respect tag and evaluation exclusions.
    """
    if assessment not in (None, 'present', *LABELS):
        raise ValueError('assessment must be absent, supporting, prominent, or present')
    if offset < 0 or limit < 1:
        raise ValueError('offset must be nonnegative and limit positive')
    limit = min(limit, MAX_CARDS)
    rate = normalize_playback_rate(playback_rate) if playback_rate is not None else None
    allowed = [record for record in records if record['tagId'] == tag_id
               and _allowed(record, excluded_sources, excluded_groups)
               and (rate is None or normalize_playback_rate(record.get('playbackRate')) == rate)]
    sets = filter_contrast_sets(contrast_sets, allowed)
    available_sets = [
        {'id': item['id'],
         'assessmentCounts': _assessment_counts(record for record in allowed if record['id'] in item['exampleIds'])}
        for item in sets]
    if contrast_set is not None:
        selected = next((item for item in sets if item['id'] == contrast_set), None)
        if selected is None:
            raise ValueError('Contrast set is unavailable in this job/tag. Use availableContrastSets from find_human_examples.')
        allowed = [record for record in allowed if record['id'] in selected['exampleIds']]
    terms = text.casefold().split()
    buckets = defaultdict(list)
    for record in sorted(allowed, key=lambda row: row['id']):
        if assessment and assessment not in (_label(record), record['assessment']['presence']):
            continue
        searchable = ' '.join([_human_comment(record) or '',
                               *(str(record.get(key, '')) for key in ('title', 'difficulty'))]).casefold()
        if not all(term in searchable for term in terms):
            continue
        buckets[_label(record)].append(record)
    ordered = [record for row in zip_longest(*(buckets[label] for label in LABELS))
               for record in row if record is not None]
    cards = [public_example(record, RATIONALE_CHARS) for record in ordered[offset:offset + limit]]
    counts = _assessment_counts(ordered)
    result = {'cards': cards, 'total': len(ordered), 'limit': limit,
              'nextOffset': offset + len(cards) if offset + len(cards) < len(ordered) else None,
              'order': 'label-interleaved-then-id', 'matchedAssessmentCounts': counts,
              'missingContrastLabels': [label for label, count in counts.items() if not count],
              'availableContrastSets': available_sets}
    if rate is not None:
        result['playbackRateFilter'] = rate
    if rate is not None or any(normalize_playback_rate(record.get('playbackRate')) != 1 for record in ordered):
        result['playbackRateMeaning'] = ('Each judgment applies only at its own playbackRate; omitted means 1x. '
                                         'A judgment at another rate is a comparison, never target gold.')
    if assessment or terms or contrast_set is not None or result['missingContrastLabels']:
        result['contrastCaveat'] = ('Counts cover all matches, not just this page. Filters and exclusions may leave '
                                    'one-sided results; missing labels are not evidence of style absence. '
                                    'Available sets are curated comparisons before assessment/text filters, not relevance rankings.')
    return deepcopy(result)


def get_example(records, example_id, excluded_sources=(), excluded_groups=()):
    """Return only the final human judgment and optional comment, or None if held out."""
    for record in records:
        if record['id'] == example_id and _allowed(record, excluded_sources, excluded_groups):
            return public_example(record)
    return None
