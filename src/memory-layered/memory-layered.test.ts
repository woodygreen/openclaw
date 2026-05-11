import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  MemoryLayer,
  MemoryPriority,
  type MemoryEntry,
  type LayeredMemoryConfig,
  type FrozenSnapshot,
} from "./types"
import { createLayeredMemoryStore } from "./layered-store"
import { createMemoryScrubber } from "./memory-scrubber"
import { rankByPriority } from "./priority"
import { dedupEntries, dedupContent } from "./dedup"

describe("LayeredMemoryStore", () => {
  const defaultConfig: LayeredMemoryConfig = {
    shortTermMaxChars: 2200,
    longTermMaxChars: 1375,
    antiThrashingCooldownMs: 30000,
    snapshotIntervalMs: 60000,
  }

  it("should add entries to short-term layer", () => {
    const store = createLayeredMemoryStore(defaultConfig)
    const entry: MemoryEntry = {
      id: "st-1",
      content: "user prefers dark mode",
      layer: MemoryLayer.ShortTerm,
      priority: MemoryPriority.UserPreference,
      timestamp: Date.now(),
      tags: ["preference", "ui"],
      source: "session",
    }
    store.add(entry)
    const entries = store.getByLayer(MemoryLayer.ShortTerm)
    expect(entries).toHaveLength(1)
    expect(entries[0].content).toBe("user prefers dark mode")
  })

  it("should add entries to long-term layer", () => {
    const store = createLayeredMemoryStore(defaultConfig)
    const entry: MemoryEntry = {
      id: "lt-1",
      content: "project uses React 18 with TypeScript",
      layer: MemoryLayer.LongTerm,
      priority: MemoryPriority.Fact,
      timestamp: Date.now(),
      tags: ["project", "tech"],
      source: "promotion",
    }
    store.add(entry)
    const entries = store.getByLayer(MemoryLayer.LongTerm)
    expect(entries).toHaveLength(1)
    expect(entries[0].content).toBe("project uses React 18 with TypeScript")
  })

  it("should reject duplicate entries by id", () => {
    const store = createLayeredMemoryStore(defaultConfig)
    const entry: MemoryEntry = {
      id: "dup-1",
      content: "first version",
      layer: MemoryLayer.ShortTerm,
      priority: MemoryPriority.Fact,
      timestamp: Date.now(),
      tags: [],
      source: "session",
    }
    store.add(entry)
    const dup: MemoryEntry = {
      ...entry,
      content: "second version",
    }
    store.add(dup)
    const entries = store.getByLayer(MemoryLayer.ShortTerm)
    expect(entries).toHaveLength(1)
    expect(entries[0].content).toBe("first version")
  })

  it("should enforce short-term character limit", () => {
    const store = createLayeredMemoryStore({
      ...defaultConfig,
      shortTermMaxChars: 100,
    })
    // Add entries totaling more than 100 chars
    store.add({
      id: "s1",
      content: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", // 31 chars
      layer: MemoryLayer.ShortTerm,
      priority: MemoryPriority.Fact,
      timestamp: 1000,
      tags: [],
      source: "session",
    })
    store.add({
      id: "s2",
      content: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", // 31 chars
      layer: MemoryLayer.ShortTerm,
      priority: MemoryPriority.UserPreference, // higher priority
      timestamp: 2000,
      tags: [],
      source: "session",
    })
    store.add({
      id: "s3",
      content: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC", // 31 chars
      layer: MemoryLayer.ShortTerm,
      priority: MemoryPriority.Procedural, // lowest priority
      timestamp: 3000,
      tags: [],
      source: "session",
    })
    store.add({
      id: "s4",
      content: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDD", // 31 chars
      layer: MemoryLayer.ShortTerm,
      priority: MemoryPriority.Procedural,
      timestamp: 4000,
      tags: [],
      source: "session",
    })
    // Should prune lowest priority to stay under limit
    const entries = store.getByLayer(MemoryLayer.ShortTerm)
    const totalChars = entries.reduce((sum, e) => sum + e.content.length, 0)
    expect(totalChars).toBeLessThanOrEqual(100)
  })

  it("should enforce long-term character limit per entry", () => {
    const store = createLayeredMemoryStore({
      ...defaultConfig,
      longTermMaxChars: 50,
    })
    const longEntry: MemoryEntry = {
      id: "lt-long",
      content: "This is a very long entry that exceeds the per-entry character limit and should be truncated",
      layer: MemoryLayer.LongTerm,
      priority: MemoryPriority.Fact,
      timestamp: Date.now(),
      tags: [],
      source: "promotion",
    }
    store.add(longEntry)
    const entries = store.getByLayer(MemoryLayer.LongTerm)
    expect(entries[0].content.length).toBeLessThanOrEqual(50)
  })

  it("should remove entries by id", () => {
    const store = createLayeredMemoryStore(defaultConfig)
    store.add({
      id: "rm-1",
      content: "to be removed",
      layer: MemoryLayer.ShortTerm,
      priority: MemoryPriority.Fact,
      timestamp: Date.now(),
      tags: [],
      source: "session",
    })
    store.remove("rm-1")
    expect(store.getByLayer(MemoryLayer.ShortTerm)).toHaveLength(0)
  })

  it("should promote entry from short-term to long-term", () => {
    const store = createLayeredMemoryStore(defaultConfig)
    store.add({
      id: "promote-1",
      content: "user always prefers concise responses",
      layer: MemoryLayer.ShortTerm,
      priority: MemoryPriority.UserPreference,
      timestamp: Date.now(),
      tags: ["preference"],
      source: "session",
    })
    store.promote("promote-1")
    expect(store.getByLayer(MemoryLayer.ShortTerm)).toHaveLength(0)
    const ltEntries = store.getByLayer(MemoryLayer.LongTerm)
    expect(ltEntries).toHaveLength(1)
    expect(ltEntries[0].content).toBe("user always prefers concise responses")
    expect(ltEntries[0].layer).toBe(MemoryLayer.LongTerm)
  })

  it("should create frozen snapshot of current state", () => {
    const store = createLayeredMemoryStore(defaultConfig)
    store.add({
      id: "snap-1",
      content: "snapshot content",
      layer: MemoryLayer.ShortTerm,
      priority: MemoryPriority.Fact,
      timestamp: Date.now(),
      tags: ["snap"],
      source: "session",
    })
    const snapshot = store.snapshot()
    expect(snapshot.entries).toHaveLength(1)
    expect(snapshot.totalChars).toBe("snapshot content".length)
    expect(snapshot.createdAt).toBeGreaterThan(0)
  })

  it("should preserve snapshot after subsequent changes", () => {
    const store = createLayeredMemoryStore(defaultConfig)
    store.add({
      id: "sp-1",
      content: "original",
      layer: MemoryLayer.ShortTerm,
      priority: MemoryPriority.Fact,
      timestamp: Date.now(),
      tags: [],
      source: "session",
    })
    const snapshot = store.snapshot()
    // Modify store after snapshot
    store.add({
      id: "sp-2",
      content: "added later",
      layer: MemoryLayer.ShortTerm,
      priority: MemoryPriority.Fact,
      timestamp: Date.now(),
      tags: [],
      source: "session",
    })
    // Snapshot should still have 1 entry
    expect(snapshot.entries).toHaveLength(1)
    expect(snapshot.entries[0].content).toBe("original")
  })

  it("should return entries filtered by tags", () => {
    const store = createLayeredMemoryStore(defaultConfig)
    store.add({
      id: "tag-1",
      content: "preference info",
      layer: MemoryLayer.ShortTerm,
      priority: MemoryPriority.UserPreference,
      timestamp: Date.now(),
      tags: ["preference", "ui"],
      source: "session",
    })
    store.add({
      id: "tag-2",
      content: "project info",
      layer: MemoryLayer.ShortTerm,
      priority: MemoryPriority.Fact,
      timestamp: Date.now(),
      tags: ["project", "tech"],
      source: "session",
    })
    const uiEntries = store.getByTags(["ui"])
    expect(uiEntries).toHaveLength(1)
    expect(uiEntries[0].id).toBe("tag-1")
  })

  it("should return entries filtered by priority", () => {
    const store = createLayeredMemoryStore(defaultConfig)
    store.add({
      id: "pri-1",
      content: "pref",
      layer: MemoryLayer.ShortTerm,
      priority: MemoryPriority.UserPreference,
      timestamp: Date.now(),
      tags: [],
      source: "session",
    })
    store.add({
      id: "pri-2",
      content: "fact",
      layer: MemoryLayer.ShortTerm,
      priority: MemoryPriority.Fact,
      timestamp: Date.now(),
      tags: [],
      source: "session",
    })
    const prefs = store.getByPriority(MemoryPriority.UserPreference)
    expect(prefs).toHaveLength(1)
    expect(prefs[0].id).toBe("pri-1")
  })

  it("should get total char count for a layer", () => {
    const store = createLayeredMemoryStore(defaultConfig)
    store.add({
      id: "cnt-1",
      content: "hello world", // 11 chars
      layer: MemoryLayer.ShortTerm,
      priority: MemoryPriority.Fact,
      timestamp: Date.now(),
      tags: [],
      source: "session",
    })
    store.add({
      id: "cnt-2",
      content: "another entry", // 13 chars
      layer: MemoryLayer.ShortTerm,
      priority: MemoryPriority.Fact,
      timestamp: Date.now(),
      tags: [],
      source: "session",
    })
    expect(store.getCharCount(MemoryLayer.ShortTerm)).toBe(24)
  })
})

