import { PALETTE } from '@hexfleet/shared'

export const BG = '#f5ead8'
export const SURFACE = '#ebddc5'
export const INK = '#201e1d'
export const ACCENT = '#c67139'
export const ACCENT_DEEP = '#8c491a'
export const ACCENT_PALE = '#ffe1d0'
export const ACCENT_WARN = '#ffc6a5'
export const GREEN = '#e1eecc'
export const GREEN_DEEP = '#7a8a5e'
export const GREEN_TEXT = '#56633f'
export const GREEN_DARK = '#3d472b'
export const PAPER = '#f9f4ed'

export const SEA = BG
export const SEA_HI = '#ccdbb2'
export const MISS = '#c0b6a5'
export const SUNK = '#a19786'
export const MUTED = 'rgba(32,30,29,0.55)'
export const FAINT = 'rgba(32,30,29,0.18)'

export const SHADOW_SM = '0 1px 2px rgba(46,43,37,0.14)'
export const SHADOW_MD = '0 3px 10px rgba(46,43,37,0.16)'
export const SHADOW_LG = '0 12px 32px rgba(46,43,37,0.22)'

export const HEAD = 'Caprasimo, system-ui, sans-serif'
export const BODY = 'Figtree, system-ui, sans-serif'

export function seatColor(seat: number): string {
  return PALETTE[((seat % PALETTE.length) + PALETTE.length) % PALETTE.length]!
}
