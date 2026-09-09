"""Publication semantics and immutable snapshot boundaries, without network access."""

from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from types import SimpleNamespace

import pyarrow.parquet as pq
import pyarrow as pa
import publish

from snapshot import (
    JUDGMENT_SCHEMA, JUDGMENT_SCHEMA_V1, build_snapshot, canonical_json, sha256_bytes, validate_snapshot,
)


SOURCE = "a" * 64
FOUNDATION = "f" * 64
METHOD = "method-example"
PROVENANCE = "provenance-example"


def artifact(digest="b" * 64):
    return {"repository": "https://github.com/Pulsefield/beatmap-lens", "commit": "c" * 40,
            "path": "annotation/artifact.json", "sha256": digest}


def fixture():
    source = {"sha256": SOURCE, "byteLength": 256, "osuFormatVersion": 14,
              "beatmapId": 123, "beatmapSetId": 12, "title": "Chart", "artist": "Artist",
              "creator": "Mapper", "difficulty": "4K", "keyCount": 4, "noteCount": 2,
              "normalizerId": "beatmap-lens-mania-v1"}
    foundation = {"contract": "beatmap-lens-judgment-foundation", "version": 2,
                  "foundationId": "test", "revision": 1, "tags": [{"id": "stream"}],
                  "policies": {"missingAssessment": "unreviewed-not-negative"},
                  "calibrationExamples": []}
    content = canonical_json(foundation).decode("utf-8")
    digest = sha256_bytes(content.encode("utf-8"))
    note = {"sourceLine": 8, "column": 1, "kind": "normal", "startMs": 150.5, "endMs": 150.5}
    details = {"review_context": {"startMs": 0, "endMs": 1000},
               "evidence": {"noteRefs": [note], "contextNoteRefs": [], "rationale": "原始人工判断。"},
               "human_rationale": "原始人工判断。", "section_id": "section",
               "boundary_uncertainty": {"start": {"startMs": 80, "endMs": 120}},
               "transition": None, "exemplar_role": "typical-positive", "audit_results": []}
    human = {"record_id": "human:one", "source_sha256": SOURCE, "start_ms": 100,
             "end_ms": 300, "tag_id": "stream", "presence": "present", "salience": "prominent",
             "foundation_id": FOUNDATION, "origin": "human-direct", "observation_id": "one",
             "observation_sha256": "6" * 64,
             "decision_id": None, "handoff_id": None, "claim_id": "claim-one", "provenance_id": None,
             "supersedes_record_ids": [], "auxiliary_evidence_status": "not-applicable",
             "details": details, "source_status": "current", "foundation_status": "current",
             "review_status": "human", "method_id": None, "audit_status": "missing", "audit_supported": False}
    projection = {"contract": "beatmap-lens-release-input", "version": 1,
                  "created_at": "2026-09-09T00:00:00Z",
                  "collector_files": {"apps/inspector/server/collect-annotation-release.mjs": "7" * 64},
                  "workspace_files": [{"source_sha256": SOURCE, "canonical_sha256": "d" * 64}],
                  "sources": [source], "foundations": {FOUNDATION: foundation},
                  "foundation_artifacts": {FOUNDATION: {"content": content, "sha256": digest}},
                  "human": [human], "agents": [], "methods": {}, "provenance": {}}
    config = {"release_id": "2026-09-09.1", "repo_id": "example/annotations", "title": "Test annotations",
              "license": "cc-by-4.0", "exporter": artifact(),
              "sources": {SOURCE: {"kind": "hf", "repository": "example/corpus", "commit": "e" * 40,
                                   "path": "data/charts.parquet", "record_key": SOURCE}},
              "foundations": {FOUNDATION: {"artifact": artifact(digest), "relationship": "source-bytes-referenced"}},
              "methods": {}, "policy": {"agent_methods": [], "auxiliary_evidence": ["current"],
                                          "allow_partial_method_provenance": False}}
    return projection, config


