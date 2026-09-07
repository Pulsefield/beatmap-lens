"""Fine campaign accounting and continuation; canonical service access is always mocked."""
from contextlib import redirect_stdout
from copy import deepcopy
import fcntl
import importlib.util
import io
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).with_name('fine-annotation-campaign.py')
spec = importlib.util.spec_from_file_location('fine_annotation_campaign', SCRIPT)
campaign = importlib.util.module_from_spec(spec)
spec.loader.exec_module(campaign)
TAGS = campaign.priorities.TAGS
SCOPE = {'startMs': 1000, 'endMs': 11000}


def claim(tag, identity=None, start=1000, end=11000, presence='absent'):
    return {'id': identity or tag, 'tagId': tag, 'scope': {'startMs': start, 'endMs': end},
            'reviewContext': {'startMs': 0, 'endMs': 12000}, 'assessment': {'presence': presence}}


def row(value, status='agent-reviewed', base='current'):
    return {'claimId': value['id'], 'handoffId': 'handoff', 'summary': value,
            'status': status, 'baseStatus': base, 'audits': [{'auditId': 'audit-' + value['id']}]}


def feedback():
    return {'sourceSha256': 'source', 'taskBinding': {'foundationSha256': 'foundation'},
            'reviewBase': {'revision': 2, 'sha256': 'base'},
            'documentVersion': {'revision': 8, 'sha256': 'document'},
            'agentReviews': [row(claim(tag)) for tag in TAGS], 'directObservations': [],
            'handoffs': [{'handoffId': 'handoff', 'base': {'revision': 2, 'sha256': 'base'},
                          'agent': {'producerId': 'producer', 'skill': {'sha256': 'skill'}}}]}


def section():
    return {'sourceSha256': 'source', 'scope': SCOPE, 'registrations': [{'batchId': 'batch', 'caseId': 'case'}]}


class AccountingTest(unittest.TestCase):
    def test_complete_requires_full_original_scope_in_all_five_dimensions(self):
        current = feedback()
        current['agentReviews'][0] = row(claim(TAGS[0], end=6000))
        result = campaign.account_section(section(), current)
        self.assertEqual(result['status'], 'partial')
        self.assertEqual(result['scope'], SCOPE)
        self.assertEqual(result['dimensions'][TAGS[0]]['missingRanges'], [(6000, 11000)])
        current['agentReviews'].append(row(claim(TAGS[0], 'continuation', start=6000)))
        result = campaign.account_section(section(), current)
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(len(result['dimensions'][TAGS[0]]['claims']), 2)
        self.assertEqual(result['sourceFeedback']['reviewBase'], current['reviewBase'])

    def test_stale_unresolved_and_superseded_labels_do_not_supply_coverage(self):
        for change in ({'baseStatus': 'stale'}, {'status': 'superseded'},
                       {'summary': claim(TAGS[0], presence='unresolved')}):
            with self.subTest(change=change):
                current = feedback()
                current['agentReviews'][0].update(change)
                result = campaign.account_section(section(), current)
                self.assertEqual(result['status'], 'partial')
                self.assertEqual(result['dimensions'][TAGS[0]]['claims'], [])

    def test_human_priority_clips_machine_and_preserves_each_contributing_identity(self):
        current = feedback()
        human = claim(TAGS[0], 'human', start=3000, end=5000, presence='present')
        current['directObservations'] = [{'id': 'observation', 'summary': human}]
        original = deepcopy(current)
        result = campaign.account_section(section(), current)
        self.assertEqual(result['status'], 'complete')
        human_part, machine_part = result['dimensions'][TAGS[0]]['claims']
        self.assertEqual(human_part['observationId'], 'observation')
        self.assertEqual(human_part['coveredRanges'], [[3000, 5000]])
        self.assertEqual(machine_part['coveredRanges'], [[1000, 3000], [5000, 11000]])
        self.assertEqual(machine_part['handoffId'], 'handoff')
        self.assertEqual(machine_part['auditIds'], ['audit-' + TAGS[0]])
        self.assertEqual(machine_part['agent']['producerId'], 'producer')
        self.assertEqual(current, original)

    def test_conflicting_humans_leave_a_gap_even_with_full_machine_coverage(self):
        current = feedback()
        current['agentReviews'].append(row(claim(TAGS[0], 'accepted', start=2000, end=8000), 'accepted', 'stale'))
        current['directObservations'] = [{'id': 'observation', 'summary':
            claim(TAGS[0], 'direct', start=5000, end=10000, presence='present')}]
        result = campaign.account_section(section(), current)
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(result['dimensions'][TAGS[0]]['missingRanges'], [(5000, 8000)])
        self.assertEqual(result['humanConflicts'][0]['claimIds'], ['accepted', 'direct'])

    def test_open_issue_overlap_blocks_a_complete_section_but_adjacency_does_not(self):
        current = feedback()
        issue = row(claim(TAGS[2], 'question', start=10000, end=12000), 'needs-expert')
        issue['question'] = 'Which organization spans the boundary?'
        current['agentReviews'].append(issue)
        result = campaign.account_section(section(), current)
        self.assertEqual(result['status'], 'blocked')
        self.assertTrue(all(not d['missingRanges'] for d in result['dimensions'].values()))
        self.assertEqual(result['openIssues'][0]['issueId'], 'source/handoff/question')
        issue['summary']['scope']['startMs'] = 11000
        self.assertEqual(campaign.account_section(section(), current)['status'], 'complete')


