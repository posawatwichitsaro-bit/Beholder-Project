import { useEffect, useRef, useState } from 'react'
import type { Scene } from '../../../shared/model.ts'
import { usePrefs } from '../../state/prefs.ts'
import { playEncounterEndSound } from '../dice/sound.ts'
import { CrossedSwordsIcon } from '../../ui/index.ts'

/**
 * When the fight in the scene on screen ends, a banner rises — "การต่อสู้จบลง"
 * with how many rounds it took — embers drift up, and a soft chord plays.
 * Switching scenes never triggers it; only a fight ending where you are.
 */
export function EncounterEnd({ scene }: { scene?: Scene }) {
  const last = useRef<{ sceneId?: string; round?: number }>({})
  const [shown, setShown] = useState<{ rounds: number; key: number }>()
  useEffect(() => {
    const before = last.current
    const round = scene?.combat?.round
    if (scene && before.sceneId === scene.id && before.round !== undefined && round === undefined) {
      setShown({ rounds: before.round, key: Date.now() })
      if (usePrefs.getState().sound) playEncounterEndSound()
    }
    last.current = { sceneId: scene?.id, round }
  }, [scene?.id, scene?.combat?.round, scene?.combat === undefined])
  useEffect(() => {
    if (!shown) return
    const timer = setTimeout(() => setShown(undefined), 3600)
    return () => clearTimeout(timer)
  }, [shown])
  if (!shown) return null
  return <div key={shown.key} className="encounter-end" role="status" aria-live="polite">
    <div className="encounter-end-embers" aria-hidden="true">{Array.from({ length: 14 }, (_, index) =>
      <span key={index} style={{ left: (index * 7 + 4) % 100 + '%', animationDelay: (index % 5) * 0.18 + 's' }} />)}</div>
    <div className="encounter-end-card">
      <CrossedSwordsIcon size={34} />
      <b>การต่อสู้จบลง</b>
      <small>{shown.rounds} รอบ · เก็บดาบได้</small>
    </div>
  </div>
}