describe("Memory Priority Ranking", () => {
  it("should rank user preferences highest", () => {
    const entries: MemoryEntry[] = [
      {
        id: "1",
        content: "fact",
        layer: MemoryLayer.LongTerm,
        priority: MemoryPriority.Fact,
        timestamp: Date.now(),
        tags: [],
        source: "promotion",
      },
      {
        id: "2",
        content: "procedure",
        layer: MemoryLayer.LongTerm,
        priority: MemoryPriority.Procedural,
        timestamp: Date.now(),
        tags: [],
        source: "promotion",
      },
      {
        id: "3",
        content: "user preference",
        layer: MemoryLayer.LongTerm,
        priority: MemoryPriority.UserPreference,
        timestamp: Date.now(),
        tags: [],
        source: "session",
      },
    ]
    const ranked = rankByPriority(entries)
    expect(ranked[0].priority).toBe(MemoryPriority.UserPreference)
  })

  it("should sort by priority: user_preference > fact > procedural", () => {
    const entries: MemoryEntry[] = [
      {
        id: "1",
        content: "proc",
        layer: MemoryLayer.LongTerm,
        priority: MemoryPriority.Procedural,
        timestamp: Date.now(),
        tags: [],
        source: "promotion",
      },
      {
        id: "2",
        content: "fact",
        layer: MemoryLayer.LongTerm,
        priority: MemoryPriority.Fact,
        timestamp: Date.now(),
        tags: [],
        source: "promotion",
      },
      {
        id: "3",
        content: "pref",
        layer: MemoryLayer.LongTerm,
        priority: MemoryPriority.UserPreference,
        timestamp: Date.now(),
        tags: [],
        source: "session",
      },
    ]
    const ranked = rankByPriority(entries)
    expect(ranked.map((e) => e.priority)).toEqual([
      MemoryPriority.UserPreference,
      MemoryPriority.Fact,
      MemoryPriority.Procedural,
    ])
  })

  it("should use recency as tiebreaker within same priority", () => {
    const now = Date.now()
    const entries: MemoryEntry[] = [
      {
        id: "1",
        content: "older fact",
        layer: MemoryLayer.LongTerm,
        priority: MemoryPriority.Fact,
        timestamp: now - 10000,
        tags: [],
        source: "promotion",
      },
      {
        id: "2",
        content: "newer fact",
        layer: MemoryLayer.LongTerm,
        priority: MemoryPriority.Fact,
        timestamp: now,
        tags: [],
        source: "promotion",
      },
    ]
    const ranked = rankByPriority(entries)
    expect(ranked[0].content).toBe("newer fact")
  })
})

