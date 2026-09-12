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
    def test_current_observation_confidence_is_explicit_and_never_inherited_from_claim_or_history(self):
        data = feedback()
        row = review(claim())
        row['decision']['confidence'] = 'high'
        data['agentReviews'] = [row]
        observation = {**direct(claim(), row['decision']['observationId']),
                       'humanComment': 'Revised human judgment.', 'confidence': 'low'}
        observation['summary'].update(confidence='high', agentConfidence='high')
        data['effectiveHumanObservations'] = [observation]
        record, = examples.extract_examples([data], {})
        self.assertEqual(examples.public_example(record)['humanConfidence'], 'low')
        self.assertEqual(examples.get_example([record], record['id'])['humanConfidence'], 'low')
        self.assertEqual(examples.search_examples([record])['cards'][0]['humanConfidence'], 'low')
        observation.pop('confidence')
        record, = examples.extract_examples([data], {})
        self.assertNotIn('humanConfidence', examples.public_example(record))

    def test_legacy_explicit_human_confidence_survives_without_promoting_agent_fields(self):
        data = feedback()
        row = review(claim())
        row['decision']['confidence'] = 'high'
        observation = direct(claim(), 'direct-low')
        observation['confidence'] = 'low'
        data.update(agentReviews=[row], directObservations=[observation])
        records = examples.extract_examples([data], {})
        self.assertEqual({record['humanConfidence'] for record in records}, {'high', 'low'})

    def test_effective_gold_excludes_append_only_history_and_preserves_current_human_comment(self):
        data = feedback()
        old = review(claim(), rationale='Old human explanation.')
        data['agentReviews'] = [old]
        data['directObservations'] = [direct(claim('old-direct'))]
        revised = direct(claim('new-direct', presence='absent'), 'revised-observation')
        revised.update(observationSha256='a' * 64, humanComment='  Revised human words.\nExact spacing.  ')
        data['effectiveHumanObservations'] = [revised]
        record, = examples.extract_examples([data], {})
        self.assertEqual(record['assessment'], {'presence': 'absent'})
        self.assertEqual(examples.public_example(record)['humanComment'], revised['humanComment'])
        self.assertEqual(examples.evidence_ref(record), {'sourceSha256': data['sourceSha256'],
                         'observationId': revised['id'], 'observationSha256': 'a' * 64})
        data['effectiveHumanObservations'] = []
        self.assertEqual(examples.extract_examples([data], {}), [])

    def test_effective_agent_gold_retains_existing_example_handle_and_observation_binding(self):
        data = feedback()
        row = review(claim(), rationale='  Exact human comment.  ')
        data['agentReviews'] = [row]
        legacy, = examples.extract_examples([data], {})
        self.assertIsNone(examples.evidence_ref(legacy))
        data['effectiveHumanObservations'] = [{
            'id': row['decision']['observationId'], 'summary': row['summary'],
            'humanId': row['decision']['humanId'], 'confirmedAt': row['decision']['decidedAt'],
            'foundationSha256': 'stored-human-foundation', 'observationSha256': 'b' * 64,
            'humanComment': row['decision']['rationale'],
            'origin': {'kind': 'agent-proposal', 'handoffId': row['handoffId'], 'claimId': row['claimId']}}]
        current, = examples.extract_examples([data], {})
        self.assertEqual(examples.public_example(current), examples.public_example(legacy))
        self.assertEqual(current['provenance']['decisionId'], row['decision']['id'])
        self.assertEqual(examples.evidence_ref(current)['observationSha256'], 'b' * 64)

    def test_effective_gold_with_changed_source_or_foundation_is_not_a_current_harness_example(self):
        data = feedback()
        observation = {**direct(claim()), 'humanComment': 'Current expert judgment.',
                       'observationSha256': 'c' * 64, 'trust': {'source': 'current', 'foundation': 'current'}}
        data['effectiveHumanObservations'] = [observation]
        current, = examples.extract_examples([data], {})
        self.assertEqual(current['provenance']['foundationSha256'], observation['foundationSha256'])
        for layer in ('source', 'foundation'):
            with self.subTest(layer=layer):
                changed = deepcopy(data)
                changed['effectiveHumanObservations'][0]['trust'][layer] = 'changed'
                self.assertEqual(examples.extract_examples([changed], {}), [])

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
        self.assertNotIn('sourceEvidence', record)
        self.assertEqual(data, before)

    def test_confirmation_is_literal_even_when_machine_base_is_now_stale(self):
        data = feedback()
        data['agentReviews'] = [review(claim())]
        record, = examples.extract_examples([data], {})
        self.assertEqual(record['rationale'], 'Human confirmed the original proposal.')
        self.assertNotIn('sourceEvidence', record)
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


