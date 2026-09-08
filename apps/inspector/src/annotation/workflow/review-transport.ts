/** Lossless HTTP representation; canonical files and their hashes are unchanged. */
export function encodeReviewResponse(value: unknown): string {
  const values: string[] = [];
  const references = new Map<string, number>();
  const identities = new WeakMap<object, number>();
  const body = JSON.stringify(value, (key, item) => {
    if ((key !== "sourceBytes" && key !== "foundation") || !item || typeof item !== "object")
      return item;
    let index = identities.get(item);
    if (index === undefined) {
      const text = JSON.stringify(item);
      index = references.get(text);
      if (index === undefined) {
        index = values.length;
        references.set(text, index);
        values.push(text);
      }
      identities.set(item, index);
    }
    return { $reviewRef: index };
  });
  return `{"format":"review-shared-v1","values":[${values.join(",")}],"value":${body}}`;
}

export function decodeReviewResponse<T>(input: unknown): T {
  const packet = input as { format?: string; values: unknown[]; value: unknown };
  if (packet?.format !== "review-shared-v1") return input as T;
  const expand = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value;
    if ("$reviewRef" in value && Object.keys(value).length === 1)
      return packet.values[value.$reviewRef as number];
    for (const [key, child] of Object.entries(value))
      (value as Record<string, unknown>)[key] = expand(child);
    return value;
  };
  return expand(packet.value) as T;
}
