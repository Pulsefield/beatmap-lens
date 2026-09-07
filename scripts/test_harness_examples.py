"""Human-example retrieval checks using the review service's supported shapes."""
from copy import deepcopy
import unittest

import harness_examples as examples


def claim(identity='late-rhythm-tech', presence='present', salience='supporting'):
    assessment = {'presence': presence}
    if presence == 'present':
        assessment['salience'] = salience
    return {'id': identity, 'sectionId': identity, 'tagId': 'tech',
            'scope': {'startMs': 389914, 'endMs': 392610},
            'reviewContext': {'startMs': 389600, 'endMs': 392900},
            'assessment': assessment, 'rationale': 'Old machine uncertainty, not the human explanation.',
            'witnessCount': 43, 'contextNoteCount': 11}


def feedback(source='01e47b5f654875fce19ec204fb0975cbe8f4703b3d234fb2e8adeb0e2fb8c0f2'):
    # Field layout and the correction below come from the 2026-09-07 service snapshot.
    return {'sourceSha256': source, 'documentVersion': {'revision': 6, 'sha256': 'document-sha'},
            'taskBinding': {'foundationSha256': 'later-task-foundation'},
            'handoffs': [{'handoffId': 'refinement-3871bfa483b92b4af237c6b7',
                          'handoffSha256': 'handoff-sha', 'taskId': 'original-task',
                          'taskSha256': 'original-task-sha', 'foundationSha256': 'stored-human-foundation'}],
            'agentReviews': [], 'directObservations': []}


def review(value, status='accepted', identity='b1d7c360-0af8-4ba7-a632-a2f8dd936863', rationale=None):
    return {'handoffId': 'refinement-3871bfa483b92b4af237c6b7', 'claimId': value['id'],
            'status': status, 'baseStatus': 'stale', 'summary': value,
            'decision': {'id': identity, 'humanId': 'local-expert', 'disposition': status,
                         'rationale': rationale if rationale is not None else 'Human confirmed the original proposal.',
                         'observationId': identity + ':observation', 'decidedAt': '2026-09-07T03:55:55.143Z'}}


def direct(value, identity='direct-observation'):
    return {'id': identity, 'humanId': 'local-expert', 'foundationSha256': 'direct-foundation',
            'confirmedAt': '2026-09-07T04:00:00Z', 'origin': {'kind': 'direct-human'}, 'summary': value}


def pool():
    values = []
    for label in examples.LABELS:
        for index in range(3):
            source = f'{label}-{index}'
            data = feedback(source)
            value = claim(source, 'absent' if label == 'absent' else 'present', label)
            data['agentReviews'] = [review(value, identity=source, rationale=f'{label} familiar flow {index}.')]
            values.append(data)
    return examples.extract_examples(values, {'absent-0': 'song-a', 'supporting-0': 'song-a'})


class ExtractionTest(unittest.TestCase):
    def test_modified_scope_assessment_and_exact_human_rationale_override_old_claim(self):
        data = feedback()
        original = claim()
        original['scope'] = {'startMs': 380000, 'endMs': 400000}
        corrected = claim(presence='absent')
        corrected.pop('rationale')
        corrected['evidence'] = {
            'rationale': 'The earlier machine still asks whether this is weak Tech.',
            'noteRefs': [{'sourceLine': 5355, 'column': 0, 'kind': 'normal',
                          'startMs': 389914, 'endMs': 389914}], 'contextNoteRefs': []}
        row = review(original, 'modified', rationale="it's handstream with direction/flow alternation.")
        row['modifiedClaim'] = corrected
        data['agentReviews'] = [row]
        before = deepcopy(data)
        record, = examples.extract_examples([data], {data['sourceSha256']: 'mapset-1'})
        self.assertEqual(record['assessment'], {'presence': 'absent'})
        self.assertEqual(record['scope'], corrected['scope'])
        self.assertEqual(record['reviewContext'], corrected['reviewContext'])
        self.assertEqual(record['rationale'], "it's handstream with direction/flow alternation.")
        self.assertEqual(record['rationaleOrigin'], 'decision.rationale')
        self.assertEqual(record['groupId'], 'mapset-1')
        self.assertEqual(record['provenance']['foundationSha256'], 'stored-human-foundation')
        self.assertEqual(record['provenance']['decisionId'], row['decision']['id'])
        self.assertEqual(record['provenance']['handoffSha256'], 'handoff-sha')
        self.assertEqual(record['sourceEvidence']['noteRefs'], corrected['evidence']['noteRefs'])
        self.assertNotIn('rationale', record['sourceEvidence'])
        self.assertEqual(data, before)

    def test_confirmation_is_literal_even_when_machine_base_is_now_stale(self):
        data = feedback()
        data['agentReviews'] = [review(claim())]
        record, = examples.extract_examples([data], {})
        self.assertEqual(record['rationale'], 'Human confirmed the original proposal.')
        self.assertEqual(record['sourceEvidence'], {'witnessCount': 43, 'contextNoteCount': 11})
        self.assertEqual(record['groupId'], data['sourceSha256'])
        self.assertNotIn('Old machine uncertainty', str(record))

    def test_rejection_deferral_machine_and_superseded_records_are_not_human_labels(self):
        data = feedback()
        data['agentReviews'] = [review(claim(status), status, identity=status)
                                for status in ('rejected', 'deferred', 'superseded', 'agent-reviewed', 'needs-expert')]
        data['agentReviews'].append(review(claim('pending', presence='unresolved')))
        data['directObservations'] = [direct(claim(presence='unreviewed'))]
        self.assertEqual(examples.extract_examples([data], {}), [])

    def test_direct_observation_summary_and_full_claim_keep_their_own_authority(self):
        data = feedback()
        summary = claim('direct-summary', presence='absent')
        summary['rationale'] = 'Familiar direction changes preserve the flow.'
        full = claim('direct-full', salience='prominent')
        full.pop('rationale')
        full['evidence'] = {'rationale': 'Internal relationships change across the repeating group.',
                            'noteRefs': [], 'contextNoteRefs': []}
        first = direct(summary, 'summary-human')
        second = direct(full, 'full-human')
        second['claim'] = second.pop('summary')
        data['directObservations'] = [first, second]
        result = {row['provenance']['observationId']: row for row in examples.extract_examples([data], {})}
        self.assertEqual(result['summary-human']['rationale'], summary['rationale'])
        self.assertEqual(result['full-human']['rationale'], full['evidence']['rationale'])
        self.assertEqual(result['summary-human']['rationaleOrigin'], 'directObservation.summary.rationale')
        self.assertEqual(result['full-human']['rationaleOrigin'], 'directObservation.claim.evidence.rationale')
        self.assertTrue(all(row['provenance']['foundationSha256'] == 'direct-foundation' for row in result.values()))


