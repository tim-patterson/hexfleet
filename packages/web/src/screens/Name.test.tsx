import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PALETTE } from '@hexfleet/shared'
import { Name } from './Name.js'

// jsdom normalises inline hex colours to rgb() when it reflects them back
// through element.style, so compare against that normalised form.
function toRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

describe('Name', () => {
  it('does not render a filled palette hue before a seat is assigned', () => {
    // The Name screen renders before the WebSocket opens, so no seat has
    // been assigned yet. Even when handed one of the six real captain
    // colours (as a caller might, by accident), it must not paint that
    // colour as a solid fill -- only as a border, so nothing on screen
    // asserts "this is your colour" ahead of the server's say-so.
    render(
      <Name
        code="REEF-42"
        color={PALETTE[0]}
        seatLabel="Your colour is handed out with your seat"
        onSubmit={() => {}}
        error={null}
      />,
    )
    const swatch = screen.getByTestId('seat-swatch') as HTMLElement
    for (const hue of PALETTE) {
      expect(swatch.style.backgroundColor).not.toBe(toRgb(hue))
    }
    expect(swatch.style.borderColor).toBe(toRgb(PALETTE[0]))
  })
})
