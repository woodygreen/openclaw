// layered memory store with short-term/long-term separation,
// character limits, dedup, promotion, and frozen snapshots
import type {
  MemoryEntry,
  LayeredMemoryConfig,
  FrozenSnapshot,
} from "./types"
import { MemoryLayer, DEFAULT_MEMORY_CONFIG, MEMORY_PRIORITY_WEIGHT } from "./types"
import { rankByPriority } from "./priority"
import { dedupEntries } from "./dedup"

export function createLayeredMemoryStore(config?: Partial<LayeredMemoryConfig>) {
  const resolvedConfig: LayeredMemoryConfig = {
    ...DEFAULT_MEMORY_CONFIG,
    ...config,
  }

  const entries = new Map<string, MemoryEntry>()

  function add(entry: MemoryEntry): void {
    if (entries.has(entry.id)) {
      return // reject duplicate id
    }
    // enforce long-term per-entry character limit by truncating
    const finalEntry: MemoryEntry = { ...entry }
    if (entry.layer === MemoryLayer.LongTerm && entry.content.length > resolvedConfig.longTermMaxChars) {
      finalEntry.content = entry.content.slice(0, resolvedConfig.longTermMaxChars)
    }
    entries.set(entry.id, finalEntry)
    // enforce short-term total character limit by pruning lowest priority
    if (entry.layer === MemoryLayer.ShortTerm) {
      pruneShortTerm()
    }
  }

  function pruneShortTerm(): void {
    const stEntries = getByLayer(MemoryLayer.ShortTerm)
    const totalChars = stEntries.reduce((sum, e) => sum + e.content.length, 0)
    if (totalChars <= resolvedConfig.shortTermMaxChars) {
      return
    }
    // rank by priority (lowest first) then by recency (oldest first)
    // remove lowest priority / oldest entries until under limit
    const ranked = rankByPriority(stEntries).reverse() // lowest priority first
    let currentChars = totalChars
    for (const entry of ranked) {
      if (currentChars <= resolvedConfig.shortTermMaxChars) {
        break
      }
      entries.delete(entry.id)
      currentChars -= entry.content.length
    }
  }

  function remove(id: string): boolean {
    return entries.delete(id)
  }

  function getByLayer(layer: MemoryLayer): MemoryEntry[] {
    return [...entries.values()].filter((e) => e.layer === layer)
  }

  function getByTags(tags: string[]): MemoryEntry[] {
    if (tags.length === 0) return [...entries.values()]
    return [...entries.values()].filter((e) =>
      tags.some((tag) => e.tags.includes(tag)),
    )
  }

  function getByPriority(priority: MemoryPriority): MemoryEntry[] {
    return [...entries.values()].filter((e) => e.priority === priority)
  }

  function promote(id: string): boolean {
    const entry = entries.get(id)
    if (!entry || entry.layer !== MemoryLayer.ShortTerm) {
      return false
    }
    entries.delete(id)
    const promoted: MemoryEntry = {
      ...entry,
      layer: MemoryLayer.LongTerm,
      source: "promotion",
    }
    // enforce long-term per-entry limit
    if (promoted.content.length > resolvedConfig.longTermMaxChars) {
      promoted.content = promoted.content.slice(0, resolvedConfig.longTermMaxChars)
    }
    entries.set(id, promoted)
    return true
  }

  function getCharCount(layer: MemoryLayer): number {
    return getByLayer(layer).reduce((sum, e) => sum + e.content.length, 0)
  }

  function snapshot(): FrozenSnapshot {
    const allEntries = dedupEntries([...entries.values()])
    const totalChars = allEntries.reduce((sum, e) => sum + e.content.length, 0)
    return {
      entries: allEntries,
      totalChars,
      createdAt: Date.now(),
    }
  }

  function getAll(): MemoryEntry[] {
    return [...entries.values()]
  }

  return {
    add,
    remove,
    getByLayer,
    getByTags,
    getByPriority,
    promote,
    getCharCount,
    snapshot,
    getAll,
    get config() { return resolvedConfig },
  }
}