class ControllerTest(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve() / 'fine'
        self.original = Path(self.temp.name).resolve() / 'corpus'
        campaign.save(self.original / 'controller/config.json', {'foundationSha256': 'foundation', 'server': 'mock-service'})
        self.config = campaign.initialize(self.root, self.original, 4000, sys.executable)
        self.live = feedback()
        self.fetch = patch.object(campaign, 'fetch_feedback', side_effect=lambda server, sha: deepcopy(self.live)).start()
        self.addCleanup(patch.stopall)

    def batch(self, name='initial', delivery='complete', run_status='completed'):
        path = self.root / 'batches' / name
        snapshot = self.root / 'snapshots' / name
        batch = {'id': name, 'path': str(path), 'snapshot': str(snapshot), 'bundle': str(self.root / 'harness' / name)}
        campaign.save(snapshot / 'feedback/source.json', feedback())
        campaign.save(snapshot / 'queue.json', {'sections': [{'sourceSha256': 'source', 'scope': SCOPE}]})
        campaign.save(path / 'sections.json', {'sections': [{'sourceSha256': 'source', 'scope': SCOPE, 'sectionId': 'section-001'}]})
        campaign.save(path / 'preparation.json', {'kind': 'fine-annotation-harness-v1', 'coverageMode': 'selected-sections',
            'campaign': str(self.original), 'skill': {'sha256': 'frozen-skill'},
            'queuePath': str(snapshot / 'queue.json'), 'harness': {'bundle': batch['bundle']}})
        campaign.save(path / 'common/foundation.json', {'foundationSha256': 'foundation'})
        campaign.save(path / 'runs/labeler-001/run.json', {'status': run_status, 'role': 'labeler'})
        campaign.save(path / 'runs/labeler-001/cases.json', {'cases': [
            {'sourceSha256': 'source', 'scope': SCOPE, 'caseId': 'section-001'}]})
        if delivery:
            campaign.save(path / 'delivery/labeler-001/delivery-result.json', {'status': delivery,
                'skippedCells': [{'reason': 'original-already-has-replacement', 'conflict': True}] if delivery == 'needs-controller' else []})
        self.config['batches'].append(batch)
        campaign.save(self.root / 'config.json', self.config)
        return batch

    def test_status_deduplicates_actual_registered_units_and_refreshes_canonical_feedback(self):
        self.batch()
        self.batch('duplicate')
        result = campaign.status(self.root, self.config)
        self.assertEqual((result['attemptedCount'], result['completeCount']), (1, 1))
        self.fetch.assert_called_once_with('mock-service', 'source')
        ledger = campaign.read(self.root / 'ledger.json')['sections']
        self.assertEqual(len(ledger[0]['registrations']), 2)
        self.assertEqual(ledger[0]['registrations'][0]['caseId'], 'section-001')
        self.live['agentReviews'][0]['status'] = 'needs-revision'
        self.assertEqual(campaign.status(self.root, self.config)['completeCount'], 0)

    def completed_response(self, batch, reason='supported-machine-conflict', presence='present'):
        path = Path(batch['path'])
        job = path / 'runs/labeler-001'
        judgments = [{'tagId': tag, 'presence': 'absent', 'salience': None} for tag in TAGS]
        judgments[-1].update(presence=presence, salience='supporting' if presence == 'present' else None)
        campaign.save(job / 'response.json', {'cases': [{'caseId': 'section-001', 'judgments': judgments}]})
        campaign.save(job / 'run.json', {**campaign.read(job / 'run.json'), 'inputsUnchanged': True,
            'producerId': 'actual-labeler', 'skill': {'sha256': 'actual-skill'},
            'responseSha256': campaign.fine.sha(job / 'response.json')})
        cell = {'caseId': 'section-001', 'tagId': TAGS[-1], 'sourceSha256': 'source', 'scope': SCOPE,
                'reason': reason, 'conflict': reason != 'compatible-machine'}
        campaign.save(path / 'delivery/labeler-001/packets/manifest.json', {'skippedCells': [cell]})

    def test_conflicting_cached_fifth_dimension_blocks_count_and_preserves_actual_response(self):
        batch = self.batch(delivery='needs-controller')
        self.completed_response(batch)
        self.assertEqual(campaign.status(self.root, self.config)['completeCount'], 0)
        target, = campaign.read(self.root / 'ledger.json')['sections']
        self.assertEqual(target['status'], 'blocked')
        self.assertTrue(all(not d['missingRanges'] for d in target['dimensions'].values()))
        latest = target['latestLabeler']
        self.assertEqual(latest['producerId'], 'actual-labeler')
        self.assertEqual(latest['responseSha256'], campaign.fine.sha(latest['responsePath']))
        self.assertEqual(len(latest['judgments']), 5)
        conflict, = target['skippedMachineConflicts']
        self.assertEqual(conflict['canonicalClaims'][0]['claimId'], TAGS[-1])
        self.assertEqual(conflict['reason'], 'supported-machine-conflict')
        self.live['agentReviews'][-1]['summary']['assessment'] = {'presence': 'present', 'salience': 'supporting'}
        self.assertEqual(campaign.status(self.root, self.config)['completeCount'], 1)

    def test_compatible_cached_label_and_authoritative_human_resolution_count(self):
        batch = self.batch()
        self.completed_response(batch, 'compatible-machine', 'absent')
        self.assertEqual(campaign.status(self.root, self.config)['completeCount'], 1)
        self.completed_response(batch)
        human = claim(TAGS[-1], 'human', start=1000, end=5000)
        self.live['directObservations'].append({'id': 'human-observation', 'summary': human})
        self.assertEqual(campaign.status(self.root, self.config)['completeCount'], 0)
        target, = campaign.read(self.root / 'ledger.json')['sections']
        self.assertEqual(target['skippedMachineConflicts'][0]['ranges'], [[5000, 11000]])
        human['scope']['endMs'] = 11000
        self.assertEqual(campaign.status(self.root, self.config)['completeCount'], 1)
        target, = campaign.read(self.root / 'ledger.json')['sections']
        self.assertEqual(target['skippedMachineConflicts'], [])

    def test_historical_lineage_skip_clears_when_current_compatible_successor_is_settled(self):
        batch = self.batch(delivery='needs-controller')
        self.completed_response(batch, 'original-already-has-replacement')
        self.live['agentReviews'][-1]['status'] = 'superseded'
        repaired = claim(TAGS[-1], 'lineage-successor', presence='present')
        repaired['assessment']['salience'] = 'supporting'
        self.live['agentReviews'].append(row(repaired))
        result = campaign.status(self.root, self.config)
        self.assertEqual(result['completeCount'], 1)
        target, = campaign.read(self.root / 'ledger.json')['sections']
        self.assertEqual(target['latestLabeler']['judgments'][-1]['skippedReason'], 'original-already-has-replacement')
        self.assertEqual(target['skippedMachineConflicts'], [])

    def test_unresolved_actual_intention_is_preserved_and_never_assumed_absent(self):
        batch = self.batch(delivery='needs-controller')
        self.completed_response(batch, presence='unresolved')
        self.assertEqual(campaign.status(self.root, self.config)['completeCount'], 0)
        target, = campaign.read(self.root / 'ledger.json')['sections']
        self.assertEqual(target['latestLabeler']['judgments'][-1]['assessment'], {'presence': 'unresolved'})

    def test_empty_campaign_has_zero_baseline_and_never_fetches_old_whole_charts(self):
        result = campaign.status(self.root, self.config)
        self.assertEqual(result['completeCount'], 0)
        self.assertEqual(result['baselineCompleteCount'], 0)
        self.fetch.assert_not_called()

    def test_adoption_is_idempotent_and_pins_prepared_foundation(self):
        batch = self.batch()
        self.config['batches'] = []
        campaign.adopt(self.root, self.config, Path(batch['path']))
        campaign.adopt(self.root, self.config, Path(batch['path']))
        self.assertEqual(len(self.config['batches']), 1)
        with self.assertRaisesRegex(ValueError, 'target must match'):
            campaign.initialize(self.root, self.original, 10)

    def test_advance_resumes_exact_prepared_batch_once_without_preparing_new_inputs(self):
        batch = self.batch(delivery=None, run_status='running')
        path = Path(batch['path'])
        original = (path / 'preparation.json').read_bytes()
        with patch.object(campaign.fine, 'prepare') as prepare, patch.object(campaign.fine, 'run') as run:
            campaign.advance(self.root, self.config)
        prepare.assert_not_called()
        run.assert_called_once_with(path, 5)
        self.assertEqual(len(self.config['batches']), 1)
        self.assertEqual((path / 'preparation.json').read_bytes(), original)

    def test_interrupted_preparation_with_zero_or_partial_assignments_stops_for_inspection(self):
        batch = self.batch()
        path = Path(batch['path'])
        job = path / 'runs/labeler-001'
        (job / 'run.json').unlink()
        self.assertEqual(campaign.batch_state(batch)['status'], 'needs-controller')
        campaign.save(job / 'run.json', {'status': 'completed', 'role': 'labeler'})
        campaign.save(path / 'sections.json', {'sections': [
            {'sourceSha256': 'source', 'scope': SCOPE, 'sectionId': 'section-001'},
            {'sourceSha256': 'source', 'scope': {'startMs': 11000, 'endMs': 21000}, 'sectionId': 'section-002'}]})
        with patch.object(campaign.fine, 'run') as run, patch.object(campaign, 'prepare_batch') as prepare:
            result = campaign.advance(self.root, self.config)
        self.assertEqual(result['controllerStatus'], 'needs-controller')
        self.assertEqual(result['batches'][0]['errors'][0]['missingCases'][0][0], 'section-002')
        run.assert_not_called()
        prepare.assert_not_called()

    def test_semantic_pending_cells_allow_next_batch_but_execution_failures_halt(self):
        first = self.batch(delivery='needs-controller')
        self.live['agentReviews'][0]['status'] = 'needs-expert'
        with patch.object(campaign, 'prepare_batch') as prepare, patch.object(campaign.fine, 'run') as run:
            result = campaign.advance(self.root, self.config)
        self.assertEqual(result['completeCount'], 0)
        self.assertEqual(result['batches'][0]['status'], 'complete')
        self.assertTrue(result['batches'][0]['pendingCells'])
        self.assertEqual(len(self.config['batches']), 2)
        prepare.assert_called_once()
        run.assert_called_once_with(Path(self.config['batches'][1]['path']), 5)
        campaign.save(Path(first['path']) / 'runs/labeler-001/run.json', {'status': 'interrupted'})
        with patch.object(campaign, 'prepare_batch') as prepare, patch.object(campaign.fine, 'run') as run:
            result = campaign.advance(self.root, self.config)
        self.assertEqual(result['controllerStatus'], 'needs-controller')
        prepare.assert_not_called()
        run.assert_not_called()

    def test_reaching_target_prevents_new_work_and_blocked_submission_stops_it(self):
        first = self.batch(delivery='blocked')
        with patch.object(campaign.fine, 'run') as run:
            self.assertEqual(campaign.advance(self.root, self.config)['controllerStatus'], 'needs-controller')
        run.assert_not_called()
        campaign.save(Path(first['path']) / 'delivery/labeler-001/delivery-result.json', {'status': 'complete'})
        self.config['target'] = 1
        with patch.object(campaign, 'prepare_batch') as prepare:
            self.assertTrue(campaign.advance(self.root, self.config)['targetReached'])
        prepare.assert_not_called()

    def test_new_batch_preparation_uses_exclusions_current_snapshot_and_bounded_workers(self):
        batch = {'id': 'new', 'path': str(self.root / 'batches/new'),
                 'snapshot': str(self.root / 'snapshots/new'), 'bundle': str(self.root / 'harnesses/new')}
        self.config['batches'].append(batch)
        def command(args, **kwargs):
            if 'annotation-priorities.py' in args[1]:
                campaign.save(Path(batch['snapshot']) / 'queue.json', {'sections': [section()]})
        with patch.object(campaign.subprocess, 'run', side_effect=command) as invoke, patch.object(campaign.fine, 'prepare') as prepare:
            campaign.prepare_batch(self.root, self.config, batch)
        selector, harness = [call.args[0] for call in invoke.call_args_list]
        self.assertEqual(selector[selector.index('--batch-size') + 1], '25')
        self.assertEqual(selector[selector.index('--seed') + 1], '20260908')
        self.assertEqual(selector[selector.index('--exclude-sections') + 1], str(self.root / 'ledger.json'))
        self.assertEqual(harness[harness.index('--feedback-dir') + 1], str(Path(batch['snapshot']) / 'feedback'))
        self.assertEqual(harness[harness.index('--mode') + 1], 'annotation')
        self.assertEqual(prepare.call_args.args[-2:], (5, 28000))

    def test_busy_campaign_lock_skips_without_initializing_or_reading_feedback(self):
        output = io.StringIO()
        with (self.root / 'dispatcher.lock').open('a+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch.object(sys, 'argv', [str(SCRIPT), 'advance', '--root', str(self.root)]), \
                    patch.object(campaign, 'initialize') as initialize, redirect_stdout(output):
                campaign.main()
        initialize.assert_not_called()
        self.fetch.assert_not_called()
        self.assertIn('"controllerStatus": "busy"', output.getvalue())

    def test_feedback_failure_cannot_report_previous_counts_as_fresh_completion(self):
        self.batch()
        campaign.status(self.root, self.config)
        self.fetch.side_effect = OSError('feedback service unavailable')
        with patch.object(sys, 'argv', [str(SCRIPT), 'status', '--root', str(self.root),
                                       '--campaign', str(self.original)]), redirect_stdout(io.StringIO()), \
                self.assertRaises(SystemExit) as stopped:
            campaign.main()
        result = campaign.read(self.root / 'progress.json')
        self.assertEqual(stopped.exception.code, 1)
        self.assertFalse(result['canonicalFresh'])
        self.assertFalse(result['targetReached'])
        self.assertEqual(result['controllerStatus'], 'needs-controller')
        self.assertIn('feedback service unavailable', result['error'])


if __name__ == '__main__':
    unittest.main()
