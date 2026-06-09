// Dirty Tracker — tracks whether local data has changed since the last cloud sync.
// Call markDirty() after any write operation (create, update, delete).

let dirty = false

export function markDirty(): void {
  dirty = true
}

export function isDirty(): boolean {
  return dirty
}

export function clearDirty(): void {
  dirty = false
}
