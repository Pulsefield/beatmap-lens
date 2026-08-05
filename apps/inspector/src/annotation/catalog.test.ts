import { describe, expect, it } from "vitest";
import { parseCatalogManifest, readCatalogTask } from "./catalog";
import { FakeDirectoryHandle } from "./test-helpers";

describe("catalog manifest", () => {
  it("strips the local corpus root and resolves only through granted handles", async () => {
    const localRoot = "/Users/expert/private/osu";
    const manifest = JSON.stringify({
      catalog: {
        categoryEnum: ["stream", "jack"],
        sha256: "a".repeat(64),
        source: "https://example.test/catalog.csv",
      },
      corpus: { root: localRoot },
      pathCategories: {
        [`${localRoot}/set/chart.osu`]: ["stream"],
      },
      version: 1,
    });

    const catalog = parseCatalogManifest(manifest);
    expect(JSON.stringify(catalog)).not.toContain(localRoot);
    expect(catalog.tasks[0]).toEqual({
      categories: ["stream"],
      pathSegments: ["set", "chart.osu"],
    });

    const corpus = new FakeDirectoryHandle("corpus");
    const set = await corpus.getDirectoryHandle("set", { create: true });
    const chart = await set.getFileHandle("chart.osu", { create: true });
    chart.setText("osu file format v14\n");
    const task = catalog.tasks[0];
    if (!task) throw new Error("expected catalog task");

    expect(await (await readCatalogTask(corpus, task)).text()).toBe("osu file format v14\n");
  });

  it("rejects mappings outside the declared corpus root", () => {
    expect(() =>
      parseCatalogManifest(
        JSON.stringify({
          catalog: {
            categoryEnum: [],
            sha256: "a".repeat(64),
            source: "fixture.csv",
          },
          corpus: { root: "/corpus" },
          pathCategories: { "/other/chart.osu": [] },
          version: 1,
        }),
      ),
    ).toThrow("outside its corpus root");
  });
});
