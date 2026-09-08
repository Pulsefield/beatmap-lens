import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Optional display metadata; never part of source identity or agent task inputs. */
export function createCommunityTagReader(dataset) {
  let vocabulary;
  return async (source) => {
    if (!(source.beatmapSetId > 0 && source.beatmapId > 0)) return null;
    const metadata = await readOptionalJson(
      join(dataset, "0", String(source.beatmapSetId), "metadata.json"),
    );
    const beatmap = metadata?.beatmaps.find((entry) => entry.id === source.beatmapId);
    if (!beatmap) return null;
    const names = new Map(metadata.tags.related.map((tag) => [tag.id, tag.name]));
    const votes = beatmap.top_tag_ids;
    if (votes.some((tag) => !names.has(tag.tag_id))) {
      vocabulary ??= readOptionalJson(join(dataset, "metadata", "osu_tags_2026-08-07.json")).then(
        (catalogue) => new Map(catalogue?.tags.map((tag) => [tag.id, tag.name]) ?? []),
      );
      for (const [id, name] of await vocabulary) if (!names.has(id)) names.set(id, name);
    }
    const tags = votes.map(({ tag_id: id, count }) => ({
      id,
      name: names.get(id) ?? `#${id}`,
      count,
    }));
    tags.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return {
      tags,
      totalVotes: tags.reduce((sum, tag) => sum + tag.count, 0),
      fetchedAt: metadata.fetched_at,
    };
  };
}

async function readOptionalJson(path) {
  const text = await readFile(path, "utf8").catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  return text === null ? null : JSON.parse(text);
}
