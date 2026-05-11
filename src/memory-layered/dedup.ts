// § delimiter dedup for memory content
// inspired by Hermes agent memory design: uses § delimiter to segment
// memory content and remove duplicate segments

import type { MemoryEntry } from "./types"
import { rankByPriority } from "./priority"

const SECTION_DELIMITER = "§"

// deduplicate §-delimited content by removing duplicate segments
export function dedupContent(content: string): string {
  if (!content) return content
  const segments = content.split(SECTION_DELIMITER).filter((s) => s.trim())
  if (segments.length === 0) return ""

  const seen = new Set<string>()
  const unique: string[] = []
  for (const segment of segments) {
    const normalized = segment.trim().toLowerCase()
    if (!seen.has(normalized)) {
      seen.add(normalized)
      unique.push(segment.trim())
    }
  }
  return unique.join(SECTION_DELIMITER)
}

// deduplicate entries by content (keep the more recent / higher priority one)
export function dedupEntries(entries: MemoryEntry[]): MemoryEntry[] {
  if (entries.length <= 1) return entries

  const seen = new Map<string, MemoryEntry>()
  for (const entry of entries) {
    const normalized = entry.content.trim().toLowerCase()
    const existing = seen.get(normalized)
    if (!existing) {
      seen.set(normalized, entry)
    } else {
      // keep the entry with higher priority or more recent timestamp
      if (
        entry.priority !== existing.priority &&
        (entry.priority === "user_preference" ||
          (entry.priority === "fact" && existing.priority === "procedural"))
      ) {
        seen.set(normalized, entry)
      } else if (entry.timestamp > existing.timestamp) {
        seen.set(normalized, entry)
      }
    }
  }
  return rankByPriority([...seen.values()])
}