def add_agent(projection, config, *, status="agent-reviewed", auxiliary="current"):
    method = {"labeler": {"role": "labeler", "model": "recorded-labeler", "skill": {"name": "skill", "version": "1", "sha256": "1" * 64}},
              "auditors": [{"role": "auditor", "model": "recorded-auditor", "skill": {"name": "skill", "version": "1", "sha256": "2" * 64}}]}
    packet = {"method_id": METHOD, "task_id": "task", "task_sha256": "3" * 64,
              "handoff_id": "handoff", "handoff_sha256": "4" * 64, "labeler_producer_id": "labeler",
              "audits": [{"audit_id": "audit", "audit_sha256": "5" * 64, "producer_id": "auditor"}],
              "human_evidence_refs": [{"sourceSha256": SOURCE, "observationId": "one", "observationSha256": "6" * 64}],
              "tracking": "complete"}
    row = deepcopy(projection["human"][0])
    row.update(record_id="agent:one", origin="agent-reviewed", observation_id=None,
               handoff_id="handoff", provenance_id=PROVENANCE, method_id=METHOD,
               auxiliary_evidence_status=auxiliary, review_status=status,
               audit_status="supported", audit_supported=True)
    row["details"]["human_rationale"] = None
    row["details"]["audit_results"] = [{"auditId": "audit", "producerId": "auditor",
                                       "result": {"claimId": "claim-one", "outcome": "supported", "rationale": "Supported."}}]
    projection["agents"].append(row)
    projection["methods"][METHOD] = method
    projection["provenance"][PROVENANCE] = packet
    config["policy"]["agent_methods"] = [METHOD]
    config["policy"]["allow_partial_method_provenance"] = True
    return row


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.projection, self.config = fixture()

    def tearDown(self):
        self.temp.cleanup()

    def build(self, name="snapshot", previous=None):
        path = self.root / name
        manifest = build_snapshot(self.projection, self.config, path, previous)
        return path, manifest

    def rewrite_manifest(self, path, manifest):
        (path / "manifest.json").write_bytes(canonical_json(manifest))

    def add_second_human_source(self):
        source_sha = "9" * 64
        identity = deepcopy(self.projection["sources"][0])
        identity.update(sha256=source_sha, beatmapId=124)
        self.projection["sources"].append(identity)
        human = deepcopy(self.projection["human"][0])
        human.update(source_sha256=source_sha, record_id="human:verified", observation_id="verified")
        self.projection["human"].append(human)
        self.config["sources"][source_sha] = deepcopy(self.config["sources"][SOURCE])
        self.config["sources"][source_sha]["record_key"] = source_sha
        return source_sha

    def test_typed_roundtrip_preserves_scopes_evidence_and_masked_assessments(self):
        for presence in ("absent", "unresolved", "unreviewed"):
            row = deepcopy(self.projection["human"][0])
            row.update(record_id="human:" + presence, observation_id=presence, presence=presence, salience=None)
            if presence == "absent":
                row.update(start_ms=400, end_ms=600)
                row["details"]["evidence"]["noteRefs"] = []
                row["details"]["boundary_uncertainty"] = None
            self.projection["human"].append(row)
        path, manifest = self.build()
        rows = pq.read_table(path / "data/human.parquet").to_pylist()
        self.assertEqual(len(rows), 4)
        self.assertEqual({row["presence"] for row in rows}, {"present", "absent", "unresolved", "unreviewed"})
        present = next(row for row in rows if row["presence"] == "present")
        self.assertEqual(present["details"]["human_rationale"], "原始人工判断。")
        self.assertEqual(present["details"]["evidence"]["note_refs"][0]["start_ms"], 150.5)
        self.assertEqual(present["details"]["boundary_uncertainty"]["start"], {"start_ms": 80, "end_ms": 120})
        self.assertEqual(manifest["counts"], {"sources": 1, "human": 4, "agents": {}})
        card = (path / "README.md").read_text()
        self.assertIn("4 human judgments, 0 agent judgments, and 1 source identities", card)
        self.assertIn("https://github.com/Pulsefield/beatmap-lens/blob/" + "c" * 40 + "/annotation/artifact.json", card)
        self.assertIn("https://github.com/Pulsefield/beatmap-lens/tree/" + "c" * 40, card)
        self.assertNotIn("sourceBytes", (path / "manifest.json").read_text())
        self.assertNotIn("source_status", rows[0])
        self.assertEqual(validate_snapshot(path)["human_overlap_pairs"], 3)

    def test_supported_agent_is_explicit_opt_in_and_crosslinks_actual_evidence(self):
        add_agent(self.projection, self.config)
        path, manifest = self.build()
        machine = pq.read_table(path / f"data/agent/{METHOD}.parquet").to_pylist()
        self.assertEqual(len(machine), 1)
        self.assertEqual(manifest["methods"][METHOD]["provenance_status"], "partial")
        self.assertEqual(manifest["provenance"][PROVENANCE]["human_evidence_refs"][0]["record_id"], "human:one")
        self.assertIn("default: true", (path / "README.md").read_text())

    def test_different_rates_can_have_opposite_human_judgments(self):
        slow = deepcopy(self.projection['human'][0])
        slow.update(record_id='human:slow', observation_id='slow', playback_rate=0.5,
                    presence='absent', salience=None)
        self.projection['human'].append(slow)
        path, manifest = self.build()
        rows = pq.read_table(path / 'data/human.parquet').to_pylist()
        self.assertEqual(manifest['version'], 2)
        self.assertEqual({r['playback_rate'] for r in rows}, {1, 0.5})
        self.assertEqual({r['start_ms'] for r in rows}, {100})
        self.assertEqual(validate_snapshot(path)['human_overlap_pairs'], 0)
        slow['playback_rate'] = 1
        with self.assertRaisesRegex(ValueError, 'contradictory human gold'):
            self.build('same-rate-conflict')

    def test_historical_v1_snapshot_migrates_without_changing_immutable_record(self):
        path, manifest = self.build('old')
        name = 'data/human.parquet'
        rows = pq.read_table(path / name).to_pylist()
        for row in rows:
            row.pop('playback_rate')
        pq.write_table(pa.Table.from_pylist(rows, schema=JUDGMENT_SCHEMA_V1), path / name, compression='zstd')
        manifest['version'] = 1
        manifest['files'][name].update(schema='judgment-v1', sha256=sha256_bytes((path / name).read_bytes()))
        self.rewrite_manifest(path, manifest)
        self.assertEqual(validate_snapshot(path)['version'], 1)
        self.config['previous_snapshot'] = {'repo_id': self.config['repo_id'], 'commit': 'e' * 40}
        fresh, revised = self.build('new', previous=path)
        self.assertEqual(revised['removed_records'], [])
        self.assertEqual(pq.read_table(fresh / name).to_pylist()[0]['playback_rate'], 1)

    def test_rate_snapshot_can_be_staged_published_and_retried(self):
        self.projection['human'][0]['playback_rate'] = 1.5
        path, manifest = self.build()
        api = Mock()
        api.repo_info.return_value = SimpleNamespace(sha='a' * 40)
        api.list_repo_files.return_value = ['.gitattributes']
        api.create_commit.return_value = SimpleNamespace(oid='b' * 40)
        references = Mock(return_value={})
        with patch.object(publish, '_remote_manifest', return_value=(None, None)):
            receipt = publish.publish_snapshot(path, api=api, reference_verifier=references)
        self.assertEqual(receipt['commit'], 'b' * 40)
        api.create_commit.assert_called_once()
        api.reset_mock()
        api.repo_info.return_value = SimpleNamespace(sha='b' * 40)
        api.list_repo_files.return_value = [*manifest['files'], 'manifest.json']
        # Exercise the actual remote manifest parser and checksum verification,
        # using local files in place of Hub downloads.
        with patch.object(publish, 'hf_hub_download', side_effect=lambda **kwargs: str(path / kwargs['filename'])):
            receipt = publish.publish_snapshot(path, api=api, reference_verifier=references)
        self.assertTrue(receipt['already_published'])
        self.assertEqual(receipt['commit'], 'b' * 40)
        api.create_commit.assert_not_called()

    def test_human_correction_does_not_require_written_rationale(self):
        self.projection["human"][0]["details"]["evidence"]["rationale"] = ""
        self.projection["human"][0]["details"]["human_rationale"] = ""
        _, manifest = self.build()
        self.assertEqual(manifest["counts"]["human"], 1)

    def test_explicit_source_exclusion_keeps_verified_subset_and_public_reasons(self):
        verified_source = self.add_second_human_source()
        add_agent(self.projection, self.config)
        reason = "Official download differs from the historical source hash."
        self.config["policy"]["excluded_sources"] = {SOURCE: reason}
        self.config["sources"].pop(SOURCE)
        original_projection = deepcopy(self.projection)
        path, manifest = self.build()
        self.assertEqual(manifest["counts"], {"sources": 1, "human": 1, "agents": {METHOD: 0}})
        self.assertEqual(manifest["policy"]["excluded_sources"], {SOURCE: reason})
        self.assertEqual(manifest["exclusions"]["human"], {"source-excluded": 1})
        self.assertEqual(manifest["exclusions"]["agents"], {"source-excluded": 1})
        rows = pq.read_table(path / "data/human.parquet").to_pylist()
        self.assertEqual([row["source_sha256"] for row in rows], [verified_source])
        self.assertIn("partial source selection", (path / "README.md").read_text())
        self.assertEqual(self.projection, original_projection)

    def test_source_exclusion_requires_a_collected_identity_and_nonempty_reason(self):
        self.config["policy"]["excluded_sources"] = {"e" * 64: "Historical bytes unavailable."}
        with self.assertRaisesRegex(ValueError, "absent from the collected input inventory"):
            self.build()
        self.config["policy"]["excluded_sources"] = {SOURCE: " "}
        with self.assertRaisesRegex(ValueError, "Excluded source reason"):
            self.build()

    def test_required_foundation_calibration_cannot_be_excluded(self):
        self.add_second_human_source()
        example = {"id": "required-calibration", "source": deepcopy(self.projection["sources"][0]),
                   "sourceSha256": SOURCE, "explanation": "Normative calibration judgment.",
                   "claim": {"id": "calibration-claim", "tagId": "stream",
                             "scope": {"startMs": 100, "endMs": 300},
                             "reviewContext": {"startMs": 0, "endMs": 1000},
                             "assessment": {"presence": "present", "salience": "prominent"},
                             "evidence": deepcopy(self.projection["human"][0]["details"]["evidence"])}}
        self.projection["foundations"][FOUNDATION]["calibrationExamples"] = [example]
        content = canonical_json(self.projection["foundations"][FOUNDATION]).decode("utf-8")
        digest = sha256_bytes(content.encode("utf-8"))
        self.projection["foundation_artifacts"][FOUNDATION] = {"content": content, "sha256": digest}
        self.config["foundations"][FOUNDATION]["artifact"]["sha256"] = digest
        self.config["policy"]["excluded_sources"] = {SOURCE: "Historical bytes unavailable."}
        with self.assertRaisesRegex(ValueError, "Cannot exclude required Foundation calibration source"):
            self.build()
        self.assertEqual(self.projection["foundations"][FOUNDATION]["calibrationExamples"], [example])
        self.assertFalse((self.root / "snapshot").exists())

    def test_validator_rejects_retained_judgment_from_declared_excluded_source(self):
        path, manifest = self.build()
        manifest["policy"]["excluded_sources"] = {SOURCE: "Must be omitted."}
        self.rewrite_manifest(path, manifest)
        with self.assertRaisesRegex(ValueError, "explicitly excluded source"):
            validate_snapshot(path)

    def test_changed_observation_hash_does_not_link_to_a_different_released_record(self):
        add_agent(self.projection, self.config, auxiliary="changed")
        self.config["policy"]["auxiliary_evidence"] = ["changed"]
        self.projection["human"][0]["observation_sha256"] = "9" * 64
        _, manifest = self.build()
        ref = manifest["provenance"][PROVENANCE]["human_evidence_refs"][0]
        self.assertNotIn("record_id", ref)
        self.assertEqual(ref["observation_sha256"], "6" * 64)

    def test_same_scope_conflicting_gold_blocks_release_without_rewriting_judgments(self):
        disagreement = deepcopy(self.projection["human"][0])
        disagreement.update(record_id="human:other", observation_id="other", salience="supporting")
        self.projection["human"].append(disagreement)
        with self.assertRaisesRegex(ValueError, "contradictory human gold"):
            self.build()
        disagreement.update(end_ms=400)
        _, manifest = self.build()
        self.assertEqual(manifest["counts"]["human"], 2)

    def test_machine_review_progress_does_not_reidentify_unchanged_claim(self):
        agent = add_agent(self.projection, self.config)
        previous, _ = self.build("first")
        self.config["previous_snapshot"] = {"repo_id": self.config["repo_id"], "commit": "8" * 40}
        agent.update(review_status="accepted", decision_id="new-human-confirmation")
        _, manifest = self.build("second", previous)
        self.assertEqual(manifest["counts"]["agents"][METHOD], 1)
        self.assertEqual(manifest["removed_records"], [])

    def test_human_authority_is_independent_of_changed_auxiliary_and_optional_method_gates(self):
        add_agent(self.projection, self.config, auxiliary="changed")
        human = self.projection["human"][0]
        human.update(origin="human-confirmed", handoff_id="handoff", decision_id="accepted", provenance_id=PROVENANCE, auxiliary_evidence_status="changed")
        self.config["policy"]["agent_methods"] = []
        self.config["methods"][METHOD] = {"provenance_status": "complete", "artifacts": {}}
        path, manifest = self.build()
        self.assertEqual(manifest["counts"]["human"], 1)
        self.assertEqual(manifest["counts"]["agents"], {})
        self.assertEqual(manifest["methods"][METHOD]["provenance_status"], "partial")
        self.assertEqual(pq.read_table(path / "data/human.parquet").to_pylist()[0]["auxiliary_evidence_status"], "changed")

    def test_incompatible_and_rejected_rows_exclude_with_separate_reasons(self):
        agent = add_agent(self.projection, self.config, status="rejected")
        agent["presence"] = "present"
        self.projection["human"][0]["foundation_status"] = "changed"
        path, manifest = self.build()
        self.assertEqual(manifest["counts"]["human"], 0)
        self.assertEqual(manifest["counts"]["agents"][METHOD], 0)
        self.assertEqual(manifest["exclusions"]["human"], {"foundation-incompatible": 1})
        self.assertEqual(manifest["exclusions"]["agents"], {"not-effective-agent-review": 1})
        self.assertEqual(manifest["foundations"], {})
        self.assertEqual(pq.read_table(path / "data/human.parquet").num_rows, 0)

    def test_partial_method_and_unknown_auxiliary_require_explicit_admission(self):
        add_agent(self.projection, self.config)
        self.config["policy"]["allow_partial_method_provenance"] = False
        _, manifest = self.build()
        self.assertEqual(manifest["exclusions"]["agents"], {"partial-method-provenance": 1})
        self.config["policy"]["allow_partial_method_provenance"] = True
        self.projection["agents"][0]["auxiliary_evidence_status"] = "untracked"
        _, manifest = self.build("unknown")
        self.assertEqual(manifest["exclusions"]["agents"], {"auxiliary-evidence-not-admitted": 1})

    def test_complete_provenance_must_bind_exact_recorded_skill_bundle(self):
        add_agent(self.projection, self.config)
        refs = {name: artifact() for name in ("labeler_skill", "auditor_skill", "harness", "labeler_role", "auditor_role")}
        self.config["methods"][METHOD] = {"provenance_status": "complete", "artifacts": refs}
        with self.assertRaisesRegex(ValueError, "reproduce the recorded"):
            self.build()
        refs["labeler_skill"] = artifact("1" * 64)
        refs["auditor_skill"] = artifact("2" * 64)
        self.config["policy"]["allow_partial_method_provenance"] = False
        _, manifest = self.build()
        self.assertEqual(manifest["counts"]["agents"][METHOD], 1)

    def test_missing_sources_and_wrong_public_foundation_digest_fail_without_output(self):
        self.config["sources"] = {}
        with self.assertRaisesRegex(ValueError, "Missing source reference"):
            self.build()
        self.assertFalse((self.root / "snapshot").exists())
        self.projection, self.config = fixture()
        self.config["foundations"][FOUNDATION]["artifact"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "Foundation artifact digest"):
            self.build()

    def test_explicit_human_revision_keeps_lineage_across_snapshots(self):
        previous, _ = self.build("first")
        row = self.projection["human"][0]
        row.update(record_id="human:two", observation_id="two", end_ms=350,
                   supersedes_record_ids=["human:one"])
        self.config["release_id"] = "2026-09-09.2"
        self.config["previous_snapshot"] = {"repo_id": self.config["repo_id"], "commit": "8" * 40}
        _, manifest = self.build("second", previous)
        self.assertEqual(manifest["removed_records"], [{"record_id": "human:one", "reason": "superseded", "superseded_by": ["human:two"]}])

    def test_official_osu_locator_preserves_hash_identity_and_mit_notice(self):
        self.config["license"] = "mit"
        self.config["sources"][SOURCE] = {"kind": "osu", "uri": "https://osu.ppy.sh/osu/123"}
        path, manifest = self.build()
        source = pq.read_table(path / "data/sources.parquet").to_pylist()[0]
        self.assertEqual(source["source_sha256"], SOURCE)
        self.assertEqual(source["source_ref"]["uri"], "https://osu.ppy.sh/osu/123")
        self.assertIsNone(source["source_ref"]["commit"])
        project_license = Path(__file__).resolve().parents[3] / "LICENSE"
        self.assertEqual((path / "LICENSE").read_bytes(), project_license.read_bytes())
        self.assertEqual(manifest["files"]["LICENSE"]["sha256"], sha256_bytes(project_license.read_bytes()))
        self.assertEqual(manifest["exporter_files"]["LICENSE"], manifest["files"]["LICENSE"]["sha256"])
        self.assertIn("official locator is mutable", (path / "README.md").read_text())
        self.assertTrue(validate_snapshot(path)["valid"])

    def test_osu_locator_must_match_official_host_and_source_beatmap_identity(self):
        for uri in ("https://osu.ppy.sh/osu/124", "http://osu.ppy.sh/osu/123", "https://example.com/osu/123", "https://osu.ppy.sh/osu/123?revision=1"):
            with self.subTest(uri=uri):
                self.config["sources"][SOURCE] = {"kind": "osu", "uri": uri}
                with self.assertRaisesRegex(ValueError, "exact official URI"):
                    self.build()
        self.config["sources"][SOURCE] = {"kind": "osu", "uri": "https://osu.ppy.sh/osu/123"}
        self.projection["sources"][0].pop("beatmapId")
        with self.assertRaisesRegex(ValueError, "positive source beatmap_id"):
            self.build()

    def test_https_mirror_locator_preserves_original_hash_without_claiming_pinned_revision(self):
        self.config["sources"][SOURCE] = {"kind": "url", "uri": "https://osu.direct/api/osu/123"}
        path, _ = self.build()
        source = pq.read_table(path / "data/sources.parquet").to_pylist()[0]
        self.assertEqual(source["source_sha256"], SOURCE)
        self.assertEqual(source["source_ref"]["kind"], "url")
        self.assertEqual(source["source_ref"]["uri"], "https://osu.direct/api/osu/123")
        self.assertIsNone(source["source_ref"]["commit"])
        self.assertIn("general URL locators", (path / "README.md").read_text())

    def test_general_url_locator_rejects_credentials_fragments_and_non_https(self):
        for uri in ("https://user:secret@example.com/chart.osu", "https://@example.com/chart.osu", "https://example.com/chart.osu#revision", "http://example.com/chart.osu"):
            with self.subTest(uri=uri):
                self.config["sources"][SOURCE] = {"kind": "url", "uri": uri}
                with self.assertRaisesRegex(ValueError, "HTTPS locator without credentials or fragment"):
                    self.build()

    def test_mit_license_is_required_and_terms_cannot_be_replaced_by_updating_hash(self):
        self.config["license"] = "mit"
        path, manifest = self.build()
        (path / "LICENSE").unlink()
        with self.assertRaisesRegex(ValueError, "missing or unlisted"):
            validate_snapshot(path)
        (path / "LICENSE").write_text("MIT License\n")
        manifest["files"]["LICENSE"]["sha256"] = sha256_bytes((path / "LICENSE").read_bytes())
        self.rewrite_manifest(path, manifest)
        with self.assertRaisesRegex(ValueError, "complete MIT terms"):
            validate_snapshot(path)

    def test_changed_immutable_row_and_unexplained_removal_fail(self):
        previous, _ = self.build("first")
        self.config["previous_snapshot"] = {"repo_id": self.config["repo_id"], "commit": "8" * 40}
        self.projection["human"][0]["end_ms"] = 350
        with self.assertRaisesRegex(ValueError, "changed without a new record ID"):
            self.build("second", previous)
        self.projection["human"] = []
        with self.assertRaisesRegex(ValueError, "Removal reason"):
            self.build("second", previous)
        self.config["removals"] = {"human:one": "Human withdrew this observation."}
        _, manifest = self.build("second", previous)
        self.assertEqual(manifest["removed_records"][0]["reason"], "Human withdrew this observation.")

    def test_validator_rejects_checksum_unlisted_files_and_symlinks(self):
        path, _ = self.build()
        (path / "private.json").write_text("{}")
        with self.assertRaisesRegex(ValueError, "unlisted"):
            validate_snapshot(path)
        (path / "private.json").unlink()
        (path / "linked").symlink_to(path / "README.md")
        with self.assertRaisesRegex(ValueError, "symlinks"):
            validate_snapshot(path)
        (path / "linked").unlink()
        (path / "README.md").write_text("changed")
        with self.assertRaisesRegex(ValueError, "Checksum mismatch"):
            validate_snapshot(path)

    def test_validator_checks_schema_and_semantics_even_when_hashes_are_updated(self):
        path, manifest = self.build()
        name = "data/human.parquet"
        rows = pq.read_table(path / name).to_pylist()
        rows[0]["presence"] = "absent"
        import pyarrow as pa
        pq.write_table(pa.Table.from_pylist(rows, schema=JUDGMENT_SCHEMA), path / name, compression="zstd")
        manifest["files"][name]["sha256"] = sha256_bytes((path / name).read_bytes())
        self.rewrite_manifest(path, manifest)
        with self.assertRaisesRegex(ValueError, "Salience"):
            validate_snapshot(path)

    def test_overwrite_and_claiming_existing_superseded_human_are_rejected(self):
        path, _ = self.build()
        with self.assertRaisesRegex(ValueError, "Output already exists"):
            self.build()
        successor = deepcopy(self.projection["human"][0])
        successor.update(record_id="human:two", observation_id="two", supersedes_record_ids=["human:one"])
        self.projection["human"].append(successor)
        with self.assertRaisesRegex(ValueError, "superseded human"):
            self.build("bad-effective")
        self.assertFalse((self.root / "bad-effective").exists())


if __name__ == "__main__":
    unittest.main()
