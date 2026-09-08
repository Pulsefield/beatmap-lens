"""Focused controller tests; the exchange is simulated and no packets are submitted."""
from copy import deepcopy
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import section_annotation_delivery as delivery


class SectionDeliveryTest(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.batch, self.label_job, self.audit_job = [self.root / name for name in ('delivery', 'labeler', 'auditor')]
        source = (b'osu file format v14\n\n[General]\nMode:3\n\n[Difficulty]\nCircleSize:4\n'
                  b'\n[HitObjects]\n64,192,700,128,0,1200:0:0:0:0:\n192,192,1000,1,0,0:0:0:0:\n'
                  b'320,192,1400,1,0,0:0:0:0:\n')
        source_sha = hashlib.sha256(source).hexdigest()
        self.config = {'server': 'http://exchange.test', 'foundationSha256': 'f' * 64}
        self.foundation = {'foundationId': 'approved-five', 'revision': 1,
                           'approval': {'status': 'human-approved'}, 'policies': {},
                           'tags': [{'id': tag} for tag in delivery.TAGS],
                           'foundationSha256': self.config['foundationSha256']}
        self.case = {'caseId': 'episode-1', 'sectionId': 'episode-1', 'sourceSha256': source_sha,
                     'scope': {'startMs': 1000, 'endMs': 1400},
                     'reviewContext': {'startMs': 800, 'endMs': 1600},
                     'notes': [
                         {'source_line': 10, 'column': 0, 'kind': 'long', 'start_ms': 700, 'end_ms': 1200},
                         {'source_line': 11, 'column': 1, 'kind': 'normal', 'start_ms': 1000, 'end_ms': 1000},
                         {'source_line': 12, 'column': 2, 'kind': 'normal', 'start_ms': 1400, 'end_ms': 1400}]}
        self.task = {'taskId': 'frozen-task', 'taskSha256': 't' * 64,
                     'source': {'sha256': source_sha}, 'sourceBytes': list(source),
                     'structure': {'notes': [delivery.note_ref(note) for note in self.case['notes']]},
                     'foundationSha256': self.config['foundationSha256'],
                     'foundation': {key: value for key, value in self.foundation.items() if key != 'foundationSha256'},
                     'base': {'reviewRevision': 0, 'reviewSha256': 'b' * 64}}
        self.current = {'sourceSha256': source_sha, 'reviewBase': self.task['base'],
                        'taskBinding': {'foundationSha256': self.config['foundationSha256']},
                        'agentReviews': [], 'handoffs': [], 'audits': [], 'directObservations': []}
        self.judgments = [{'tagId': tag, 'presence': 'absent', 'salience': None,
                           'rationale': ['The full source episode was inspected.', 'The target organization does not recur.'],
                           'noteLines': [11], 'contextLines': [10, 12]} for tag in delivery.TAGS]
        self.commands = []
        self.addCleanup(patch.stopall)
        patch.object(delivery, 'cli', side_effect=self.exchange).start()
        patch.object(delivery, 'feedback', side_effect=lambda *_: deepcopy(self.current)).start()

    def write_job(self, path, role, cases, response, copies=()):
        delivery.save(path / 'cases.json', {'cases': cases})
        delivery.save(path / 'foundation.json', self.foundation)
        delivery.save(path / 'skill/manifest.json', {'files': []})
        delivery.save(path / 'skill-provenance.json', {'name': 'frozen-skill', 'version': 'test',
                                                      'sha256': delivery.sha(path / 'skill/manifest.json')})
        for source in copies:
            target = path / 'packets' / source.parent.name / source.name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.read_bytes())
        hashes = {str(item.relative_to(path)): delivery.sha(item) for item in path.rglob('*')
                  if item.is_file() and item.name not in ('run.json', 'response.json')}
        delivery.save(path / 'response.json', {'cases': response})
        delivery.save(path / 'run.json', {'producerId': 'actual-' + role, 'role': role, 'status': 'completed',
                                        'inputsUnchanged': True, 'inputHashes': hashes, 'toolVersion': 'test-cli',
                                        'requestedModel': 'test-model', 'finishedAt': '2026-09-07T00:00:00Z',
                                        'responseSha256': delivery.sha(path / 'response.json')})

    def label(self):
        self.write_job(self.label_job, 'labeler', [self.case], [{'caseId': self.case['caseId'], 'judgments': self.judgments}])
        return delivery.prepare_handoffs(self.batch, self.label_job, self.config)

    def auditor(self, manifest, outcomes=None):
        cases, responses, copies = [], [], []
        for entry in manifest['entries']:
            cases.append({'caseId': entry['caseId']})
            responses.append({'caseId': entry['caseId'], 'coverageRationale': ['Every sealed target was independently inspected.'],
                              'results': [{'claimId': claim_id, 'status': (outcomes or {}).get(claim_id, 'supported'),
                                           'rationale': ['The exact supplied witnesses support this outcome.',
                                                         'The complete context contains no contrary arrangement.'],
                                           'question': 'Does this changing held-column relation establish the target organization?'
                                           if (outcomes or {}).get(claim_id) == 'needs-expert' else None}
                                          for claim_id in entry['claimIds']]})
            copies += [Path(entry['taskPath']), Path(entry['handoffPath'])]
        self.write_job(self.audit_job, 'auditor', cases, responses, copies)

    def add_review(self, tag, status, scope=None, presence='absent'):
        number = len(self.current['agentReviews'])
        handoff_id, claim_id = f'prior-{number}', f'claim-{number}'
        row = {'handoffId': handoff_id, 'claimId': claim_id, 'baseStatus': 'current', 'status': status,
               'summary': {'tagId': tag, 'scope': scope or self.case['scope'], 'assessment': {'presence': presence}}, 'audits': []}
        if status in delivery.HUMAN:
            row['decision'] = {'disposition': status, 'humanId': 'actual-human'}
        self.current['agentReviews'].append(row)
        self.current['handoffs'].append({'handoffId': handoff_id, 'handoffSha256': str(number) * 64,
                                         'foundationSha256': self.config['foundationSha256']})
        return {'sourceSha256': self.case['sourceSha256'], 'handoffId': handoff_id, 'claimId': claim_id,
                'tagId': tag, 'scope': scope or self.case['scope']}

    def exchange(self, command, *arguments):
        self.commands.append(command)
        options = dict(zip(arguments[::2], arguments[1::2])) if command != 'fetch-task' else {}
        if command == 'fetch-task':
            self.assertIn('--fresh', arguments)
            delivery.save(arguments[-1], self.task)
            return
        if command in ('handoff', 'audit'):
            task, proposal = delivery.read(options['--task']), delivery.read(options['--input'])
            packet = {**proposal, 'version': 2, 'sourceSha256': task['source']['sha256'],
                      **{key: task[key] for key in ('taskId', 'taskSha256', 'foundationSha256', 'base')}}
            if command == 'audit':
                original = delivery.read(options['--handoff'])
                packet.update(contract='beatmap-lens-independent-audit', handoffId=original['handoffId'],
                              handoffSha256=delivery.sha(options['--handoff']))
            else:
                packet['contract'] = 'beatmap-lens-agent-handoff'
            delivery.save(options['--out'], packet)
            return
        self.assertEqual(command, 'submit')
        packet = delivery.read(options['--input'])
        kind = 'audit' if 'auditId' in packet else 'handoff'
        if kind == 'handoff':
            self.current['handoffs'].append({**packet, 'handoffSha256': delivery.sha(options['--input'])})
            self.current['agentReviews'] += [{'handoffId': packet['handoffId'], 'claimId': claim['id'],
                                             'summary': claim, 'status': 'awaiting-audit', 'baseStatus': 'current', 'audits': []}
                                            for claim in packet['proposals']]
        else:
            self.current['audits'].append({**packet, 'auditSha256': delivery.sha(options['--input'])})
            handoff = next(item for item in self.current['handoffs'] if item['handoffId'] == packet['handoffId'])
            for claim in packet['claims']:
                row = next(item for item in self.current['agentReviews']
                           if (item['handoffId'], item['claimId']) == (packet['handoffId'], claim['claimId']))
                row['audits'].append({'auditId': packet['auditId'], 'result': claim})
                row['status'] = 'agent-reviewed' if claim['outcome'] == 'supported' else claim['outcome']
                for link in handoff.get('supersedes', []):
                    if link['replacementClaimId'] != claim['claimId'] or claim['outcome'] == 'needs-revision':
                        continue
                    old = next(item for item in self.current['agentReviews']
                               if (item['handoffId'], item['claimId']) == (link['handoffId'], link['claimId']))
                    old.update(status='superseded', supersededBy={'handoffId': packet['handoffId'], 'claimId': claim['claimId']})
            # Exchange feedback propagates an audited terminal revision through
            # the already stored linear history, including stale predecessors.
            rows = {(row['handoffId'], row['claimId']): row for row in self.current['agentReviews']}
            for prior in reversed(self.current['handoffs']):
                for link in prior.get('supersedes', []):
                    replacement = rows[(prior['handoffId'], link['replacementClaimId'])]
                    old = rows[(link['handoffId'], link['claimId'])]
                    if replacement['status'] in ('agent-reviewed', 'needs-expert', 'superseded') and not old.get('decision'):
                        old.update(status='superseded', supersededBy={'handoffId': prior['handoffId'], 'claimId': link['replacementClaimId']})
        delivery.save(options['--out'], {'id': 'receipt-' + kind, 'kind': kind,
                                        'packetId': packet['auditId'] if kind == 'audit' else packet['handoffId'],
                                        'sourceSha256': packet['sourceSha256'], 'status': 'imported', 'baseStatus': 'current'})

    def test_prepare_binds_full_source_context_and_retains_entering_holds(self):
        self.judgments[-1].update(presence='present', salience='supporting', noteLines=[10, 11])
        manifest = self.label()
        entry = manifest['entries'][0]
        handoff = delivery.read(entry['handoffPath'])
        self.assertEqual(len(handoff['proposals']), 5)
        hold = handoff['proposals'][-1]['evidence']['noteRefs'][0]
        self.assertEqual((hold['startMs'], hold['endMs']), (700, 1200))
        self.assertEqual(handoff['proposals'][-1]['evidence']['contextNoteRefs'][0]['sourceLine'], 12)
        self.assertNotIn('submit', self.commands)
        self.assertEqual(delivery.prepare_handoffs(self.batch, self.label_job, self.config), manifest)
        self.assertEqual(self.commands.count('fetch-task'), 1)

    def test_source_bytes_note_geometry_and_complete_context_are_pinned(self):
        for mutation, message in [('bytes', 'source bytes'), ('column', 'Worker notes'), ('omission', 'Worker notes')]:
            with self.subTest(mutation=mutation):
                task, case = deepcopy(self.task), deepcopy(self.case)
                if mutation == 'bytes':
                    task['sourceBytes'].append(10)
                elif mutation == 'column':
                    case['notes'][0]['column'] = 3
                else:
                    case['notes'].pop()
                with self.assertRaisesRegex(ValueError, message):
                    delivery.bind_source(case, task, self.foundation, self.config)

    def test_human_exact_rejected_and_partial_overlap_cells_are_preserved(self):
        original = self.add_review(delivery.TAGS[0], 'modified')
        self.current['agentReviews'][0]['modifiedClaim'] = {
            **self.current['agentReviews'][0]['summary'], 'scope': {'startMs': 1100, 'endMs': 1450}}
        self.case['originalReferences'] = [original]
        self.add_review(delivery.TAGS[1], 'rejected')
        self.current['directObservations'].append({'summary': {'tagId': 'tech', 'scope': {'startMs': 1200, 'endMs': 1800}}})
        before = deepcopy(self.current)
        manifest = self.label()
        self.assertEqual([cell['reason'] for cell in manifest['skippedCells']], ['human-exact', 'human-exact', 'human-overlap'])
        self.assertEqual(len(manifest['entries'][0]['claimIds']), 2)
        self.assertEqual(manifest['entries'][0]['supersedes'], [])
        self.assertEqual(self.current, before)

    def test_duplicate_supported_cells_skip_and_conflicting_supported_cells_block(self):
        self.add_review(delivery.TAGS[0], 'agent-reviewed')
        self.add_review(delivery.TAGS[1], 'agent-reviewed', presence='unresolved')
        manifest = self.label()
        self.assertEqual([(c['reason'], c['conflict']) for c in manifest['skippedCells']],
                         [('compatible-machine', False), ('supported-machine-conflict', True)])
        self.assertEqual(len(manifest['entries'][0]['claimIds']), 3)
        self.auditor(manifest)
        result = delivery.deliver_audits(self.batch, self.audit_job, self.config)
        self.assertEqual(result['status'], 'needs-controller')
        self.assertEqual(result['skippedCells'], manifest['skippedCells'])

    def test_current_pending_machine_cells_require_exact_explicit_lineage(self):
        self.case['originalReferences'] = [self.add_review('tech', 'needs-expert')]
        self.add_review(delivery.TAGS[0], 'needs-revision')
        manifest = self.label()
        links = manifest['entries'][0]['supersedes']
        self.assertEqual(links, [{'handoffId': 'prior-0', 'handoffSha256': '0' * 64, 'claimId': 'claim-0',
                                 'replacementClaimId': 'episode-1-tech'}])
        self.assertEqual(manifest['skippedCells'][0]['reason'], 'missing-current-supersedes-reference')

    def test_stale_or_already_replaced_references_remain_blocked(self):
        ref = self.add_review('tech', 'needs-expert')
        self.case['originalReferences'] = [ref]
        for state in ('stale', 'replacement'):
            with self.subTest(state=state):
                current = deepcopy(self.current)
                if state == 'stale':
                    current['agentReviews'][0]['baseStatus'] = 'stale'
                else:
                    current['handoffs'].append({'handoffId': 'replacement', 'supersedes': [ref]})
                selected, links, skipped = delivery.select_cells(self.case, self.judgments, current, self.config['foundationSha256'])
                self.assertEqual((len(selected), links), (4, []))
                self.assertTrue(skipped[0]['conflict'])

    def test_explicit_terminal_repair_reuses_frozen_labels_without_forking_or_rewriting_history(self):
        original = self.add_review('tech', 'needs-expert')
        terminal = self.add_review('tech', 'stale')
        self.current['agentReviews'][-1]['baseStatus'] = 'stale'
        self.current['handoffs'][-1]['supersedes'] = [{
            'handoffId': original['handoffId'], 'handoffSha256': '0' * 64,
            'claimId': original['claimId'], 'replacementClaimId': terminal['claimId']}]
        self.case['originalReferences'] = [original]
        first = self.label()
        original_packet = Path(first['entries'][0]['handoffPath'])
        original_hash, worker_hash = delivery.sha(original_packet), delivery.sha(self.label_job / 'run.json')
        for tag in delivery.TAGS:
            if tag != 'tech':
                self.add_review(tag, 'agent-reviewed')
        self.batch = self.root / 'lineage-repair'
        manifest = delivery.prepare_handoffs(self.batch, self.label_job, self.config,
                                             follow_terminal_lineage=True, handoff_suffix='lineage-repair')
        entry = manifest['entries'][0]
        self.assertEqual(entry['claimIds'], ['episode-1-tech'])
        self.assertEqual(entry['originalReferences'], [original])
        self.assertEqual(entry['supersedes'], [{
            'handoffId': terminal['handoffId'], 'handoffSha256': '1' * 64,
            'claimId': terminal['claimId'], 'replacementClaimId': 'episode-1-tech'}])
        self.assertEqual(len(entry['lineageRepairs'][0]['chain']), 2)
        self.assertNotEqual(entry['handoffId'], first['entries'][0]['handoffId'])
        self.assertEqual(delivery.sha(original_packet), original_hash)
        self.assertEqual(delivery.sha(self.label_job / 'run.json'), worker_hash)
        self.auditor(manifest)
        result = delivery.deliver_audits(self.batch, self.audit_job, self.config)
        self.assertEqual(result['status'], 'complete')
        self.assertEqual([row['status'] for row in self.current['agentReviews'][:2]], ['superseded', 'superseded'])
        self.assertEqual(self.current['agentReviews'][0]['supersededBy'], {
            'handoffId': terminal['handoffId'], 'claimId': terminal['claimId']})

    def test_terminal_repair_does_not_adopt_an_unrelated_stale_claim_or_changed_crop(self):
        original = self.add_review('tech', 'needs-expert')
        terminal = self.add_review('tech', 'stale', scope={'startMs': 1100, 'endMs': 1400})
        self.current['agentReviews'][-1]['baseStatus'] = 'stale'
        self.current['handoffs'][-1]['supersedes'] = [{
            'handoffId': original['handoffId'], 'handoffSha256': '0' * 64,
            'claimId': original['claimId'], 'replacementClaimId': terminal['claimId']}]
        self.case['originalReferences'] = [original]
        case, current, lineages = delivery.terminal_lineage(self.case, self.current, self.config['foundationSha256'])
        self.assertEqual(lineages, [])
        selected, links, skipped = delivery.select_cells(case, self.judgments, current, self.config['foundationSha256'])
        self.assertEqual((len(selected), links), (4, []))
        self.assertEqual(skipped[0]['reason'], 'original-already-has-replacement')

    def test_explicit_exact_stale_coalescing_retires_the_detached_duplicate_too(self):
        original = self.add_review('tech', 'needs-revision')
        terminal = self.add_review('tech', 'stale')
        self.current['agentReviews'][-1]['baseStatus'] = 'stale'
        self.current['handoffs'][-1]['supersedes'] = [{
            'handoffId': original['handoffId'], 'handoffSha256': '0' * 64,
            'claimId': original['claimId'], 'replacementClaimId': terminal['claimId']}]
        duplicate = self.add_review('tech', 'stale')
        self.current['agentReviews'][-1]['baseStatus'] = 'stale'
        self.case['originalReferences'] = [original]
        self.label()
        self.batch = self.root / 'coalesced-repair'
        manifest = delivery.prepare_handoffs(self.batch, self.label_job, self.config,
                                             follow_terminal_lineage=True, handoff_suffix='coalesced', include_exact_stale=True)
        entry = manifest['entries'][0]
        self.assertEqual({link['claimId'] for link in entry['supersedes']}, {terminal['claimId'], duplicate['claimId']})
        self.assertEqual(entry['lineageRepairs'][-1]['reason'], 'exact-stale-duplicate')
        self.auditor(manifest)
        result = delivery.deliver_audits(self.batch, self.audit_job, self.config)
        self.assertEqual(result['status'], 'complete')
        self.assertEqual([row['status'] for row in self.current['agentReviews'][:3]], ['superseded'] * 3)

    def test_five_dimension_coverage_and_half_open_witnesses_are_checked_before_sealing(self):
        for judgments in (self.judgments[:-1], self.judgments + [self.judgments[0]]):
            with self.assertRaises(ValueError):
                delivery.validate_judgments(self.case, judgments)
        self.judgments[0]['noteLines'] = [12]
        with self.assertRaisesRegex(ValueError, 'out-of-scope'):
            self.label()
        self.assertEqual(self.commands, [])

    def test_audited_delivery_preserves_actual_outcomes_and_retry_submits_nothing(self):
        self.case['originalReferences'] = [self.add_review('tech', 'needs-expert')]
        self.judgments[3].update(presence='unresolved')
        manifest = self.label()
        self.auditor(manifest, {'episode-1-tech': 'needs-expert', 'episode-1-ln-coordination': 'needs-revision'})
        result = delivery.deliver_audits(self.batch, self.audit_job, self.config)
        self.assertEqual(result['status'], 'complete')
        statuses = result['entries'][0]['claimStatuses']
        self.assertEqual(statuses['episode-1-tech'], 'needs-expert')
        self.assertEqual(statuses['episode-1-ln-coordination'], 'needs-revision')
        self.assertEqual(self.current['agentReviews'][0]['status'], 'superseded')
        self.assertEqual(self.current['audits'][0]['agent']['producerId'], 'actual-auditor')
        self.assertEqual(self.commands.count('submit'), 2)
        result = delivery.deliver_audits(self.batch, self.audit_job, self.config)
        self.assertEqual(result['entries'][0]['status'], 'already-delivered')
        self.assertEqual(self.commands.count('submit'), 2)

    def test_unresolved_claim_cannot_be_promoted_by_supported_audit(self):
        self.judgments[3]['presence'] = 'unresolved'
        manifest = self.label()
        self.auditor(manifest)
        with self.assertRaisesRegex(ValueError, 'unresolved proposal'):
            delivery.deliver_audits(self.batch, self.audit_job, self.config)
        self.assertNotIn('submit', self.commands)
        self.assertNotIn('audit', self.commands)

    def test_auditor_must_be_independent_and_pin_exact_original_packet_files(self):
        manifest = self.label()
        self.auditor(manifest)
        path = self.audit_job / 'run.json'
        run = delivery.read(path)
        run['producerId'] = 'actual-labeler'
        delivery.save(path, run)
        with self.assertRaisesRegex(ValueError, 'independent'):
            delivery.deliver_audits(self.batch, self.audit_job, self.config)
        run['producerId'] = 'actual-auditor'
        run['inputHashes'] = {name: digest for name, digest in run['inputHashes'].items() if not name.endswith('/task.json')}
        delivery.save(path, run)
        with self.assertRaisesRegex(ValueError, 'exact task and handoff'):
            delivery.deliver_audits(self.batch, self.audit_job, self.config)
        self.assertNotIn('submit', self.commands)

    def test_new_human_decision_between_handoff_and_audit_stops_the_second_write(self):
        manifest = self.label()
        self.auditor(manifest)
        exchange = self.exchange

        def concurrent_human(command, *arguments):
            exchange(command, *arguments)
            if command == 'submit':
                self.add_review('tech', 'accepted')

        with patch.object(delivery, 'cli', side_effect=concurrent_human):
            result = delivery.deliver_audits(self.batch, self.audit_job, self.config)
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(self.commands.count('submit'), 1)
        self.assertEqual(self.current['audits'], [])
        self.assertIn('human-exact', result['entries'][0]['error'])

    def test_stale_base_preserves_sealed_packets_and_stops_delivery(self):
        manifest = self.label()
        self.auditor(manifest)
        entry = manifest['entries'][0]
        self.current['reviewBase'] = {'reviewRevision': 1, 'reviewSha256': 'changed'}
        result = delivery.deliver_audits(self.batch, self.audit_job, self.config)
        self.assertEqual(result['status'], 'blocked')
        self.assertIn('stale', result['entries'][0]['error'])
        self.assertEqual(delivery.sha(entry['handoffPath']), entry['handoffSha256'])
        self.assertNotIn('submit', self.commands)


if __name__ == '__main__':
    unittest.main()