class PublicExampleTest(unittest.TestCase):
    def test_public_judgment_allowlist_excludes_machine_fields_and_preserves_exact_human_comment(self):
        record = pool()[0]
        record['rationale'] = '  Human explanation.\nExact wording.  '
        record.update(agentComment='machine-only-comment', evidence={'text': 'machine-only-evidence'},
                      proposal={'text': 'machine-only-proposal'}, audit='machine-only-audit',
                      arbitraryFutureField={'text': 'machine-only-future'})
        record['sourceEvidence'] = {'agentRationale': 'machine-only-source-evidence'}
        record['assessment']['agentRationale'] = 'machine-only-assessment'
        record['scope']['agentRationale'] = 'machine-only-scope'
        record['reviewContext']['agentRationale'] = 'machine-only-context'
        before = deepcopy(record)
        value = examples.public_example(record)
        self.assertEqual(value['humanComment'], record['rationale'])
        self.assertEqual(set(value), {'id', 'sourceSha256', 'tagId', 'assessment', 'scope', 'reviewContext', 'humanComment'})
        self.assertNotIn('machine-only', str(value))
        self.assertEqual(examples.public_example(value), value)
        self.assertEqual(record, before)
        card, = examples.search_examples([record])['cards']
        self.assertNotIn('machine-only', str(card))
        self.assertNotIn('provenance', card)
        self.assertNotIn('rationale', card)
        self.assertEqual(examples.search_examples([record], text='machine-only')['total'], 0)
        value['scope']['startMs'] = 0
        self.assertEqual(record, before)

    def test_unattributed_rationale_is_never_promoted_to_a_human_comment(self):
        record = pool()[0]
        record.pop('rationaleOrigin')
        record['rationale'] = 'Unattributed machine explanation.'
        for value in (examples.public_example(record), examples.get_example([record], record['id']),
                      examples.search_examples([record])['cards'][0]):
            self.assertNotIn('humanComment', value)
            self.assertNotIn('Unattributed', str(value))
        self.assertEqual(examples.search_examples([record], text='Unattributed')['total'], 0)

    def test_no_comment_judgments_remain_visible_without_substituting_machine_rationale(self):
        for comment in ('Human confirmed the original proposal.', '/', ' / /\n', '', ' \t\n'):
            with self.subTest(comment=comment):
                data = feedback()
                data['agentReviews'] = [review(claim(), rationale=comment)]
                record, = examples.extract_examples([data], {})
                self.assertEqual(record['rationale'], comment)
                value = examples.public_example(record)
                card, = examples.search_examples([record])['cards']
                for public in (value, card):
                    self.assertEqual(public['assessment'], {'presence': 'present', 'salience': 'supporting'})
                    self.assertNotIn('humanComment', public)
                    self.assertNotIn('humanCommentTruncated', public)
                    self.assertNotIn('Old machine uncertainty', str(public))
                self.assertEqual(examples.search_examples([record], text='confirmed')['total'], 0)
                self.assertEqual(examples.public_example(value), value)


class SourceFactsTest(unittest.TestCase):
    def test_facts_cover_exact_scope_heads_chords_and_entering_holds_without_style_labels(self):
        notes = [{'sourceLine': 1, 'column': 0, 'kind': 'long', 'startMs': 0, 'endMs': 200},
                 {'sourceLine': 2, 'column': 1, 'kind': 'normal', 'startMs': 100, 'endMs': 100},
                 {'sourceLine': 3, 'column': 2, 'kind': 'normal', 'startMs': 100, 'endMs': 100},
                 {'sourceLine': 4, 'column': 3, 'kind': 'long', 'startMs': 150, 'endMs': 250},
                 {'sourceLine': 5, 'column': 0, 'kind': 'normal', 'startMs': 200, 'endMs': 200}]
        facts = examples.source_facts(notes, {'startMs': 100, 'endMs': 200}, 4)
        self.assertEqual(facts, {'keyCount': 4, 'noteKind': 'with-ln', 'attackRowCount': 2,
                                'tapCount': 2, 'longNoteHeadCount': 1, 'enteringHoldCount': 1,
                                'chordSizeCounts': [(1, 1), (2, 1)]})
        for start, end, kind, entering in ((10, 20, 'with-ln', 1), (250, 300, 'empty', 0),
                                         (200, 201, 'with-ln', 1), (100, 101, 'with-ln', 1)):
            with self.subTest(start=start, end=end):
                value = examples.source_facts(notes, {'startMs': start, 'endMs': end}, 4)
                self.assertEqual(value['noteKind'], kind)
                self.assertEqual(value['enteringHoldCount'], entering)
        taps = [note for note in notes if note['kind'] == 'normal']
        self.assertEqual(examples.source_facts(taps, {'startMs': 100, 'endMs': 200}, 4)['noteKind'], 'tap-only')


