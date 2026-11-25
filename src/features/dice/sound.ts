import type { DiceOutcome } from './diceOutcome.ts'

let context: AudioContext | undefined

/**
 * A short synthesized dice sound (no audio files): a rattle of clicks, then a
 * bright chime for a natural 20 or a low thud for a natural 1. Fails silently
 * where audio is unavailable.
 */
export function playDiceSound(outcome: DiceOutcome) {
  try {
    context ??= new AudioContext()
    const audio = context
    const now = audio.currentTime
    for (let index = 0; index < 5; index++) {
      const at = now + index * 0.07 + Math.random() * 0.03
      const length = 0.03
      const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * length), audio.sampleRate)
      const data = buffer.getChannelData(0)
      for (let sample = 0; sample < data.length; sample++) data[sample] = (Math.random() * 2 - 1) * (1 - sample / data.length)
      const source = audio.createBufferSource()
      const filter = audio.createBiquadFilter()
      const gain = audio.createGain()
      source.buffer = buffer
      filter.type = 'bandpass'
      filter.frequency.value = 1800 + Math.random() * 1600
      gain.gain.value = 0.18 * (1 - index / 6)
      source.connect(filter).connect(gain).connect(audio.destination)
      source.start(at)
    }
    if (outcome === 'normal') return
    const tone = audio.createOscillator()
    const gain = audio.createGain()
    const start = now + 0.42
    tone.type = outcome === 'critical' ? 'triangle' : 'sine'
    tone.frequency.setValueAtTime(outcome === 'critical' ? 660 : 140, start)
    tone.frequency.exponentialRampToValueAtTime(outcome === 'critical' ? 1320 : 70, start + 0.35)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5)
    tone.connect(gain).connect(audio.destination)
    tone.start(start)
    tone.stop(start + 0.55)
  } catch { /* audio unavailable */ }
}
