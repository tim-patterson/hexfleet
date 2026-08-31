export type SfxKind = 'splash' | 'boom' | 'sunk' | 'place' | 'win'

export class Sfx {
  private muted = false
  private ac: AudioContext | null = null
  private noise: AudioBuffer | null = null

  setMuted(muted: boolean): void {
    this.muted = muted
  }

  private ctx(): AudioContext | null {
    if (this.muted) return null
    const AC = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    if (!this.ac) this.ac = new AC()
    if (this.ac.state === 'suspended') void this.ac.resume()
    if (!this.noise) {
      const len = this.ac.sampleRate * 1.2
      this.noise = this.ac.createBuffer(1, len, this.ac.sampleRate)
      const d = this.noise.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    }
    return this.ac
  }

  play(kind: SfxKind): void {
    const ac = this.ctx()
    if (!ac || !this.noise) return
    const t = ac.currentTime

    const noise = (dur: number, type: BiquadFilterType, f0: number, f1: number, vol: number) => {
      const src = ac.createBufferSource()
      src.buffer = this.noise
      const flt = ac.createBiquadFilter()
      flt.type = type
      flt.frequency.setValueAtTime(f0, t)
      flt.frequency.exponentialRampToValueAtTime(f1, t + dur)
      const g = ac.createGain()
      g.gain.setValueAtTime(vol, t)
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur)
      src.connect(flt)
      flt.connect(g)
      g.connect(ac.destination)
      src.start(t)
      src.stop(t + dur)
    }

    const tone = (wave: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) => {
      const o = ac.createOscillator()
      o.type = wave
      const g = ac.createGain()
      const s = t + delay
      o.frequency.setValueAtTime(f0, s)
      o.frequency.exponentialRampToValueAtTime(f1, s + dur)
      g.gain.setValueAtTime(0.0001, s)
      g.gain.exponentialRampToValueAtTime(vol, s + 0.015)
      g.gain.exponentialRampToValueAtTime(0.0008, s + dur)
      o.connect(g)
      g.connect(ac.destination)
      o.start(s)
      o.stop(s + dur + 0.02)
    }

    if (kind === 'splash') {
      noise(0.38, 'bandpass', 1500, 420, 0.22)
      tone('sine', 320, 150, 0.16, 0.05)
    } else if (kind === 'boom') {
      tone('sine', 130, 38, 0.55, 0.5)
      noise(0.3, 'lowpass', 900, 200, 0.35)
    } else if (kind === 'sunk') {
      tone('triangle', 220, 55, 1.1, 0.4)
      noise(0.9, 'lowpass', 600, 120, 0.3)
    } else if (kind === 'place') {
      tone('sine', 260, 200, 0.09, 0.18)
      noise(0.08, 'bandpass', 900, 500, 0.08)
    } else if (kind === 'win') {
      ;[392, 523, 659].forEach((f, i) => tone('triangle', f, f, 0.5, 0.22, i * 0.13))
    }
  }
}

export const sfx = new Sfx()
