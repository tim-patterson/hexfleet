/** Four-letter nautical words, so a code reads as WORD-NN like the design's REEF-42. */
export const WORDS = [
  'REEF', 'TIDE', 'KELP', 'DUNE', 'GULL', 'SALT', 'FOAM', 'HULL',
  'MAST', 'SPAR', 'KEEL', 'PIER', 'COVE', 'BUOY', 'CHOP', 'SWEL',
  'GALE', 'HAZE', 'MIST', 'DAWN', 'DUSK', 'CALM', 'WAKE', 'DRIF',
  'SHOL', 'BANK', 'BERG', 'FLOE', 'CRAB', 'ORCA', 'SEAL', 'TERN',
  'PIKE', 'BASS', 'CARP', 'SOLE', 'HAKE', 'LING', 'CLAM', 'SPIT',
  'HEAD', 'NESS', 'FIRT', 'LOCH', 'SUND', 'BAYS', 'PORT', 'DOCK',
  'ROPE', 'KNOT', 'LINE', 'NETS', 'OARS', 'HELM', 'BOWS', 'STER',
  'DECK', 'HOLD', 'BILG', 'RUDD', 'ANCH', 'CHAI', 'LAMP', 'HORN',
] as const

export function randomCode(rng: () => number = Math.random): string {
  const word = WORDS[Math.floor(rng() * WORDS.length)]!
  const n = String(Math.floor(rng() * 100)).padStart(2, '0')
  return `${word}-${n}`
}
