import type { DiceOutcome } from './diceOutcome.ts'

let context: AudioContext | undefined
const audio = () => (context ??= new AudioContext())

/** One woody knock: a short pitched thump with a little filtered noise on top. */
function knock(ctx: AudioContext, at: number, loudness: number, pitch: number) {
  const body = ctx.createOscillator()
  const bodyGain = ctx.createGain()
  body.type = 'sine'
  body.frequency.setValueAtTime(pitch, at)
  body.frequency.exponentialRampToValueAtTime(pitch * 0.6, at + 0.06)
  bodyGain.gain.setValueAtTime(0.0001, at)
  bodyGain.gain.exponentialRampToValueAtTime(loudness, at + 0.004)
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.08)
  body.connect(bodyGain).connect(ctx.destination)
  body.start(at)
  body.stop(at + 0.1)

  const length = 0.04
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * length), ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let sample = 0; sample < data.length; sample++) data[sample] = (Math.random() * 2 - 1) * (1 - sample / data.length) ** 2
  const noise = ctx.createBufferSource()
  const filter = ctx.createBiquadFilter()
  const noiseGain = ctx.createGain()
  noise.buffer = buffer
  filter.type = 'lowpass'
  filter.frequency.value = 1400 + Math.random() * 600
  noiseGain.gain.value = loudness * 0.6
  noise.connect(filter).connect(noiseGain).connect(ctx.destination)
  noise.start(at)
}

function tone(ctx: AudioContext, at: number, from: number, to: number, length: number, type: OscillatorType, loudness: number) {
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  oscillator.type = type
  oscillator.frequency.setValueAtTime(from, at)
  oscillator.frequency.exponentialRampToValueAtTime(to, at + length * 0.8)
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(loudness, at + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length)
  oscillator.connect(gain).connect(ctx.destination)
  oscillator.start(at)
  oscillator.stop(at + length + 0.05)
}

/**
 * Dice on a wooden table (synthesized, no files): a few knocks that bounce
 * closer together and fade, then a bright rising chime for a natural 20 or a
 * low falling note for a natural 1. Silent where audio is unavailable.
 */
export function playDiceSound(outcome: DiceOutcome) {
  try {
    const ctx = audio()
    const now = ctx.currentTime
    const bounces = [0, 0.12, 0.21, 0.28, 0.33, 0.365]
    bounces.forEach((offset, index) => knock(ctx, now + offset + Math.random() * 0.015, 0.32 * (1 - index / 7), 180 + Math.random() * 140))
    if (outcome === 'critical') tone(ctx, now + 0.45, 660, 1320, 0.5, 'triangle', 0.2)
    if (outcome === 'fumble') tone(ctx, now + 0.45, 160, 70, 0.55, 'sine', 0.24)
  } catch { /* audio unavailable */ }
}

/** "Your turn": two quick rising bell notes. */
export function playTurnSound() {
  try {
    const ctx = audio()
    const now = ctx.currentTime
    tone(ctx, now, 523, 530, 0.35, 'triangle', 0.18)
    tone(ctx, now + 0.16, 784, 790, 0.5, 'triangle', 0.2)
  } catch { /* audio unavailable */ }
}

/** End of an encounter: a soft major chord that swells and fades. */
export function playEncounterEndSound() {
  try {
    const ctx = audio()
    const now = ctx.currentTime
    for (const [index, note] of [392, 494, 587, 784].entries()) tone(ctx, now + index * 0.07, note, note, 1.4, 'sine', 0.09)
  } catch { /* audio unavailable */ }
}
