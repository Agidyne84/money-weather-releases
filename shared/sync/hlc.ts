// Hybrid Logical Clock (HLC)
//
// Produces monotonically increasing, globally comparable timestamps across devices
// whose wall clocks may drift. Encoded as a fixed-width string so plain string
// comparison (and SQLite ORDER BY) yields the correct causal order:
//
//   "<wallMs 15 digits>-<counter 6 hex>-<nodeId>"
//
// Ties on wall+counter are broken deterministically by nodeId.

export interface Hlc {
  wall: number
  counter: number
  node: string
}

const WALL_DIGITS = 15
const COUNTER_HEX = 6
const MAX_COUNTER = 0xffffff
// Refuse remote timestamps absurdly far in the future (protects against a device
// with a broken clock dragging every other device's clock forward forever).
export const MAX_DRIFT_MS = 24 * 60 * 60 * 1000

export function encodeHlc(h: Hlc): string {
  return (
    String(h.wall).padStart(WALL_DIGITS, '0') +
    '-' +
    h.counter.toString(16).padStart(COUNTER_HEX, '0') +
    '-' +
    h.node
  )
}

export function decodeHlc(s: string): Hlc {
  const first = s.indexOf('-')
  const second = s.indexOf('-', first + 1)
  if (first !== WALL_DIGITS || second !== WALL_DIGITS + 1 + COUNTER_HEX) {
    throw new Error(`Invalid HLC: ${s}`)
  }
  return {
    wall: parseInt(s.slice(0, first), 10),
    counter: parseInt(s.slice(first + 1, second), 16),
    node: s.slice(second + 1),
  }
}

export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export class HlcClock {
  private last: Hlc

  constructor(
    public readonly node: string,
    private readonly wallNow: () => number = () => Date.now(),
    initial?: string
  ) {
    this.last = initial ? decodeHlc(initial) : { wall: 0, counter: 0, node }
  }

  /** Current state without advancing. */
  peek(): string {
    return encodeHlc(this.last)
  }

  /** Generate a new local timestamp strictly greater than any seen so far. */
  now(): string {
    const wall = this.wallNow()
    if (wall > this.last.wall) {
      this.last = { wall, counter: 0, node: this.node }
    } else {
      if (this.last.counter >= MAX_COUNTER) {
        this.last = { wall: this.last.wall + 1, counter: 0, node: this.node }
      } else {
        this.last = { wall: this.last.wall, counter: this.last.counter + 1, node: this.node }
      }
    }
    return encodeHlc(this.last)
  }

  /**
   * Observe a remote timestamp so subsequent local timestamps sort after it.
   * Returns a fresh local timestamp.
   */
  receive(remote: string): string {
    const r = decodeHlc(remote)
    const wall = this.wallNow()
    if (r.wall > wall + MAX_DRIFT_MS) {
      throw new Error(`Remote HLC too far in the future (${r.wall - wall} ms)`)
    }
    const maxWall = Math.max(wall, this.last.wall, r.wall)
    let counter: number
    if (maxWall === this.last.wall && maxWall === r.wall) {
      counter = Math.max(this.last.counter, r.counter) + 1
    } else if (maxWall === this.last.wall) {
      counter = this.last.counter + 1
    } else if (maxWall === r.wall) {
      counter = r.counter + 1
    } else {
      counter = 0
    }
    this.last = { wall: maxWall, counter, node: this.node }
    return encodeHlc(this.last)
  }

  /**
   * Stamp a change captured at `capturedWallMs` (from a SQLite trigger) with an HLC
   * that is still monotonic relative to everything this clock has issued.
   */
  stampCaptured(capturedWallMs: number): string {
    const wall = Math.max(capturedWallMs, this.last.wall)
    if (wall > this.last.wall) {
      this.last = { wall, counter: 0, node: this.node }
    } else {
      this.last = { wall: this.last.wall, counter: this.last.counter + 1, node: this.node }
    }
    return encodeHlc(this.last)
  }
}
