"""Supported continuation boundaries for the fine-section dispatcher."""
import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('fine', Path(__file__).with_name('run-fine-annotation.py'))
fine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fine)


class FineAnnotationTest(unittest.TestCase):
    def test_golden_brief_keeps_only_human_judgment_and_optional_comment(self):
        record = {'id': 'human-final', 'sourceSha256': 'source', 'tagId': 'ln-coordination',
                  'assessment': {'presence': 'absent'},
                  'scope': {'startMs': 1000, 'endMs': 2000},
                  'reviewContext': {'startMs': 900, 'endMs': 2100},
                  'rationale': 'These short holds read as taps.', 'rationaleOrigin': 'decision.rationale',
                  'sourceEvidence': {'noteRefs': ['AGENT-EVIDENCE']},
                  'provenance': {'handoffId': 'AGENT-HANDOFF'},
                  'agentComment': 'AGENT-COMMENT'}
        for example in (record, fine.public_example(record)):
            with self.subTest(public='humanComment' in example):
                case = {'caseId': 'case', 'existingHumanJudgments': [example]}
                with patch.object(fine.preparer, 'brief', return_value='# Complete source rows'):
                    brief = fine.section_brief([case])
                public = json.loads(brief.splitlines()[-1])['humanJudgments'][0]
                self.assertEqual(public['assessment'], {'presence': 'absent'})
                self.assertEqual(public['humanComment'], record['rationale'])
                self.assertEqual(public['scope'], record['scope'])
                self.assertNotIn('AGENT-', brief)
                self.assertEqual(set(public), {'id', 'sourceSha256', 'tagId', 'assessment',
                                               'scope', 'reviewContext', 'humanComment'})

    def test_dense_cases_are_balanced_without_an_avoidable_tail_worker(self):
        cases = [{'caseId': str(i), 'weight': weight} for i, weight in enumerate([1] * 20 + [6] * 5)]
        with patch.object(fine, 'section_brief', side_effect=lambda group: 'x' * sum(c['weight'] for c in group)):
            groups = fine.pack_cases(cases, 5, 15)
        self.assertEqual(len(groups), 5)
        self.assertEqual(sorted(c['caseId'] for group in groups for c in group), sorted(c['caseId'] for c in cases))
        self.assertTrue(all(len(group) == 5 and sum(c['weight'] for c in group) <= 15 for group in groups))

    def test_compact_audit_evidence_resolves_to_the_exact_sealed_references(self):
        source = {7: {'sourceLine': 7, 'column': 0, 'kind': 'long', 'startMs': 900, 'endMs': 1400},
                  8: {'sourceLine': 8, 'column': 1, 'kind': 'tap', 'startMs': 1200, 'endMs': 1200}}
        handoff = {'handoffId': 'sealed', 'taskSha256': 'binding', 'proposals': [{
            'id': 'claim', 'scope': {'startMs': 1000, 'endMs': 1300},
            'evidence': {'noteRefs': [source[8]], 'contextNoteRefs': [source[7]],
                         'rationale': '- Tapping under an entering hold.\n- The exact release is retained.'}}]}
        view = fine.compact_handoff(handoff)
        evidence = view['proposals'][0]['evidence']
        reconstructed = {**{k: v for k, v in evidence.items() if k not in ('noteLines', 'contextLines')},
                         'noteRefs': [source[line] for line in evidence['noteLines']],
                         'contextNoteRefs': [source[line] for line in evidence['contextLines']]}
        self.assertEqual(reconstructed, handoff['proposals'][0]['evidence'])
        self.assertEqual(view['taskSha256'], handoff['taskSha256'])
        self.assertIn('noteRefs', handoff['proposals'][0]['evidence'])

    def test_controller_failure_does_not_drop_other_completed_batches(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            fine.save(root / 'campaign/controller/config.json', {})
            fine.save(root / 'preparation.json', {'campaign': str(root / 'campaign')})
            jobs = [root / 'runs' / f'labeler-{i:03d}' for i in (1, 2)]
            for job in jobs:
                fine.save(job / 'run.json', {'status': 'completed', 'role': 'labeler', 'inputsUnchanged': True})
            seen = []
            def prepare(_root, job, _campaign):
                seen.append(job.name)
                if job.name == 'labeler-001':
                    raise ValueError('Witness is outside the selected scope.')
                return {'entries': [], 'skippedCells': [{'conflict': True, 'reason': 'human-overlap'}]}
            with patch.object(fine, 'run_worker', side_effect=lambda job, _: fine.read(job / 'run.json')), \
                    patch.object(fine, 'module', return_value=SimpleNamespace(prepare_handoffs=prepare)):
                result = fine.run(root, 2)
            self.assertEqual(set(seen), {'labeler-001', 'labeler-002'})
            self.assertEqual(result['controllerErrors'][0]['job'], 'labeler-001')
            self.assertEqual(result['deliveries'][0]['status'], 'needs-controller')
            self.assertTrue(result['deliveries'][0]['skippedCells'][0]['conflict'])

    def worker(self, root, completed):
        fine.save(root / 'input.json', {'source': 'frozen'})
        fine.save(root / 'run.json', {'status': 'running', 'pid': 321, 'producerId': 'actual-producer',
                                     'startedAt': '2026-09-07T00:00:00+00:00',
                                     'inputHashes': {'input.json': fine.sha(root / 'input.json')}})
        events = '{"type":"thread.started","thread_id":"actual-thread"}\n'
        if completed:
            fine.save(root / 'response.json', {'cases': []})
            events += '{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":100}}\n'
        (root / 'events.jsonl').write_text(events)

    def test_harvest_finished_worker_retains_actual_producer_and_usage(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.worker(root, True)
            with patch.object(fine.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stdout='')):
                result = fine.run_worker(root, {})
            self.assertEqual(result['status'], 'completed')
            self.assertEqual(result['producerId'], 'actual-producer')
            self.assertEqual(result['threadIds'], ['actual-thread'])
            self.assertEqual(result['usage']['cached_input_tokens'], 100)
            self.assertEqual(result['responseSha256'], fine.sha(root / 'response.json'))

    def test_launch_interruption_without_pid_is_retained(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.worker(root, False)
            saved = fine.read(root / 'run.json')
            del saved['pid']
            fine.save(root / 'run.json', saved)
            result = fine.run_worker(root, {})
            self.assertEqual(result['status'], 'interrupted')
            self.assertEqual(result['producerId'], 'actual-producer')
            self.assertTrue((root / 'events.jsonl').exists())

    def test_dead_incomplete_worker_stays_visible_without_fabricated_completion(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.worker(root, False)
            with patch.object(fine.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stdout='')):
                result = fine.run_worker(root, {})
            self.assertEqual(result['status'], 'interrupted')
            self.assertEqual(result['producerId'], 'actual-producer')
            self.assertNotIn('responseSha256', result)
            self.assertTrue((root / 'events.jsonl').exists())


if __name__ == '__main__':
    unittest.main()