describe("Memory Dedup", () => {
  it("should deduplicate entries with § delimiter in content", () => {
    const result = dedupContent("user likes dark mode§user likes dark mode§user prefers dark mode")
    expect(result).toBe("user likes dark mode§user prefers dark mode")
  })

  it("should deduplicate entries by content similarity", () => {
    const entries: MemoryEntry[] = [
      {
        id: "d1",
        content: "user prefers dark mode",
        layer: MemoryLayer.ShortTerm,
        priority: MemoryPriority.UserPreference,
        timestamp: 1000,
        tags: ["ui"],
        source: "session",
      },
      {
        id: "d2",
        content: "user prefers dark mode", // exact duplicate
        layer: MemoryLayer.ShortTerm,
        priority: MemoryPriority.UserPreference,
        timestamp: 2000,
        tags: ["ui"],
        source: "session",
      },
    ]
    const deduped = dedupEntries(entries)
    expect(deduped).toHaveLength(1)
  })

  it("should keep the more recent entry when deduplicating", () => {
    const entries: MemoryEntry[] = [
      {
        id: "d1",
        content: "user prefers concise responses",
        layer: MemoryLayer.ShortTerm,
        priority: MemoryPriority.UserPreference,
        timestamp: 1000,
        tags: [],
        source: "session",
      },
      {
        id: "d2",
        content: "user prefers concise responses",
        layer: MemoryLayer.ShortTerm,
        priority: MemoryPriority.UserPreference,
        timestamp: 2000,
        tags: [],
        source: "session",
      },
    ]
    const deduped = dedupEntries(entries)
    expect(deduped).toHaveLength(1)
    expect(deduped[0].timestamp).toBe(2000)
  })

  it("should handle § delimiter at content boundaries", () => {
    const result = dedupContent("§leading delimiter§trailing delimiter§")
    expect(result).not.toContain("§§")
  })

  it("should not deduplicate substantively different content", () => {
    const entries: MemoryEntry[] = [
      {
        id: "d1",
        content: "user prefers dark mode",
        layer: MemoryLayer.ShortTerm,
        priority: MemoryPriority.UserPreference,
        timestamp: 1000,
        tags: [],
        source: "session",
      },
      {
        id: "d2",
        content: "user prefers light mode",
        layer: MemoryLayer.ShortTerm,
        priority: MemoryPriority.UserPreference,
        timestamp: 2000,
        tags: [],
        source: "session",
      },
    ]
    const deduped = dedupEntries(entries)
    expect(deduped).toHaveLength(2)
  })
})