class SearchTest(unittest.TestCase):
    def test_first_page_balances_labels_and_pagination_visits_each_record_once(self):
        records = pool()
        first = examples.search_examples(records)
        self.assertEqual([examples._label(row) for row in first['cards']], list(examples.LABELS))
        self.assertEqual(first['nextOffset'], 3)
        self.assertEqual(first['total'], 9)
        second = examples.search_examples(records, offset=first['nextOffset'])
        third = examples.search_examples(records, offset=second['nextOffset'])
        visited = [row['id'] for page in (first, second, third) for row in page['cards']]
        self.assertEqual(len(set(visited)), 9)
        self.assertIsNone(third['nextOffset'])
        self.assertEqual(examples.search_examples(list(reversed(records))), first)

    def test_cards_are_bounded_and_full_rationale_is_retrieved_on_demand(self):
        records = pool()
        target = records[0]
        target['rationale'] = '区域中的节奏关系 ' * 100
        target['sourceEvidence'] = {'noteRefs': [{'sourceLine': number} for number in range(1000)]}
        first = examples.search_examples(records, limit=100)
        self.assertEqual(len(first['cards']), examples.MAX_CARDS)
        self.assertEqual(first['limit'], examples.MAX_CARDS)
        card, = examples.search_examples(records, text='区域中的节奏关系')['cards']
        self.assertEqual(card['rationale'], target['rationale'][:examples.RATIONALE_CHARS])
        self.assertTrue(card['rationaleTruncated'])
        self.assertNotIn('sourceEvidence', card)
        self.assertNotIn('provenance', card)
        retrieved = examples.get_example(records, target['id'])
        self.assertEqual(retrieved, target)
        retrieved['rationale'] = 'Must not mutate the frozen library.'
        self.assertNotEqual(retrieved, target)

    def test_filters_are_literal_and_do_not_infer_other_dimension_labels(self):
        records = pool()
        result = examples.search_examples(records, assessment='supporting', text='FAMILIAR flow')
        self.assertEqual(result['total'], 3)
        self.assertTrue(all(examples._label(row) == 'supporting' for row in result['cards']))
        self.assertEqual(examples.search_examples(records, assessment='present')['total'], 6)
        self.assertEqual(examples.search_examples(records, text='familiar displaced')['total'], 0)
        self.assertEqual(examples.search_examples(records, tag_id='trill-organization')['total'], 0)

    def test_exclusions_hold_out_entire_sources_and_song_groups_in_search_and_get(self):
        records = pool()
        excluded = {'excluded_sources': ('prominent-1',), 'excluded_groups': ('song-a',)}
        result = examples.search_examples(records, limit=6, **excluded)
        self.assertEqual(result['total'], 6)
        self.assertIsNone(result['nextOffset'])
        self.assertTrue(all(row['sourceSha256'] not in ('absent-0', 'supporting-0', 'prominent-1')
                            for row in result['cards']))
        for record in records:
            value = examples.get_example(records, record['id'], **excluded)
            if record['groupId'] == 'song-a' or record['sourceSha256'] == 'prominent-1':
                self.assertIsNone(value)
            else:
                self.assertEqual(value, record)
        self.assertIsNone(examples.get_example(records, 'unknown-example'))


if __name__ == '__main__':
    unittest.main()
