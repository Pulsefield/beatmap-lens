"""Compact, typed publication snapshots from the domain collector's projection.

This module never reads workspace journals or downloads beatmaps. The TypeScript
collector owns effective human revisions and source-backed claim validation.
Publication preserves that projection and applies only the declared release policy.
"""

from __future__ import annotations

from collections import Counter
from copy import deepcopy
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tempfile
from typing import Any
from urllib.parse import quote as quote_uri, urlparse

import pyarrow as pa
import pyarrow.parquet as pq
import yaml


CONTRACT = "beatmap-lens-annotations"
VERSION = 1
HEX256 = re.compile(r"^[0-9a-f]{64}$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")
REPO_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$")
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
REPO = Path(__file__).resolve().parents[2]
REQUIRED_METHOD_ARTIFACTS = {
    "labeler_skill", "auditor_skill", "harness", "labeler_role", "auditor_role",
}
MIT_TERMS = """Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""


def _list(value: pa.DataType) -> pa.ListType:
    return pa.list_(pa.field("element", value, nullable=False))


def _required(name: str, value: pa.DataType) -> pa.Field:
    return pa.field(name, value, nullable=False)


RANGE = pa.struct([_required("start_ms", pa.float64()), _required("end_ms", pa.float64())])
NOTE = pa.struct([
    _required("source_line", pa.int64()), _required("column", pa.int16()),
    _required("kind", pa.string()), _required("start_ms", pa.float64()),
    _required("end_ms", pa.float64()),
])
EVIDENCE = pa.struct([
    _required("note_refs", _list(NOTE)), _required("context_note_refs", _list(NOTE)),
    _required("rationale", pa.string()),
])
DETAILS = pa.struct([
    _required("review_context", RANGE), _required("evidence", EVIDENCE),
    pa.field("human_rationale", pa.string()),
    pa.field("boundary_uncertainty", pa.struct([pa.field("start", RANGE), pa.field("end", RANGE)])),
    pa.field("transition", pa.struct([
        _required("range", RANGE), _required("description", pa.string()),
        _required("evidence", EVIDENCE),
    ])),
    pa.field("exemplar_role", pa.string()), pa.field("section_id", pa.string()),
    _required("audit_results", _list(pa.struct([
        _required("audit_id", pa.string()), _required("producer_id", pa.string()),
        _required("result", pa.struct([
            _required("claim_id", pa.string()), _required("outcome", pa.string()),
            _required("rationale", pa.string()), pa.field("expert_reason", pa.string()),
            pa.field("question", pa.string()),
        ])),
    ]))),
])
SOURCE_REF = pa.struct([
    _required("kind", pa.string()), pa.field("repository", pa.string()),
    pa.field("commit", pa.string()), pa.field("path", pa.string()),
    pa.field("record_key", pa.string()), pa.field("uri", pa.string()),
])
SOURCE_SCHEMA = pa.schema([
    _required("source_sha256", pa.string()), _required("byte_length", pa.int64()),
    _required("osu_format_version", pa.int16()), pa.field("beatmap_id", pa.int64()),
    pa.field("beatmap_set_id", pa.int64()), _required("title", pa.string()),
    _required("artist", pa.string()), _required("creator", pa.string()),
    _required("difficulty", pa.string()), _required("key_count", pa.int16()),
    _required("note_count", pa.int64()), _required("normalizer_id", pa.string()),
    _required("source_ref", SOURCE_REF),
])
JUDGMENT_SCHEMA = pa.schema([
    _required("record_id", pa.string()), _required("source_sha256", pa.string()),
    _required("start_ms", pa.float64()), _required("end_ms", pa.float64()),
    _required("tag_id", pa.string()), _required("presence", pa.string()),
    pa.field("salience", pa.string()), _required("foundation_id", pa.string()),
    _required("origin", pa.string()), pa.field("observation_id", pa.string()),
    pa.field("decision_id", pa.string()), pa.field("handoff_id", pa.string()),
    pa.field("claim_id", pa.string()), pa.field("provenance_id", pa.string()),
    _required("supersedes_record_ids", _list(pa.string())),
    _required("auxiliary_evidence_status", pa.string()), _required("details", DETAILS),
])


def canonical_json(value: Any) -> bytes:
    """Canonical bytes for Python-owned manifests, independent of frozen V2 hashes."""
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _fail(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def _digest(value: Any, name: str) -> None:
    _fail(isinstance(value, str) and bool(HEX256.fullmatch(value)), f"{name} must be a SHA-256 digest")


def _text(value: Any, name: str) -> None:
    _fail(isinstance(value, str) and bool(value.strip()), f"{name} must be nonempty")


def _relative_path(value: Any, name: str) -> None:
    _text(value, name)
    parts = PurePosixPath(value).parts
    _fail(not value.startswith(("/", "\\")) and "\\" not in value and all(part not in {".", ".."} for part in parts), f"{name} must be a public relative path")
    _fail(str(PurePosixPath(value)) == value, f"{name} must be a normalized relative path")


def validate_artifact_reference(ref: dict, name: str = "artifact") -> None:
    _fail(isinstance(ref, dict), f"{name} must be an artifact reference")
    _fail(set(ref) == {"repository", "commit", "path", "sha256"}, f"{name} has unexpected or missing fields")
    url = urlparse(ref["repository"])
    _fail(url.scheme == "https" and url.netloc == "github.com" and bool(REPO_ID.fullmatch(url.path.lstrip("/"))) and not url.query and not url.fragment, f"{name}.repository must be a GitHub HTTPS repository")
    _fail(bool(COMMIT.fullmatch(str(ref["commit"]))), f"{name}.commit must be a full Git commit")
    _relative_path(ref["path"], f"{name}.path")
    _digest(ref["sha256"], f"{name}.sha256")


def validate_source_reference(ref: dict, source_sha256: str, beatmap_id: int | None = None) -> None:
    _fail(isinstance(ref, dict), "source_ref must be an object")
    _fail(not set(ref) - set(SOURCE_REF.names), "source_ref has unknown fields")
    if ref.get("kind") == "hf":
        _fail(bool(REPO_ID.fullmatch(str(ref.get("repository", "")))), "source_ref.repository must be an HF repository ID")
        _fail(bool(COMMIT.fullmatch(str(ref.get("commit", "")))), "source_ref.commit must pin a full HF commit")
        _relative_path(ref.get("path"), "source_ref.path")
        _fail(ref.get("uri") is None, "HF source_ref uses repository/commit/path, not uri")
        if ref.get("record_key") is not None:
            _text(ref["record_key"], "source_ref.record_key")
    elif ref.get("kind") == "content-addressed":
        url = urlparse(str(ref.get("uri", "")))
        _fail(url.scheme == "https" and bool(url.netloc) and not url.username and not url.password and source_sha256 in url.path and not url.fragment, "content-addressed source_ref requires an HTTPS path containing its exact source hash")
        _fail(all(ref.get(key) is None for key in ("repository", "commit", "path", "record_key")), "content-addressed source_ref uses only uri")
    elif ref.get("kind") == "osu":
        _fail(isinstance(beatmap_id, int) and not isinstance(beatmap_id, bool) and beatmap_id > 0, "osu source_ref requires a positive source beatmap_id")
        _fail(ref.get("uri") == f"https://osu.ppy.sh/osu/{beatmap_id}", "osu source_ref must use the exact official URI matching source beatmap_id")
        _fail(all(ref.get(key) is None for key in ("repository", "commit", "path", "record_key")), "osu source_ref uses only uri")
    elif ref.get("kind") == "url":
        uri = str(ref.get("uri", ""))
        url = urlparse(uri)
        _fail(url.scheme == "https" and bool(url.hostname) and url.username is None and url.password is None and "#" not in uri, "url source_ref requires an HTTPS locator without credentials or fragment")
        _fail(all(ref.get(key) is None for key in ("repository", "commit", "path", "record_key")), "url source_ref uses only uri")
    else:
        raise ValueError("source_ref.kind must be hf, content-addressed, osu, or url")


def _validate_mit_license(content: bytes) -> None:
    text = content.decode("utf-8")
    sections = text.split("\n\n", 2)
    _fail(len(sections) == 3 and sections[0] == "MIT License" and bool(re.fullmatch(r"Copyright \(c\) [^\n]+", sections[1])) and sections[2] == MIT_TERMS, "MIT snapshot LICENSE must preserve its copyright notice and complete MIT terms")


def _mit_license() -> bytes:
    path = REPO / "LICENSE"
    content = path.read_bytes() if path.is_file() else ("MIT License\n\nCopyright (c) 2026 Pulsefield contributors\n\n" + MIT_TERMS).encode("utf-8")
    _validate_mit_license(content)
    return content


def _snapshot_ref(ref: Any) -> None:
    if ref is None:
        return
    _fail(isinstance(ref, dict) and set(ref) == {"repo_id", "commit"}, "previous_snapshot requires repo_id and commit")
    _fail(bool(REPO_ID.fullmatch(str(ref["repo_id"]))) and bool(COMMIT.fullmatch(str(ref["commit"]))), "previous_snapshot must pin a full HF commit")


def _snake(value: Any) -> Any:
    if isinstance(value, list):
        return [_snake(item) for item in value]
    if isinstance(value, dict):
        return {re.sub(r"(?<!^)(?=[A-Z])", "_", key).lower(): _snake(item) for key, item in value.items()}
    return value


def _policy(config: dict) -> dict:
    value = deepcopy(config.get("policy", {}))
    value.setdefault("excluded_sources", {})
    _fail(set(value) == {"agent_methods", "auxiliary_evidence", "allow_partial_method_provenance", "excluded_sources"}, "policy must declare agent_methods, auxiliary_evidence and allow_partial_method_provenance, with optional excluded_sources")
    _fail(isinstance(value["agent_methods"], list) and len(value["agent_methods"]) == len(set(value["agent_methods"])), "policy agent_methods must be unique")
    _fail(isinstance(value["auxiliary_evidence"], list) and not set(value["auxiliary_evidence"]) - {"current", "changed", "untracked"}, "policy auxiliary_evidence must explicitly select supported statuses")
    _fail(isinstance(value["allow_partial_method_provenance"], bool), "allow_partial_method_provenance must be boolean")
    _fail(isinstance(value["excluded_sources"], dict), "policy excluded_sources must map source hashes to reasons")
    for source_sha, reason in value["excluded_sources"].items():
        _digest(source_sha, "Excluded source hash")
        _text(reason, "Excluded source reason")
    value["excluded_sources"] = dict(sorted(value["excluded_sources"].items()))
    for method_id in value["agent_methods"]:
        _fail(isinstance(method_id, str) and bool(SAFE_ID.fullmatch(method_id)), "method IDs must be safe file names")
    value["agent_methods"].sort()
    value["auxiliary_evidence"] = sorted(set(value["auxiliary_evidence"]))
    return value


def _method(recorded: dict, supplied: dict | None) -> dict:
    supplied = supplied or {}
    value = {"labeler": deepcopy(recorded["labeler"]), "auditors": deepcopy(recorded["auditors"]),
             "artifacts": deepcopy(supplied.get("artifacts", {})), "provenance_status": supplied.get("provenance_status", "partial")}
    _fail(value["provenance_status"] in {"complete", "partial"}, "Unknown method provenance_status")
    for key, ref in value["artifacts"].items():
        validate_artifact_reference(ref, f"method.artifacts.{key}")
    if supplied.get("evaluation") is not None:
        validate_artifact_reference(supplied["evaluation"], "method.evaluation")
        value["evaluation"] = deepcopy(supplied["evaluation"])
    if value["provenance_status"] == "complete":
        _fail(REQUIRED_METHOD_ARTIFACTS <= set(value["artifacts"]), "Complete method provenance requires skill, role, and harness artifacts")
        _fail(bool(value["auditors"]), "Complete method provenance requires an auditor")
        for role, producers in (("labeler", [value["labeler"]]), ("auditor", value["auditors"])):
            for producer in producers:
                _text(producer.get("model"), f"{role}.model")
                skill_sha = producer.get("skill", {}).get("sha256")
                _digest(skill_sha, f"{role}.skill.sha256")
                _fail(value["artifacts"][f"{role}_skill"]["sha256"] == skill_sha, f"{role}_skill artifact must reproduce the recorded frozen bundle hash; otherwise mark provenance partial")
    return value


def _foundation(projection: dict, frozen_sha: str, config: dict) -> tuple[str, dict]:
    _digest(frozen_sha, "Foundation frozen hash")
    foundation = projection["foundations"][frozen_sha]
    supplied = config.get("foundations", {}).get(frozen_sha)
    _fail(isinstance(supplied, dict), f"Missing public Foundation reference for {frozen_sha}")
    _fail(supplied.get("relationship") == "source-bytes-referenced", "Foundation relationship must explicitly be source-bytes-referenced")
    validate_artifact_reference(supplied["artifact"], "Foundation artifact")
    exact = projection.get("foundation_artifacts", {}).get(frozen_sha)
    _fail(isinstance(exact, dict) and isinstance(exact.get("content"), str), "Collector must supply exact canonical public Foundation artifact bytes")
    actual = sha256_bytes(exact["content"].encode("utf-8"))
    _fail(actual == exact.get("sha256") == supplied["artifact"]["sha256"], "Public Foundation artifact digest does not match the collected projection")
    _fail(json.loads(exact["content"]) == foundation, "Public Foundation artifact content differs from the collected Foundation")
    _fail(all("sourceBytes" not in example for example in foundation.get("calibrationExamples", [])), "Public Foundation artifact must reference calibration bytes")
    return "f-" + frozen_sha[:16], {
        "frozen_sha256": frozen_sha, "artifact": deepcopy(supplied["artifact"]),
        "relationship": supplied["relationship"],
        "tag_ids": sorted(tag["id"] for tag in foundation["tags"]),
        "calibration_source_sha256": sorted({example["sourceSha256"] for example in foundation.get("calibrationExamples", [])}),
    }


def _public_row(row: dict, foundation_id: str) -> dict:
    public = {name: deepcopy(row.get(name)) for name in JUDGMENT_SCHEMA.names}
    public["foundation_id"] = foundation_id
    public["details"] = _snake(row["details"])
    _fail(not set(public["details"]) - set(DETAILS.names), "Unknown details fields would be lost in publication")
    public["supersedes_record_ids"] = sorted(row.get("supersedes_record_ids", []))
    for field in JUDGMENT_SCHEMA:
        _nonnull(public[field.name], field, field.name)
    return public


def _exporter_files(projection: dict) -> dict[str, str]:
    collector_files = projection.get("collector_files")
    _fail(isinstance(collector_files, dict) and bool(collector_files), "Collector must record its implementation file hashes")
    result = deepcopy(collector_files)
    files = list((REPO / "annotation/release").glob("*.py")) + [REPO / "pyproject.toml", REPO / "uv.lock"]
    if (REPO / "LICENSE").is_file():
        files.append(REPO / "LICENSE")
    for path in files:
        result[path.relative_to(REPO).as_posix()] = sha256_bytes(path.read_bytes())
    return dict(sorted(result.items()))


def _public_source(identity: dict, ref: dict) -> dict:
    result = _snake(identity)
    result["source_sha256"] = result.pop("sha256")
    result["source_ref"] = {name: ref.get(name) for name in SOURCE_REF.names}
    return {name: result.get(name) for name in SOURCE_SCHEMA.names}


def _normalize_provenance(value: dict, human_rows: list[dict], observation_hashes: dict) -> dict:
    result = _snake(deepcopy(value))
    observations = {(row["source_sha256"], row["observation_id"]): row["record_id"] for row in human_rows}
    for ref in result.get("human_evidence_refs", []):
        key = (ref["source_sha256"], ref["observation_id"])
        record_id = observations.get(key)
        if record_id is not None and observation_hashes.get(key) == ref["observation_sha256"]:
            ref["record_id"] = record_id
    return result


def _read_all_judgments(path: Path, manifest: dict) -> dict[str, dict]:
    result = {}
    for name, entry in manifest["files"].items():
        if entry.get("schema") == "judgment-v1":
            for row in pq.read_table(path / name).to_pylist():
                result[row["record_id"]] = row
    return result


def _record_content(row: dict, manifest: dict) -> dict:
    value = deepcopy(row)
    value["foundation_id"] = manifest["foundations"][row["foundation_id"]]["frozen_sha256"]
    # Review/provenance can progress without changing the immutable underlying claim.
    value.pop("auxiliary_evidence_status")
    value.pop("provenance_id")
    value["details"].pop("audit_results")
    if value["origin"] == "agent-reviewed":
        value.pop("decision_id")
    return value


def _removals(previous: Path | None, current_rows: list[dict], manifest: dict, config: dict) -> list[dict]:
    if previous is None:
        _fail(manifest["previous_snapshot"] is None, "previous_snapshot requires the previous local snapshot for revision validation")
        return []
    _fail(manifest["previous_snapshot"] is not None, "A previous snapshot directory requires its pinned previous_snapshot reference")
    validate_snapshot(previous)
    old = json.loads((previous / "manifest.json").read_text())
    old_rows = _read_all_judgments(previous, old)
    new_rows = {row["record_id"]: row for row in current_rows}
    successors: dict[str, list[str]] = {}
    for row in current_rows:
        for prior in row["supersedes_record_ids"]:
            successors.setdefault(prior, []).append(row["record_id"])
    removed = []
    reasons = config.get("removals", {})
    for record_id, row in sorted(old_rows.items()):
        if record_id in new_rows:
            _fail(_record_content(row, old) == _record_content(new_rows[record_id], manifest), f"Immutable record {record_id} changed without a new record ID")
        elif record_id in successors:
            removed.append({"record_id": record_id, "reason": "superseded", "superseded_by": sorted(successors[record_id])})
        else:
            reason = reasons.get(record_id)
            _text(reason, f"Removal reason for {record_id}")
            removed.append({"record_id": record_id, "reason": reason})
    return removed


def _dataset_card(manifest: dict) -> str:
    # JSON strings are valid YAML scalars, so user-supplied titles cannot add YAML keys.
    quote = lambda value: json.dumps(value, ensure_ascii=False)
    lines = ["---", f"license: {quote(manifest['license'])}", "configs:", "- config_name: human", "  default: true", "  data_files:", "  - split: full", "    path: data/human.parquet", "- config_name: sources", "  data_files:", "  - split: full", "    path: data/sources.parquet"]
    for method_id in manifest["policy"]["agent_methods"]:
        lines += [f"- config_name: agent-{method_id}", "  data_files:", "  - split: full", f"    path: data/agent/{method_id}.parquet"]
    lines += ["---", "", f"# {manifest['title']}", "", f"Snapshot `{manifest['release_id']}` uses publication schema `{CONTRACT}` version {VERSION}.", "",
              f"This snapshot contains {manifest['counts']['human']} human judgments, {sum(manifest['counts']['agents'].values())} agent judgments, and {manifest['counts']['sources']} source identities (annotation and required calibration sources).", "",
              f"Export implementation: [GitHub commit {manifest['exporter']['commit'][:12]}]({manifest['exporter']['repository'].removesuffix('.git')}/tree/{manifest['exporter']['commit']}).", "",
              "Normative Foundation definitions:"]
    for foundation_id, value in manifest["foundations"].items():
        ref = value["artifact"]
        url = f"{ref['repository'].removesuffix('.git')}/blob/{ref['commit']}/{quote_uri(ref['path'], safe='/')}"
        lines.append(f"- [{foundation_id}]({url})")
    if not manifest["foundations"]:
        lines.append("No Foundation is referenced by this empty local snapshot.")
    lines += ["", "The default `human` configuration contains effective human judgments. Agent configurations are explicit opt-ins and must not be silently combined with human gold. Machine ancestors can overlap human-confirmed rows; preserve ancestry when selecting examples.", "", "This is a positive-first, partially exhaustive annotation resource. A row is one tag assessment over one exact source interval, in original source milliseconds, with half-open `[start_ms, end_ms)` boundaries. Tags are independent and multiple tags may be prominent. `presence` is `present`, `absent`, `unresolved`, or `unreviewed`. Only `present` has `salience` (`supporting` or `prominent`); other rows have null salience. Missing rows are unreviewed, never negatives. Rejected proposals do not manufacture absence labels.", "", "```python", "from datasets import load_dataset", f"human = load_dataset({quote(manifest['repo_id'])}, 'human',", "                     revision='<full-HF-commit>', split='full')", "supervised = human.filter(lambda row: row['presence'] in ('present', 'absent'))", "```", "", "The split is named `full`; this release makes no held-out benchmark or measured accuracy claim. `agent-reviewed` describes independent audit, not human authority or calibrated confidence.", "", "`sources` contains metadata, exact source hashes, and retrieval references, not beatmap bytes, notes, audio, or images. For `source_ref.kind == 'hf'`, retrieve `path` from the declared corpus `repository` at the full `commit`; `record_key`, when present, identifies the record in that file. For `content-addressed`, retrieve `uri`. For `osu`, retrieve the official `https://osu.ppy.sh/osu/{beatmap_id}` URI. For `url`, retrieve the declared HTTPS `uri`, such as a public mirror holding the original revision. The official locator is mutable, as are general URL locators, and neither promises archival availability; the original `source_sha256` remains the identity. Verify the retrieved original `.osu` bytes against that hash before using time ranges or source-line note references. A mismatch must fail instead of substituting a newer chart. Corpus access and format are owned by its publisher.", "", "The manifest references immutable public Foundation and method artifacts on GitHub. Frozen Foundation hashes and public artifact hashes are deliberately distinct when calibration bytes have been replaced by references. Definitions, skill text, raw agent packets, and workspace journals are not embedded here. `details` retains typed context, evidence, boundary uncertainty, transition, exemplar role, section ID, and original human rationale. Public annotator identities are omitted from annotation tables.", "", "Judgment authority, source/Foundation compatibility, and auxiliary evidence freshness are separate. Included rows have compatible source/Foundation binding. `auxiliary_evidence_status` is snapshot-relative: `current`, `changed`, `untracked`, or `not-applicable`. Changed or untracked machine ancestry does not revoke a human judgment. Human confirmation does not certify an ancestor's rationale. Historic snapshots remain fixed as workspace judgments evolve.", "", f"Machine release policy: auxiliary evidence admitted = `{json.dumps(manifest['policy']['auxiliary_evidence'])}`; partial method provenance admitted = `{str(manifest['policy']['allow_partial_method_provenance']).lower()}`. Selected agent rows require independent supporting audit and an effective `agent-reviewed` or `accepted` state. See `manifest.json` for selected methods, omissions, lineage, file hashes, and public evaluation references, when supplied.", "", "Checks of schema, identity, and provenance do not measure labeling accuracy. No numeric quality certification is implied.", ""]
    if manifest["license"] == "mit":
        lines += ["The exported annotations and accompanying dataset documentation use the MIT license in `LICENSE`. Externally referenced beatmaps remain subject to their own terms; this snapshot does not distribute or relicense their contents.", ""]
    if manifest["policy"].get("excluded_sources"):
        lines += [f"This is a partial source selection: {len(manifest['policy']['excluded_sources'])} source(s) were explicitly omitted. `manifest.json` records each original source hash and exclusion reason in `policy.excluded_sources`, and omitted judgment counts under `exclusions`. The omitted workspace judgments remain intact. Required Foundation calibration sources cannot be excluded.", ""]
    return "\n".join(lines)


def build_snapshot(projection: dict, config: dict, output: Path, previous: Path | None = None) -> dict:
    """Build a new, locally validated snapshot; never overwrite an existing directory."""
    output = Path(output)
    _fail(not output.exists() and not output.is_symlink(), f"Output already exists: {output}")
    _fail(projection.get("contract") == "beatmap-lens-release-input" and projection.get("version") == 1, "Unsupported collector projection")
    for key in ("release_id", "title", "license"):
        _text(config.get(key), key)
    _fail(bool(REPO_ID.fullmatch(str(config.get("repo_id", "")))), "repo_id must be an HF repository ID")
    validate_artifact_reference(config["exporter"], "exporter")
    policy = _policy(config)
    input_sources = {source["sha256"] for source in projection["sources"]} | {
        example["sourceSha256"]
        for foundation in projection["foundations"].values()
        for example in foundation.get("calibrationExamples", [])
    }
    _fail(set(policy["excluded_sources"]) <= input_sources, "Excluded source is absent from the collected input inventory")
    _snapshot_ref(config.get("previous_snapshot"))
    methods = {key: _method(value, config.get("methods", {}).get(key) if key in policy["agent_methods"] else None) for key, value in projection["methods"].items()}
    _fail(set(policy["agent_methods"]) <= set(methods), "Selected agent method is absent from the collector projection")
    retained: dict[str, list[dict]] = {"human": []}
    retained.update({method_id: [] for method_id in policy["agent_methods"]})
    exclusions = {"human": Counter(), "agents": Counter()}
    for channel, rows in (("human", projection["human"]), ("agents", projection["agents"])):
        for row in rows:
            reason = None
            if row["source_sha256"] in policy["excluded_sources"]:
                reason = "source-excluded"
            elif row.get("source_status") != "current":
                reason = "source-incompatible"
            elif row.get("foundation_status") != "current":
                reason = "foundation-incompatible"
            elif channel == "agents":
                method_id = row.get("method_id")
                if method_id not in policy["agent_methods"]:
                    reason = "method-not-selected"
                elif row.get("review_status") not in {"agent-reviewed", "accepted"}:
                    reason = "not-effective-agent-review"
                elif row.get("audit_status") != "supported":
                    reason = "independent-audit-not-supported"
                elif row.get("auxiliary_evidence_status") not in policy["auxiliary_evidence"]:
                    reason = "auxiliary-evidence-not-admitted"
                elif methods[method_id]["provenance_status"] == "partial" and not policy["allow_partial_method_provenance"]:
                    reason = "partial-method-provenance"
            if reason:
                exclusions[channel][reason] += 1
            else:
                retained["human" if channel == "human" else row["method_id"]].append(row)
    all_input_rows = [row for rows in retained.values() for row in rows]
    foundations = {}
    foundation_keys = {}
    identities = {source["sha256"]: source for source in projection["sources"]}
    source_ids = {row["source_sha256"] for row in all_input_rows}
    for frozen_sha in sorted({row["foundation_id"] for row in all_input_rows}):
        key, foundation = _foundation(projection, frozen_sha, config)
        _fail(key not in foundations, "Foundation short ID collision")
        foundations[key] = foundation
        foundation_keys[frozen_sha] = key
        for example in projection["foundations"][frozen_sha].get("calibrationExamples", []):
            source_sha = example["sourceSha256"]
            _fail(source_sha not in policy["excluded_sources"], f"Cannot exclude required Foundation calibration source {source_sha}")
            _fail(example["source"]["sha256"] == source_sha, "Calibration source identity mismatch")
            source_ids.add(source_sha)
            if source_sha in identities:
                _fail(identities[source_sha] == example["source"], "Conflicting metadata for the same calibration source")
            identities[source_sha] = example["source"]
    source_rows = []
    for source_sha in sorted(source_ids):
        ref = config.get("sources", {}).get(source_sha)
        _fail(ref is not None, f"Missing source reference for {source_sha}")
        _fail(source_sha in identities, f"Missing source identity {source_sha}")
        validate_source_reference(ref, source_sha, identities[source_sha].get("beatmapId"))
        source_rows.append(_public_source(identities[source_sha], ref))
    public = {
        key: pa.Table.from_pylist(
            sorted((_public_row(row, foundation_keys[row["foundation_id"]]) for row in rows), key=lambda row: row["record_id"]),
            schema=JUDGMENT_SCHEMA,
        ).to_pylist()
        for key, rows in retained.items()
    }
    all_rows = [row for rows in public.values() for row in rows]
    provenance_ids = {row["provenance_id"] for row in all_rows if row["provenance_id"] is not None}
    observation_hashes = {(row["source_sha256"], row["observation_id"]): row.get("observation_sha256") for row in retained["human"]}
    provenance = {key: _normalize_provenance(projection["provenance"][key], public["human"], observation_hashes) for key in sorted(provenance_ids)}
    method_ids = set(policy["agent_methods"]) | {value["method_id"] for value in provenance.values()}
    manifest = {
        "contract": CONTRACT, "version": VERSION, "release_id": config["release_id"],
        "created_at": projection["created_at"], "repo_id": config["repo_id"],
        "title": config["title"], "license": config["license"], "exporter": deepcopy(config["exporter"]),
        "exporter_files": _exporter_files(projection),
        "previous_snapshot": deepcopy(config.get("previous_snapshot")), "policy": policy,
        "previous_manifest_sha256": sha256_bytes((Path(previous) / "manifest.json").read_bytes()) if previous else None,
        "scope": {"selection": "effective-human-and-selected-audited-methods", "collector_contract": projection["contract"], "collector_version": projection["version"], "workspace_inventory_sha256": sha256_bytes(canonical_json(sorted(projection["workspace_files"], key=lambda item: item["source_sha256"])))},
        "files": {}, "counts": {"sources": len(source_rows), "human": len(public["human"]), "agents": {key: len(public[key]) for key in policy["agent_methods"]}},
        "exclusions": {key: dict(sorted(value.items())) for key, value in exclusions.items()},
        "foundations": foundations, "methods": {key: methods[key] for key in sorted(method_ids)}, "provenance": provenance,
    }
    manifest["removed_records"] = _removals(Path(previous) if previous else None, all_rows, manifest, config)
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{output.name}-", dir=output.parent))
    try:
        def table_file(name: str, rows: list[dict], schema: pa.Schema, kind: str, subset: str, method_id: str | None = None) -> None:
            path = staging / name
            path.parent.mkdir(parents=True, exist_ok=True)
            pq.write_table(pa.Table.from_pylist(rows, schema=schema), path, compression="zstd", use_dictionary=True, version="2.6")
            entry = {"sha256": sha256_bytes(path.read_bytes()), "rows": len(rows), "schema": kind, "config": subset}
            if method_id is not None:
                entry["method_id"] = method_id
            manifest["files"][name] = entry
        table_file("data/sources.parquet", source_rows, SOURCE_SCHEMA, "source-v1", "sources")
        table_file("data/human.parquet", public["human"], JUDGMENT_SCHEMA, "judgment-v1", "human")
        for method_id in policy["agent_methods"]:
            table_file(f"data/agent/{method_id}.parquet", public[method_id], JUDGMENT_SCHEMA, "judgment-v1", "agent-" + method_id, method_id)
        card = _dataset_card(manifest).encode("utf-8")
        (staging / "README.md").write_bytes(card)
        manifest["files"]["README.md"] = {"sha256": sha256_bytes(card)}
        if manifest["license"] == "mit":
            license_content = _mit_license()
            (staging / "LICENSE").write_bytes(license_content)
            manifest["files"]["LICENSE"] = {"sha256": sha256_bytes(license_content)}
        (staging / "manifest.json").write_bytes(canonical_json(manifest))
        validate_snapshot(staging)
        _fail(not output.exists() and not output.is_symlink(), f"Output already exists: {output}")
        os.rename(staging, output)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return manifest


def _nonnull(value: Any, field: pa.Field, name: str) -> None:
    if value is None:
        _fail(field.nullable, f"Required field {name} is null")
    elif pa.types.is_struct(field.type):
        _fail(not set(value) - set(field.type.names), f"Unknown fields in {name} would be lost in publication")
        for child in field.type:
            _nonnull(value.get(child.name), child, f"{name}.{child.name}")
    elif pa.types.is_list(field.type):
        for item in value:
            _nonnull(item, field.type.value_field, name + "[]")


def _range(value: dict, name: str, allow_point: bool = False) -> None:
    start, end = value["start_ms"], value["end_ms"]
    _fail(isinstance(start, (int, float)) and isinstance(end, (int, float)) and math.isfinite(start) and math.isfinite(end) and (start <= end if allow_point else start < end), f"{name} must be a finite source-time range")


def _contains(outer: dict, inner: dict) -> bool:
    return outer["start_ms"] <= inner["start_ms"] and outer["end_ms"] >= inner["end_ms"]


def _overlaps(note: dict, interval: dict) -> bool:
    if note["kind"] == "normal":
        return interval["start_ms"] <= note["start_ms"] < interval["end_ms"]
    return note["start_ms"] < interval["end_ms"] and note["end_ms"] > interval["start_ms"]


def _evidence(value: dict, scope: dict, context: dict, source: dict, name: str) -> None:
    for key, interval in (("note_refs", scope), ("context_note_refs", context)):
        for note in value[key]:
            _fail(note["source_line"] > 0 and 0 <= note["column"] < source["key_count"], f"{name} contains an invalid source note pointer")
            _fail(note["kind"] in {"normal", "long"}, f"{name} contains an invalid note kind")
            _range(note, name + ".note", allow_point=note["kind"] == "normal")
            if note["kind"] == "normal":
                _fail(note["start_ms"] == note["end_ms"], "Normal-note times must be equal")
            _fail(_overlaps(note, interval), f"{name} note must overlap its evidence interval")


def _validate_judgment(row: dict, subset: str, sources: dict, manifest: dict) -> None:
    for field in JUDGMENT_SCHEMA:
        _nonnull(row[field.name], field, field.name)
    for field in ("record_id", "tag_id", "claim_id"):
        _text(row[field], field)
    _fail(row["source_sha256"] in sources, "Judgment has unknown source")
    _fail(row["source_sha256"] not in manifest["policy"].get("excluded_sources", {}), "Snapshot retains a judgment from an explicitly excluded source")
    source = sources[row["source_sha256"]]
    _range(row, "Judgment scope")
    _fail(row["foundation_id"] in manifest["foundations"], "Judgment has unknown Foundation")
    _fail(row["tag_id"] in manifest["foundations"][row["foundation_id"]]["tag_ids"], "Judgment has unknown Foundation tag")
    _fail(row["presence"] in {"present", "absent", "unresolved", "unreviewed"}, "Unknown presence")
    _fail(row["salience"] in {"supporting", "prominent"} if row["presence"] == "present" else row["salience"] is None, "Salience is required only for present judgments")
    _fail(row["auxiliary_evidence_status"] in {"current", "changed", "untracked", "not-applicable"}, "Unknown auxiliary evidence status")
    _fail(len(row["supersedes_record_ids"]) == len(set(row["supersedes_record_ids"])) and row["record_id"] not in row["supersedes_record_ids"], "Invalid human revision lineage")
    details = row["details"]
    _range(details["review_context"], "Review context")
    _fail(_contains(details["review_context"], row), "Review context must contain the whole claim scope")
    _evidence(details["evidence"], row, details["review_context"], source, "Claim evidence")
    if row["presence"] == "present":
        _fail(bool(details["evidence"]["note_refs"]), "Positive judgment requires source-backed witness notes")
    if subset != "human" and row["presence"] != "unreviewed":
        _text(details["evidence"]["rationale"], "Claim rationale")
    boundary = details["boundary_uncertainty"]
    if boundary is not None:
        _fail(any(boundary.values()), "Boundary uncertainty requires a cut")
        for key, interval in boundary.items():
            if interval is not None:
                _range(interval, "Boundary uncertainty")
                cut = row[key + "_ms"]
                _fail(interval["start_ms"] <= cut <= interval["end_ms"] and _contains(details["review_context"], interval), "Boundary uncertainty must contain its cut inside context")
    transition = details["transition"]
    if transition is not None:
        _range(transition["range"], "Transition")
        _fail(_contains(row, transition["range"]), "Transition must stay inside claim scope")
        _text(transition["description"], "Transition description")
        if subset != "human":
            _text(transition["evidence"]["rationale"], "Transition rationale")
        _evidence(transition["evidence"], transition["range"], details["review_context"], source, "Transition evidence")
        _fail(bool(transition["evidence"]["note_refs"]), "Transition requires witness notes")
    _fail(details["exemplar_role"] in {None, "typical-positive", "weak-positive", "near-miss"}, "Unknown exemplar role")
    provenance_id = row["provenance_id"]
    packet = None
    if provenance_id is not None:
        _fail(provenance_id in manifest["provenance"], "Judgment has unknown provenance")
        packet = manifest["provenance"][provenance_id]
        _fail(packet["handoff_id"] == row["handoff_id"], "Judgment and provenance handoff differ")
    if subset == "human":
        _fail(row["origin"] in {"human-direct", "human-confirmed", "human-modified"}, "Human configuration contains a machine judgment")
        _text(row["observation_id"], "Human observation_id")
        if row["origin"] == "human-direct":
            _fail(provenance_id is None and row["handoff_id"] is None and row["decision_id"] is None, "Direct human judgment cannot invent machine ancestry")
            _fail(row["auxiliary_evidence_status"] == "not-applicable", "Direct human judgment has no machine auxiliary evidence")
        else:
            _text(row["handoff_id"], "Human ancestor handoff_id")
            _text(row["decision_id"], "Human decision_id")
    else:
        _fail(row["origin"] == "agent-reviewed" and packet is not None, "Agent configuration requires machine provenance")
        _fail(row["observation_id"] is None and not row["supersedes_record_ids"], "Agent row cannot claim a human observation or revision")
        method_id = subset.removeprefix("agent-")
        _fail(packet["method_id"] == method_id, "Agent configuration and packet method differ")
        _fail(row["auxiliary_evidence_status"] in manifest["policy"]["auxiliary_evidence"], "Agent auxiliary evidence is outside release policy")
        method = manifest["methods"][method_id]
        _fail(method["provenance_status"] == "complete" or manifest["policy"]["allow_partial_method_provenance"], "Agent method provenance is outside release policy")
        _fail(bool(details["audit_results"]), "Agent row has no independent supporting audit")
        for audit in details["audit_results"]:
            _fail(audit["result"]["outcome"] == "supported" and audit["result"]["claim_id"] == row["claim_id"], "Agent row lacks unanimous supporting audit")
            _fail(audit["producer_id"] != packet["labeler_producer_id"], "Agent audit must be independent of labeler")
            _fail(any(item["audit_id"] == audit["audit_id"] and item["producer_id"] == audit["producer_id"] for item in packet["audits"]), "Claim audit missing from packet provenance")


def validate_snapshot(path: Path) -> dict:
    """Verify public files and declared semantics; this does not evaluate accuracy."""
    path = Path(path)
    _fail(path.is_dir() and not path.is_symlink(), "Snapshot must be a real directory")
    actual_files = set()
    for entry in path.rglob("*"):
        _fail(not entry.is_symlink(), "Snapshot must not contain symlinks")
        if entry.is_file():
            actual_files.add(entry.relative_to(path).as_posix())
        else:
            _fail(entry.is_dir(), "Snapshot contains a non-regular file")
    _fail("manifest.json" in actual_files, "Snapshot has no manifest")
    manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
    _fail(manifest.get("contract") == CONTRACT and manifest.get("version") == VERSION, "Unsupported publication schema")
    _fail(set(manifest) == {"contract", "version", "release_id", "created_at", "repo_id", "title", "license", "exporter", "exporter_files", "previous_snapshot", "previous_manifest_sha256", "scope", "policy", "files", "counts", "exclusions", "foundations", "methods", "provenance", "removed_records"}, "Manifest has missing or unexpected fields")
    for key in ("release_id", "created_at", "title", "license"):
        _text(manifest[key], key)
    _fail(bool(REPO_ID.fullmatch(str(manifest["repo_id"]))), "Invalid manifest repo_id")
    validate_artifact_reference(manifest["exporter"], "exporter")
    _fail(isinstance(manifest["exporter_files"], dict) and bool(manifest["exporter_files"]), "Manifest must bind exporter implementation files")
    for name, digest in manifest["exporter_files"].items():
        _relative_path(name, "Exporter implementation file")
        _fail(name in {"LICENSE", "pyproject.toml", "uv.lock", "package.json", "pnpm-lock.yaml"} or name.startswith(("annotation/release/", "apps/inspector/", "packages/beatmap-lens/")), "Unexpected exporter implementation path")
        _digest(digest, "Exporter implementation hash")
    policy = _policy(manifest)
    _snapshot_ref(manifest["previous_snapshot"])
    if manifest["previous_snapshot"] is None:
        _fail(manifest["previous_manifest_sha256"] is None, "Previous manifest digest has no previous snapshot")
    else:
        _digest(manifest["previous_manifest_sha256"], "Previous manifest digest")
    expected_files = {"README.md", "data/sources.parquet", "data/human.parquet"} | {f"data/agent/{key}.parquet" for key in policy["agent_methods"]}
    if manifest["license"] == "mit":
        expected_files.add("LICENSE")
    _fail(set(manifest["files"]) == expected_files, "Manifest files differ from schema/configuration allowlist")
    _fail(actual_files == expected_files | {"manifest.json"}, "Snapshot contains missing or unlisted files")
    for name, info in manifest["files"].items():
        _relative_path(name, "Manifest file")
        _digest(info["sha256"], "File checksum")
        _fail(sha256_bytes((path / name).read_bytes()) == info["sha256"], f"Checksum mismatch: {name}")
    if manifest["license"] == "mit":
        _validate_mit_license((path / "LICENSE").read_bytes())
        if "LICENSE" in manifest["exporter_files"]:
            _fail(manifest["files"]["LICENSE"]["sha256"] == manifest["exporter_files"]["LICENSE"], "Snapshot LICENSE must preserve the referenced project copyright notice")
    card = (path / "README.md").read_text(encoding="utf-8")
    _fail(card.startswith("---\n") and "\n---\n" in card[4:], "Dataset card requires YAML metadata")
    metadata = yaml.safe_load(card.split("---\n", 2)[1])
    expected_configs = [
        {"config_name": "human", "default": True, "data_files": [{"split": "full", "path": "data/human.parquet"}]},
        {"config_name": "sources", "data_files": [{"split": "full", "path": "data/sources.parquet"}]},
    ] + [{"config_name": "agent-" + key, "data_files": [{"split": "full", "path": f"data/agent/{key}.parquet"}]} for key in policy["agent_methods"]]
    _fail(metadata == {"license": manifest["license"], "configs": expected_configs}, "Dataset card configuration must match the manifest and use the full split")
    tables = {}
    for name in sorted(expected_files - {"README.md", "LICENSE"}):
        is_source = name == "data/sources.parquet"
        schema = SOURCE_SCHEMA if is_source else JUDGMENT_SCHEMA
        info = manifest["files"][name]
        expected_config = "sources" if is_source else "human" if name == "data/human.parquet" else "agent-" + Path(name).stem
        _fail(info.get("schema") == ("source-v1" if is_source else "judgment-v1") and info.get("config") == expected_config, f"Incorrect table declaration: {name}")
        if expected_config.startswith("agent-"):
            _fail(info.get("method_id") == Path(name).stem, "Agent file method identity mismatch")
        parquet = pq.ParquetFile(path / name)
        _fail(parquet.schema_arrow.equals(schema, check_metadata=True), f"Arrow schema mismatch: {name}")
        _fail(parquet.metadata.num_rows == info.get("rows"), f"Row count mismatch: {name}")
        for group in range(parquet.metadata.num_row_groups):
            for column in range(parquet.metadata.num_columns):
                _fail(parquet.metadata.row_group(group).column(column).compression == "ZSTD", "Snapshot tables must use Zstandard compression")
        tables[expected_config] = parquet.read().to_pylist()
    sources = {}
    for source in tables["sources"]:
        for field in SOURCE_SCHEMA:
            _nonnull(source[field.name], field, field.name)
        sha = source["source_sha256"]
        _digest(sha, "source_sha256")
        _fail(sha not in sources, "Duplicate source identity")
        _fail(source["byte_length"] > 0 and source["note_count"] >= 0 and 4 <= source["key_count"] <= 10 and source["osu_format_version"] > 0 and source["normalizer_id"] == "beatmap-lens-mania-v1", "Invalid source metadata")
        validate_source_reference(source["source_ref"], sha, source["beatmap_id"])
        sources[sha] = source
    for foundation_id, value in manifest["foundations"].items():
        _digest(value["frozen_sha256"], "Frozen Foundation hash")
        _fail(foundation_id == "f-" + value["frozen_sha256"][:16], "Foundation registry identity mismatch")
        validate_artifact_reference(value["artifact"], "Foundation artifact")
        _fail(value["relationship"] == "source-bytes-referenced", "Unknown public Foundation relationship")
        _fail(len(value["tag_ids"]) == len(set(value["tag_ids"])), "Duplicate Foundation tags")
        _fail(set(value["calibration_source_sha256"]) <= set(sources), "Foundation calibration source reference is missing")
        _fail(not set(value["calibration_source_sha256"]) & set(policy["excluded_sources"]), "Cannot exclude required Foundation calibration sources")
    for method_id, method in manifest["methods"].items():
        _fail(bool(SAFE_ID.fullmatch(method_id)), "Invalid method ID")
        _method(method, method)
    _fail(set(policy["agent_methods"]) <= set(manifest["methods"]), "Agent policy has unknown method")
    for packet in manifest["provenance"].values():
        _fail(packet["method_id"] in manifest["methods"], "Packet has unknown method")
        for key in ("task_sha256", "handoff_sha256"):
            _digest(packet[key], key)
        for key in ("task_id", "handoff_id", "labeler_producer_id"):
            _text(packet[key], key)
        _fail(packet["tracking"] in {"complete", "partial"}, "Unknown auxiliary tracking status")
        for audit in packet["audits"]:
            _digest(audit["audit_sha256"], "audit_sha256")
            _text(audit["audit_id"], "audit_id")
            _text(audit["producer_id"], "audit producer_id")
        for ref in packet["human_evidence_refs"]:
            _digest(ref["source_sha256"], "Human evidence source hash")
            _digest(ref["observation_sha256"], "Human evidence observation hash")
            _text(ref["observation_id"], "Human evidence observation_id")
    all_rows = {}
    for subset, rows in tables.items():
        if subset == "sources":
            continue
        _fail([row["record_id"] for row in rows] == sorted(row["record_id"] for row in rows), "Judgment rows must have stable record ordering")
        for row in rows:
            _validate_judgment(row, subset, sources, manifest)
            _fail(row["record_id"] not in all_rows, "Duplicate immutable record identity")
            all_rows[row["record_id"]] = row
    for packet in manifest["provenance"].values():
        for ref in packet["human_evidence_refs"]:
            if ref.get("record_id") is not None:
                row = all_rows.get(ref["record_id"])
                _fail(row is not None and row["source_sha256"] == ref["source_sha256"] and row["observation_id"] == ref["observation_id"], "Human evidence record reference does not resolve")
    for row in all_rows.values():
        _fail(not set(row["supersedes_record_ids"]) & set(all_rows), "Snapshot contains superseded human observations")
    used_foundations = {row["foundation_id"] for row in all_rows.values()}
    used_provenance = {row["provenance_id"] for row in all_rows.values() if row["provenance_id"] is not None}
    _fail(used_foundations == set(manifest["foundations"]) and used_provenance == set(manifest["provenance"]), "Snapshot contains unused shared registries")
    used_methods = set(policy["agent_methods"]) | {packet["method_id"] for packet in manifest["provenance"].values()}
    _fail(used_methods == set(manifest["methods"]), "Snapshot contains unused methods")
    expected_counts = {"sources": len(sources), "human": len(tables["human"]), "agents": {key: len(tables["agent-" + key]) for key in policy["agent_methods"]}}
    _fail(manifest["counts"] == expected_counts, "Manifest counts disagree with tables")
    removed_ids = set()
    for removal in manifest["removed_records"]:
        _text(removal["record_id"], "Removed record ID")
        _text(removal["reason"], "Removal reason")
        _fail(removal["record_id"] not in all_rows and removal["record_id"] not in removed_ids, "Invalid removed record identity")
        removed_ids.add(removal["record_id"])
        for successor in removal.get("superseded_by", []):
            _fail(successor in all_rows and removal["record_id"] in all_rows[successor]["supersedes_record_ids"], "Removed record successor does not resolve")
    _fail(not removed_ids or manifest["previous_snapshot"] is not None, "Removed records require a previous snapshot reference")
    overlaps = 0
    groups: dict[tuple, list[dict]] = {}
    supervised_scopes: dict[tuple, tuple] = {}
    human_observation_ids = set()
    for row in tables["human"]:
        observation_key = (row["source_sha256"], row["observation_id"])
        _fail(observation_key not in human_observation_ids, "Duplicate human observation identity")
        human_observation_ids.add(observation_key)
        if row["presence"] in {"present", "absent"}:
            scope = (row["source_sha256"], row["start_ms"], row["end_ms"], row["tag_id"])
            assessment = (row["presence"], row["salience"])
            _fail(scope not in supervised_scopes or supervised_scopes[scope] == assessment, "Same-scope contradictory human gold requires resolution before publication")
            supervised_scopes[scope] = assessment
        key = (row["source_sha256"], row["tag_id"])
        group = groups.setdefault(key, [])
        overlaps += sum(other["start_ms"] < row["end_ms"] and other["end_ms"] > row["start_ms"] for other in group)
        group.append(row)
    return {"valid": True, "contract": CONTRACT, "version": VERSION, "release_id": manifest["release_id"], "counts": expected_counts, "files_verified": len(expected_files), "human_overlap_pairs": overlaps, "remote_references_checked": False, "source_bytes_retrieved": False, "annotation_quality_evaluated": False}