describe("MemoryScrubber", () => {
  it("should scrub redundant content from streaming context", () => {
    const scrubber = createMemoryScrubber({
      maxChars: 60, // force scrubbing by setting limit below original length
      cooldownMs: 0,
    })
    const context = "The project uses React§The project uses React§The project uses TypeScript"
    const scrubbed = scrubber.scrub(context)
    expect(scrubbed.length).toBeLessThan(context.length)
    expect(scrubbed).toContain("TypeScript")
  })

  it("should not scrub if under max chars", () => {
    const scrubber = createMemoryScrubber({
      maxChars: 500,
      cooldownMs: 30000,
    })
    const context = "short content under limit"
    const scrubbed = scrubber.scrub(context)
    expect(scrubbed).toBe("short content under limit")
  })

  it("should enforce anti-thrashing: skip scrub if recently scrubbed", () => {
    const scrubber = createMemoryScrubber({
      maxChars: 100,
      cooldownMs: 5000,
    })
    // First scrub
    const longContext = "A".repeat(200)
    const first = scrubber.scrub(longContext)
    expect(first.length).toBeLessThanOrEqual(100)
    // Immediate second scrub should be skipped (anti-thrashing)
    const second = scrubber.scrub(longContext)
    // Second scrub should return input unchanged due to cooldown
    expect(second).toBe(longContext)
  })

  it("should allow scrub after cooldown period", () => {
    const scrubber = createMemoryScrubber({
      maxChars: 100,
      cooldownMs: 100, // very short cooldown for test
    })
    const longContext = "A".repeat(200)
    scrubber.scrub(longContext)
    // Wait for cooldown
    scrubber.resetCooldown()
    const scrubbed = scrubber.scrub(longContext)
    expect(scrubbed.length).toBeLessThanOrEqual(100)
  })

  it("should compress by priority when over limit", () => {
    const scrubber = createMemoryScrubber({
      maxChars: 60,
      cooldownMs: 0,
    })
    // Build content with § delimited sections of different importance
    const context =
      "user prefers dark mode§" + // user_preference (12+§=13)
      "project uses React 18§" + // fact (16+§=17)
      "run npm test after changes§" + // procedural (22+§=23)
      "always use 2 spaces indent§" + // procedural (23+§=24)
      "deploy on Fridays§" // fact (16)
    // Total ~93 chars, need to compress to ~60
    const scrubbed = scrubber.scrub(context)
    expect(scrubbed.length).toBeLessThanOrEqual(60)
    // Should preserve user preference content
    expect(scrubbed).toContain("user prefers")
  })

  it("should track scrub history", () => {
    const scrubber = createMemoryScrubber({
      maxChars: 100,
      cooldownMs: 0,
    })
    scrubber.scrub("A".repeat(200))
    scrubber.scrub("B".repeat(200))
    const history = scrubber.getHistory()
    expect(history.length).toBeGreaterThanOrEqual(2)
    expect(history[0].inputChars).toBe(200)
    expect(history[0].outputChars).toBeLessThanOrEqual(100)
  })
})