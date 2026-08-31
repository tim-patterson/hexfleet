import { describe, expect, it } from 'vitest'
import { PALETTE } from '@hexfleet/shared'
import { ACCENT, BG, FAINT, HEAD, MISS, SEA, seatColor } from './theme.js'

describe('theme', () => {
  it("uses the design system's ground and accent", () => {
    expect(BG).toBe('#f5ead8')
    expect(ACCENT).toBe('#c67139')
    expect(SEA).toBe('#f5ead8')
    expect(MISS).toBe('#c0b6a5')
    expect(FAINT).toBe('rgba(32,30,29,0.18)')
  })

  it('names Caprasimo as the heading face with a real fallback', () => {
    expect(HEAD).toContain('Caprasimo')
    expect(HEAD).toContain('sans-serif')
  })

  it('maps every seat to its palette colour', () => {
    PALETTE.forEach((c, i) => expect(seatColor(i)).toBe(c))
  })

  it('wraps around rather than returning undefined for an out-of-range seat', () => {
    expect(seatColor(6)).toBe(PALETTE[0])
  })
})
