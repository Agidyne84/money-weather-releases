import { describe, it, expect } from 'vitest'
import { HlcClock, encodeHlc, decodeHlc, compareHlc, MAX_DRIFT_MS } from '../../../shared/sync/hlc'

function fakeClock(start: number) {
  let t = start
  return {
    now: () => t,
    set: (v: number) => {
      t = v
    },
    advance: (ms: number) => {
      t += ms
    },
  }
}

describe('HLC encoding', () => {
  it('round-trips', () => {
    const s = encodeHlc({ wall: 1_700_000_000_000, counter: 42, node: 'dev-A' })
    expect(decodeHlc(s)).toEqual({ wall: 1_700_000_000_000, counter: 42, node: 'dev-A' })
  })

  it('string order equals causal order', () => {
    const a = encodeHlc({ wall: 1000, counter: 5, node: 'z' })
    const b = encodeHlc({ wall: 1000, counter: 6, node: 'a' })
    const c = encodeHlc({ wall: 1001, counter: 0, node: 'a' })
    expect(compareHlc(a, b)).toBeLessThan(0)
    expect(compareHlc(b, c)).toBeLessThan(0)
    expect([c, a, b].sort(compareHlc)).toEqual([a, b, c])
  })

  it('rejects malformed input', () => {
    expect(() => decodeHlc('nope')).toThrow()
  })
})

describe('HlcClock', () => {
  it('produces strictly increasing timestamps even when wall clock is frozen', () => {
    const wall = fakeClock(1_000_000)
    const clk = new HlcClock('A', wall.now)
    const t1 = clk.now()
    const t2 = clk.now()
    const t3 = clk.now()
    expect(compareHlc(t1, t2)).toBeLessThan(0)
    expect(compareHlc(t2, t3)).toBeLessThan(0)
    expect(decodeHlc(t3).counter).toBe(2)
  })

  it('resets counter when wall clock advances', () => {
    const wall = fakeClock(1_000_000)
    const clk = new HlcClock('A', wall.now)
    clk.now()
    clk.now()
    wall.advance(1)
    expect(decodeHlc(clk.now()).counter).toBe(0)
  })

  it('does not go backwards when wall clock goes backwards', () => {
    const wall = fakeClock(1_000_000)
    const clk = new HlcClock('A', wall.now)
    const t1 = clk.now()
    wall.set(900_000)
    const t2 = clk.now()
    expect(compareHlc(t1, t2)).toBeLessThan(0)
    expect(decodeHlc(t2).wall).toBe(1_000_000)
  })

  it('receive() moves past a remote timestamp from a device with a fast clock', () => {
    const wall = fakeClock(1_000_000)
    const local = new HlcClock('A', wall.now)
    const remote = encodeHlc({ wall: 1_005_000, counter: 3, node: 'B' })
    const t = local.receive(remote)
    expect(compareHlc(remote, t)).toBeLessThan(0)
    expect(decodeHlc(t).wall).toBe(1_005_000)
    expect(decodeHlc(t).counter).toBe(4)
    // Subsequent local stamps stay ahead of the remote one.
    expect(compareHlc(remote, local.now())).toBeLessThan(0)
  })

  it('receive() rejects absurdly future remote timestamps', () => {
    const wall = fakeClock(1_000_000)
    const local = new HlcClock('A', wall.now)
    const remote = encodeHlc({ wall: 1_000_000 + MAX_DRIFT_MS + 1, counter: 0, node: 'B' })
    expect(() => local.receive(remote)).toThrow()
  })

  it('stampCaptured preserves trigger capture time when it is newer than last', () => {
    const wall = fakeClock(1_000_000)
    const clk = new HlcClock('A', wall.now)
    const t = clk.stampCaptured(1_000_500)
    expect(decodeHlc(t)).toEqual({ wall: 1_000_500, counter: 0, node: 'A' })
  })

  it('stampCaptured never goes backwards relative to issued stamps', () => {
    const wall = fakeClock(2_000_000)
    const clk = new HlcClock('A', wall.now)
    const issued = clk.now()
    const t = clk.stampCaptured(1_000_000)
    expect(compareHlc(issued, t)).toBeLessThan(0)
  })

  it('restores from a persisted state', () => {
    const wall = fakeClock(1_000_000)
    const persisted = encodeHlc({ wall: 5_000_000, counter: 7, node: 'A' })
    const clk = new HlcClock('A', wall.now, persisted)
    expect(clk.peek()).toBe(persisted)
    expect(compareHlc(persisted, clk.now())).toBeLessThan(0)
  })
})
