"""Scoped human examples, with bounded discovery and explicit full-record retrieval.

Search uses label balancing and literal keywords, not semantic relevance ranking.
The caller supplies the immutable feedback snapshot and evaluation exclusions.
"""
from collections import defaultdict
from copy import deepcopy
import hashlib
from itertools import zip_longest


LABELS = ('absent', 'supporting', 'prominent')
MAX_CARDS = 6
RATIONALE_CHARS = 280


def _label(record):
    assessment = record['assessment']
    return assessment.get('salience') if assessment['presence'] == 'present' else assessment['presence']


def _record(feedback, groups, claim, identity, rationale, origin, provenance):
    source = feedback['sourceSha256']
    evidence = claim.get('evidence')
    source_evidence = ({key: evidence[key] for key in ('noteRefs', 'contextNoteRefs')}
                       if evidence is not None else
                       {key: claim[key] for key in ('witnessCount', 'contextNoteCount') if key in claim})
    return deepcopy({
        'id': 'human-' + hashlib.sha256(f'{source}\0{identity}'.encode()).hexdigest()[:24],
        'sourceSha256': source,
        'groupId': groups.get(source, source),
        **{key: claim[key] for key in ('tagId', 'assessment', 'scope', 'reviewContext')},
        'rationale': rationale,
        'rationaleOrigin': origin,
        'provenance': {**provenance, 'documentVersion': feedback.get('documentVersion')},
        'sourceEvidence': source_evidence,
    })


def extract_examples(feedbacks, source_groups):
    """Keep settled human labels and exact human rationale; rejection is not absence.

    A human-confirmed claim stays authoritative if its machine task base later
    becomes stale. Its Foundation comes from its own handoff, not the latest task.
    """
    records = []
    for feedback in feedbacks:
        handoffs = {row['handoffId']: row for row in feedback.get('handoffs', [])}
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
            records.append(_record(feedback, source_groups, claim, observation['id'], rationale, origin, provenance))
    return sorted(records, key=lambda record: record['id'])


def _allowed(record, excluded_sources, excluded_groups):
    return record['sourceSha256'] not in excluded_sources and record['groupId'] not in excluded_groups


def search_examples(records, tag_id='tech', assessment=None, text='', offset=0, limit=3,
                    excluded_sources=(), excluded_groups=()):
    """Return at most six cards, with no note arrays or full provenance.

    Assessment accepts absent, supporting, prominent, or present. Keywords match
    exact human rationale plus optional caller-added title/difficulty metadata.
    Unfiltered results interleave the three labels deterministically so a first
    page can show contrasting examples. Exclusions apply before totals or paging.
    """
    if assessment not in (None, 'present', *LABELS):
        raise ValueError('assessment must be absent, supporting, prominent, or present')
    if offset < 0 or limit < 1:
        raise ValueError('offset must be nonnegative and limit positive')
    limit = min(limit, MAX_CARDS)
    terms = text.casefold().split()
    buckets = defaultdict(list)
    for record in sorted(records, key=lambda row: row['id']):
        if not _allowed(record, excluded_sources, excluded_groups) or record['tagId'] != tag_id:
            continue
        if assessment and assessment not in (_label(record), record['assessment']['presence']):
            continue
        searchable = ' '.join(str(record.get(key, '')) for key in ('rationale', 'title', 'difficulty')).casefold()
        if not all(term in searchable for term in terms):
            continue
        buckets[_label(record)].append(record)
    ordered = [record for row in zip_longest(*(buckets[label] for label in LABELS))
               for record in row if record is not None]
    cards = []
    for record in ordered[offset:offset + limit]:
        rationale = record['rationale']
        card = {key: record[key] for key in
                ('id', 'sourceSha256', 'groupId', 'tagId', 'assessment', 'scope', 'rationaleOrigin')}
        card.update(rationale=rationale[:RATIONALE_CHARS], rationaleTruncated=len(rationale) > RATIONALE_CHARS)
        cards.append(card)
    return deepcopy({'cards': cards, 'total': len(ordered), 'limit': limit,
                     'nextOffset': offset + len(cards) if offset + len(cards) < len(ordered) else None,
                     'order': 'label-balanced-then-id'})


def get_example(records, example_id, excluded_sources=(), excluded_groups=()):
    """Return the full exact human record, or None, including for held-out records."""
    for record in records:
        if record['id'] == example_id and _allowed(record, excluded_sources, excluded_groups):
            return deepcopy(record)
    return None
