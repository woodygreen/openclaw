// memory-layered module barrel export
export {
  MemoryLayer,
  MemoryPriority,
  MEMORY_PRIORITY_WEIGHT,
  DEFAULT_MEMORY_CONFIG,
} from "./types"
export type {
  MemoryEntry,
  LayeredMemoryConfig,
  FrozenSnapshot,
  ScrubHistoryEntry,
  MemoryScrubberConfig,
} from "./types"
export { createLayeredMemoryStore } from "./layered-store"
export { createMemoryScrubber } from "./memory-scrubber"
export { rankByPriority } from "./priority"
export { dedupContent, dedupEntries } from "./dedup"