// memory scrubber: streaming context scrubber with anti-thrashing protection
// inspired by Hermes StreamingContextScrubber design
// removes redundancy, compresses by priority, and prevents thrashing

import type { MemoryScrubberConfig, ScrubHistoryEntry } from "./types"
import { dedupContent } from "./dedup"

const SECTION_DELIMITER = "§"

// priority keywords for heuristic compression
const PRIORITY_KEYWORDS: Record<string, number> = {
  "user prefers": 3,
  "user likes": 3,
  "user wants": 3,
  "always": 3,
  "never": 3,
  "project uses": 2,
  "important": 2,
  "always use": 1,
  "run": 1,
  "execute": 1,
}

export function createMemoryScrubber(config: MemoryScrubberConfig) {
  const history: ScrubHistoryEntry[] = []
  let lastScrubTime = 0

  function segmentPriority(segment: string): number {
    const lower = segment.toLowerCase()
    for (const [keyword, weight] of Object.entries(PRIORITY_KEYWORDS)) {
      if (lower.includes(keyword)) return weight
    }
    return 1 // default: procedural
  }

  function scrub(context: string): string {
    const now = Date.now()

    // anti-thrashing: skip if recently scrubbed and cooldown hasn't elapsed
    if (lastScrubTime > 0 && now - lastScrubTime < config.cooldownMs) {
      return context
    }

    // no scrub needed if under limit
    if (context.length <= config.maxChars) {
      return context
    }

    // first pass: § dedup
    const deduped = dedupContent(context)
    if (deduped.length <= config.maxChars) {
      recordScrub(context.length, deduped.length)
      lastScrubTime = now
      return deduped
    }

    // second pass: segment and compress by priority
    const segments = deduped
      .split(SECTION_DELIMITER)
      .filter((s) => s.trim())
      .map((s) => ({ text: s.trim(), priority: segmentPriority(s) }))

    // sort segments by priority (highest first) and keep until under limit
    const ranked = segments.sort((a, b) => b.priority - a.priority)

    let totalChars = 0
    const kept: string[] = []
    for (const seg of ranked) {
      if (totalChars + seg.text.length + (kept.length > 0 ? 1 : 0) <= config.maxChars) {
        kept.push(seg.text)
        totalChars += seg.text.length + (kept.length > 1 ? 1 : 0)
      }
    }

    const result = kept.join(SECTION_DELIMITER)
    recordScrub(context.length, result.length)
    lastScrubTime = now
    return result
  }

  function recordScrub(inputChars: number, outputChars: number): void {
    history.push({
      inputChars,
      outputChars,
      timestamp: Date.now(),
    })
  }

  function resetCooldown(): void {
    lastScrubTime = 0
  }

  function getHistory(): ScrubHistoryEntry[] {
    return [...history]
  }

  return { scrub, resetCooldown, getHistory }
}