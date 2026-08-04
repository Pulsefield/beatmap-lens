import { describe, expect, it } from "vitest";
import { hashFoundationV1, serializeFoundationV1 } from "./canonical-json";
import type { AnnotationDocumentV1, DatasetManifestV1 } from "./contracts";
import { DATASET_CONTRACT } from "./contracts";
import type { DatasetDirectory } from "./dataset-directory";
import { buildGoldRelease, sameGoldReleaseArtifact, writeGoldRelease } from "./release";
import { FakeDirectoryHandle, fixtureDocument, fixtureFoundation } from "./test-helpers";

describe("buildGoldRelease", () => {
  it("exports only completed gold, exact Foundations, and aggregate statistics", async () => {
    const foundation = fixtureFoundation();
    const foundationRef = {
      foundationId: foundation.foundationId,
      revision: foundation.revision,
      sha256: await hashFoundationV1(foundation),
    };
    const localRoot = "/Users/expert/private/osu";
    const localFilename = "secret-chart.osu";
    const complete = {
      ...fixtureDocument(foundationRef, { reviewState: "complete" }),
      localCorpusRoot: localRoot,
      predictions: [
        {
          createdAt: "2026-08-04T00:00:00.000Z",
          foundation: foundationRef,
          id: "00000000-0000-4000-8000-000000000020",
          labels: [{ salience: 2 as const, tagId: "stream" }],
          modelVersion: "model-private",
          noteRefs: [
            {
              column: 0,
              endMs: 1_000,
              kind: "normal" as const,
              objectSha256: "c".repeat(64),
              sourceLine: 42,
              startMs: 1_000,
            },
          ],
          producerId: "agent-private",
          range: { endMs: 2_000, startMs: 500 },
          reviewStatus: "reviewed" as const,
          skillVersion: "skill-private",
        },
      ],
      reviewNotes: [
        {
          createdAt: "2026-08-04T00:00:00.000Z",
          id: "00000000-0000-4000-8000-000000000021",
          state: "resolved" as const,
          text: "private reviewer observation",
        },
      ],
      source: {
        ...fixtureDocument(foundationRef).source,
        localFilename,
      },
    } as AnnotationDocumentV1;
    const inProgress = fixtureDocument(foundationRef, {
      sourceSha256: "e".repeat(64),
    });
    const directory = releaseDataset(complete, inProgress, foundationRef.sha256);

    const artifact = await buildGoldRelease(directory, "2026-08-04T01:02:03.000Z");
    expect(
      sameGoldReleaseArtifact(
        artifact,
        await buildGoldRelease(directory, artifact.manifest.exportedAt),
      ),
    ).toBe(true);
    expect(sameGoldReleaseArtifact(artifact, { ...artifact, goldJsonl: "" })).toBe(false);
    const rows = artifact.goldJsonl
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("predictions");
    expect(rows[0]).not.toHaveProperty("reviewNotes");
    expect(artifact.manifest).toMatchObject({
      annotationCount: 1,
      documentCount: 1,
      durationDistribution: {
        maximumMs: 1_500,
        meanMs: 1_500,
        medianMs: 1_500,
        minimumMs: 1_500,
        p90Ms: 1_500,
        totalMs: 1_500,
      },
      salienceCounts: { "1": 1, "2": 1 },
      tagCounts: { jack: 1, stream: 1 },
    });
    expect(artifact.manifest.sourceSha256s).toEqual(["b".repeat(64)]);
    expect(artifact.foundations).toEqual([
      {
        filename: `${foundationRef.sha256}.judgment-foundation.v1.json`,
        source: serializeFoundationV1(foundation),
      },
    ]);

    const completeOutput = JSON.stringify(artifact);
    expect(completeOutput).not.toContain(localRoot);
    expect(completeOutput).not.toContain(localFilename);
    expect(completeOutput).not.toContain("agent-private");
    expect(completeOutput).not.toContain("private reviewer observation");
    expect(completeOutput).not.toContain("e".repeat(64));

    const root = new FakeDirectoryHandle();
    const datasetFile = await root.getFileHandle("dataset.json", { create: true });
    datasetFile.setText(
      JSON.stringify({
        contract: DATASET_CONTRACT,
        datasetId: artifact.manifest.datasetId,
        version: 1,
      }),
    );
    await root.getDirectoryHandle("exports", { create: true });
    const written = await writeGoldRelease(root, artifact);
    const exportsDirectory = await root.getDirectoryHandle("exports");
    const releaseDirectory = await exportsDirectory.getDirectoryHandle(written.releaseId);
    expect(
      await (await (await releaseDirectory.getFileHandle("release.json")).getFile()).text(),
    ).toBe(artifact.releaseJson);
    expect(
      await (
        await (await releaseDirectory.getFileHandle("gold-sections.v1.jsonl")).getFile()
      ).text(),
    ).toBe(artifact.goldJsonl);
    const writtenFoundations = await releaseDirectory.getDirectoryHandle("foundations");
    expect(
      await (
        await (
          await writtenFoundations.getFileHandle(
            `${foundationRef.sha256}.judgment-foundation.v1.json`,
          )
        ).getFile()
      ).text(),
    ).toBe(serializeFoundationV1(foundation));

    const wrongRoot = new FakeDirectoryHandle();
    const wrongDatasetFile = await wrongRoot.getFileHandle("dataset.json", { create: true });
    wrongDatasetFile.setText(
      JSON.stringify({
        contract: DATASET_CONTRACT,
        datasetId: "00000000-0000-4000-8000-000000000099",
        version: 1,
      }),
    );
    await wrongRoot.getDirectoryHandle("exports", { create: true });
    await expect(writeGoldRelease(wrongRoot, artifact)).rejects.toThrow(/dataset ID/);
  });

  it("fails closed when a complete sidecar still has unresolved review work", async () => {
    const foundation = fixtureFoundation();
    const foundationRef = {
      foundationId: foundation.foundationId,
      revision: foundation.revision,
      sha256: await hashFoundationV1(foundation),
    };
    const incomplete = {
      ...fixtureDocument(foundationRef, { reviewState: "complete" }),
      reviewNotes: [
        {
          createdAt: "2026-08-04T00:00:00.000Z",
          id: "00000000-0000-4000-8000-000000000021",
          state: "open" as const,
          text: "still needs review",
        },
      ],
    };

    await expect(
      buildGoldRelease(
        releaseDataset(
          incomplete,
          fixtureDocument(foundationRef, { sourceSha256: "e".repeat(64) }),
          foundationRef.sha256,
        ),
      ),
    ).rejects.toThrow(/incompletely reviewed chart/);
  });
});

