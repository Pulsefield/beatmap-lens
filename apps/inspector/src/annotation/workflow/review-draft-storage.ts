const prefix = "beatmap-lens-review-draft:";

/** Local drafts must never block a canonical workspace write. */
export class ReviewDraftStorage {
  private readonly pending = new Map<string, string | null>();

  constructor(private readonly storage: () => Storage) {}

  get(key: string): string | null {
    if (this.pending.has(key)) return this.pending.get(key) ?? null;
    try {
      return this.storage().getItem(key);
    } catch {
      return null;
    }
  }

  set(key: string, value: unknown): void {
    const text = JSON.stringify(value);
    this.pending.set(key, text);
    try {
      this.storage().setItem(key, text);
      this.pending.delete(key);
    } catch {
      // Existing pretty-printed drafts can exhaust the shared origin quota.
      // Compact only our JSON, preserving every judgment and unrelated key.
      this.compact();
      try {
        this.storage().setItem(key, text);
        this.pending.delete(key);
      } catch {
        // Keep the latest draft in this page session, including across remounts.
      }
    }
  }

  remove(key: string): void {
    this.pending.set(key, null);
    try {
      this.storage().removeItem(key);
      this.pending.delete(key);
    } catch {
      // A stale persisted draft must not shadow a completed save in this page.
    }
  }

  unsaved(): Record<string, unknown> {
    return Object.fromEntries(
      [...this.pending].flatMap(([key, value]) =>
        value === null ? [] : [[key, JSON.parse(value)]],
      ),
    );
  }

  private compact(): void {
    try {
      const storage = this.storage();
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (!key?.startsWith(prefix)) continue;
        try {
          const value = storage.getItem(key);
          if (!value) continue;
          const compact = JSON.stringify(JSON.parse(value));
          if (compact.length < value.length) storage.setItem(key, compact);
        } catch {
          // Leave unreadable or unavailable drafts intact.
        }
      }
    } catch {
      // Storage may be unavailable, even for reads.
    }
  }
}

export const reviewDraftStorage = new ReviewDraftStorage(() => localStorage);
