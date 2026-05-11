// layered memory types inspired by Hermes agent memory design
// provides short-term/long-term separation, priority hierarchy,
// character limits, frozen snapshots, and § delimiter dedup

export enum MemoryLayer {
  ShortTerm = "short_term",
  LongTerm = "long_term",
}

export enum MemoryPriority {
  UserPreference = "user_preference", // highest priority
  Fact = "fact", // medium priority
  Procedural = "procedural", // lowest priority
}

// priority weight for ranking (higher = more important)
export const MEMORY_PRIORITY_WEIGHT: Record<MemoryPriority, number> = {
  [MemoryPriority.UserPreference]: 3,
  [MemoryPriority.Fact]: 2,
  [MemoryPriority.Procedural]: 1,
}

export type MemoryEntry = {
  id: string
  content: string
  layer: MemoryLayer
  priority: MemoryPriority
  timestamp: number
  tags: string[]
  source: string // "session" | "promotion" | "dreaming" | "manual"
}

export type LayeredMemoryConfig = {
  shortTermMaxChars: number // max total chars in short-term layer
  longTermMaxChars: number // max chars per long-term entry
  antiThrashingCooldownMs: number // min time between compressions
  snapshotIntervalMs: number // auto-snapshot interval (not enforced in core)
}

export const DEFAULT_MEMORY_CONFIG: LayeredMemoryConfig = {
  shortTermMaxChars: 2200,
  longTermMaxChars: 1375,
  antiThrashingCooldownMs: 30000,
  snapshotIntervalMs: 60000,
}

export type FrozenSnapshot = {
  entries: MemoryEntry[]
  totalChars: number
  createdAt: number
}

export type ScrubHistoryEntry = {
  inputChars: number
  outputChars: number
  timestamp: number
}

export type MemoryScrubberConfig = {
  maxChars: number
  cooldownMs: number
}