function releaseDataset(
  complete: AnnotationDocumentV1,
  inProgress: AnnotationDocumentV1,
  foundationSha256: string,
): DatasetDirectory {
  const manifest: DatasetManifestV1 = {
    annotationContractVersion: 1,
    catalogSources: [],
    contract: DATASET_CONTRACT,
    createdAt: "2026-08-04T00:00:00.000Z",
    currentFoundation: {
      foundationId: fixtureFoundation().foundationId,
      revision: 1,
      sha256: foundationSha256,
    },
    datasetId: "00000000-0000-4000-8000-000000000010",
    name: "Fixture",
    updatedAt: "2026-08-04T00:00:00.000Z",
    version: 1,
  };

  return {
    manifest,
    readAnnotation: async () => null,
    readFoundation: async () => fixtureFoundation(),
    saveAnnotation: async () => ({ actual: null, status: "conflict" }),
    scanAnnotations: async () =>
      [complete, inProgress].map((document) => ({
        document,
        filename: `${document.source.sha256}.section-annotations.v1.json`,
        status: "ok" as const,
        version: { revision: 1, sha256: "f".repeat(64) },
      })),
    setCurrentFoundation: async () => manifest.currentFoundation,
    writeFoundation: async () => manifest.currentFoundation,
  };
}
