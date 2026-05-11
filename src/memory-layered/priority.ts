// priority ranking for memory entries
// user preferences > facts > procedural knowledge (from Hermes design)
import type { MemoryEntry } from "./types"
import { MEMORY_PRIORITY_WEIGHT, MemoryPriority } from "./types"

export function rankByPriority(entries: MemoryEntry[]): MemoryEntry[] {
  return [...entries].sort((a, b) => {
    // primary sort: priority weight (higher = more important = first)
    const weightDiff =
      MEMORY_PRIORITY_WEIGHT[b.priority] - MEMORY_PRIORITY_WEIGHT[a.priority]
    if (weightDiff !== 0) return weightDiff
    // tiebreaker: recency (newer = more important = first)
    return b.timestamp - a.timestamp
  })
}