class SearchTest(unittest.TestCase):
    def test_confidence_filters_keep_unset_distinct_and_counts_respect_exclusions(self):
        records = pool()
        for index, record in enumerate(records):
            if index % 3 != 2:
                record['humanConfidence'] = ('high', 'low')[index % 3]
        high = examples.search_examples(records, confidence='high', text='familiar', excluded_sources=[records[0]['sourceSha256']])
        self.assertEqual(high['availableConfidenceCounts'], {'high': 2, 'low': 3, 'unspecified': 3})
        self.assertEqual(high['matchedConfidenceCounts'], {'high': 2, 'low': 0, 'unspecified': 0})
        self.assertTrue(all(card['humanConfidence'] == 'high' for card in high['cards']))
        unset = examples.search_examples(records, confidence='unspecified')
        self.assertEqual(unset['total'], 3)
        self.assertTrue(all('humanConfidence' not in card for card in unset['cards']))
        missed = examples.search_examples(records, confidence='high', text='no matching words')
        self.assertEqual(missed['matchedConfidenceCounts'], dict.fromkeys(examples.CONFIDENCES, 0))
        self.assertEqual(missed['availableConfidenceCounts'], dict.fromkeys(examples.CONFIDENCES, 3))

    def test_factual_filters_do_not_treat_missing_facts_or_empty_scopes_as_tap_only(self):
        records = pool()[:4]
        for record, notes, key_count in zip(records, ([{'kind': 'normal', 'startMs': 1, 'endMs': 1}],
                                                    [{'kind': 'long', 'startMs': -1, 'endMs': 2}], []), (4, 7, 4)):
            record['sourceFacts'] = examples.source_facts(notes, {'startMs': 0, 'endMs': 2}, key_count)
        tap, = examples.search_examples(records, note_kind='tap-only')['cards']
        self.assertEqual(tap['id'], records[0]['id'])
        hold, = examples.search_examples(records, note_kind='with-ln', key_count=7)['cards']
        self.assertEqual(hold['sourceFacts']['longNoteHeadCount'], 0)
        self.assertEqual(hold['sourceFacts']['enteringHoldCount'], 1)
        self.assertEqual(examples.search_examples(records, note_kind='with-ln', key_count=4)['total'], 0)
        self.assertEqual(examples.search_examples(records, key_count=4)['total'], 2)

    def test_first_page_balances_labels_and_pagination_visits_each_record_once(self):
        records = pool()
        first = examples.search_examples(records)
        self.assertEqual([examples._label(row) for row in first['cards']], list(examples.LABELS))
        self.assertEqual(first['nextOffset'], 3)
        self.assertEqual(first['total'], 9)
        self.assertEqual(first['matchedAssessmentCounts'], {'absent': 3, 'supporting': 3, 'prominent': 3})
        self.assertEqual(first['missingContrastLabels'], [])
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
        self.assertEqual(card['humanComment'], target['rationale'][:examples.RATIONALE_CHARS])
        self.assertTrue(card['humanCommentTruncated'])
        full = examples.public_example(target)
        self.assertEqual(full['humanComment'], target['rationale'])
        self.assertNotIn('humanCommentTruncated', full)
        self.assertNotIn('sourceEvidence', card)
        self.assertNotIn('provenance', card)
        retrieved = examples.get_example(records, target['id'])
        self.assertEqual(retrieved, full)
        retrieved['humanComment'] = 'Must not mutate the frozen library.'
        self.assertEqual(target['rationale'], '区域中的节奏关系 ' * 100)

    def test_filters_are_literal_and_do_not_infer_other_dimension_labels(self):
        records = pool()
        result = examples.search_examples(records, assessment='supporting', text='FAMILIAR flow')
        self.assertEqual(result['total'], 3)
        self.assertTrue(all(examples._label(row) == 'supporting' for row in result['cards']))
        self.assertEqual(examples.search_examples(records, assessment='present')['total'], 6)
        self.assertEqual(examples.search_examples(records, text='familiar displaced')['total'], 0)
        self.assertEqual(examples.search_examples(records, tag_id='trill-organization')['total'], 0)
        records[0].update(title='Identity Title', difficulty='Identity Difficulty', rationale='/')
        self.assertEqual(examples.search_examples(records, text='Identity Title Difficulty')['total'], 1)

    def test_one_sided_keyword_results_expose_missing_labels_without_adding_unmatched_cards(self):
        result = examples.search_examples(pool(), text='absent', limit=1)
        self.assertEqual(result['total'], 3)
        self.assertEqual(len(result['cards']), 1)
        self.assertEqual(result['matchedAssessmentCounts'], {'absent': 3, 'supporting': 0, 'prominent': 0})
        self.assertEqual(result['missingContrastLabels'], ['supporting', 'prominent'])
        self.assertEqual(result['order'], 'label-interleaved-then-id')
        self.assertIn('one-sided', result['contrastCaveat'])
        empty = examples.search_examples(pool(), text='no matching human words')
        self.assertEqual(empty['cards'], [])
        self.assertEqual(empty['missingContrastLabels'], list(examples.LABELS))

    def test_curated_membership_intersects_filters_and_discovery_preserves_exact_rationale(self):
        records = pool()
        members = [record for record in records if record['sourceSha256'].endswith('-0')]
        sets = [{'id': 'flow-comparison', 'description': 'Compare familiar flow expression.',
                 'exampleIds': [record['id'] for record in members]}]
        selected = examples.search_examples(records, contrast_sets=sets, contrast_set='flow-comparison')
        self.assertEqual({card['id'] for card in selected['cards']}, set(sets[0]['exampleIds']))
        self.assertEqual(selected['matchedAssessmentCounts'], dict.fromkeys(examples.LABELS, 1))
        filtered = examples.search_examples(records, contrast_sets=sets, contrast_set='flow-comparison',
                                             assessment='supporting', text='familiar')
        card, = filtered['cards']
        original = next(record for record in members if record['id'] == card['id'])
        self.assertEqual(card['humanComment'], original['rationale'])
        self.assertEqual(filtered['matchedAssessmentCounts'], {'absent': 0, 'supporting': 1, 'prominent': 0})
        self.assertEqual(filtered['availableContrastSets'], selected['availableContrastSets'])
        self.assertNotIn('exampleIds', str(selected['availableContrastSets']))
        self.assertNotIn('description', str(selected['availableContrastSets']))
        missed = examples.search_examples(records, contrast_sets=sets, text='unmatched words')
        self.assertEqual(missed['cards'], [])
        self.assertEqual(missed['availableContrastSets'], selected['availableContrastSets'])
        self.assertEqual(examples.search_examples(records, contrast_sets=sets,
                                                 tag_id='ln-coordination')['availableContrastSets'], [])

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
                self.assertEqual(value, examples.public_example(record))
        self.assertIsNone(examples.get_example(records, 'unknown-example'))

    def test_set_discovery_and_selection_apply_exclusions_before_counts_and_memberships(self):
        records = pool()
        held_out = [record for record in records if record['groupId'] == 'song-a'
                    or record['sourceSha256'] == 'prominent-1']
        sets = [{'id': 'mixed', 'description': 'A mixed comparison.',
                 'exampleIds': [record['id'] for record in records]},
                {'id': 'held-out-only', 'description': 'An unavailable comparison.',
                 'exampleIds': [record['id'] for record in held_out]}]
        options = {'contrast_sets': sets, 'excluded_sources': ('prominent-1',), 'excluded_groups': ('song-a',)}
        result = examples.search_examples(records, contrast_set='mixed', limit=6, **options)
        descriptor, = result['availableContrastSets']
        self.assertEqual(descriptor['id'], 'mixed')
        self.assertEqual(descriptor['assessmentCounts'], dict.fromkeys(examples.LABELS, 2))
        self.assertEqual(result['matchedAssessmentCounts'], descriptor['assessmentCounts'])
        for record in held_out:
            self.assertNotIn(record['id'], str(result))
        with self.assertRaisesRegex(ValueError, 'unavailable'):
            examples.search_examples(records, contrast_set='held-out-only', **options)


if __name__ == '__main__':
    unittest.main()
