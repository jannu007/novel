/**
 * 端末で使える声を調べて覚えておくための小さな仕掛け。
 *
 * 「使える声」＝端末の中だけで音を作る声。判定は `speech.ts` が行い、
 * ここはその結果を画面に届け、まだ選ばれていなければ既定を1つ決めるだけ。
 */

import { useEffect, useMemo, useState } from 'react';
import { surveyVoices, type VoiceSurvey } from './speech';

const EMPTY: VoiceSurvey = { usable: [], refused: 0, unsupported: false };

export function useVoices(current: string, onPick: (name: string) => void) {
  const [survey, setSurvey] = useState<VoiceSurvey>(EMPTY);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    surveyVoices().then((result) => {
      if (!alive) return;
      setSurvey(result);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  /*
   * まだ声が選ばれていない、または選んであった声が端末から消えたときは、
   * 使える声の先頭（日本語が先に並ぶ）を選び直す。
   */
  useEffect(() => {
    if (!ready || survey.usable.length === 0) return;
    if (survey.usable.some((v) => v.name === current)) return;
    onPick(survey.usable[0].name);
  }, [ready, survey, current, onPick]);

  /** 読み上げられる状態か。声が1つも無ければ読み上げない。 */
  const canSpeak = useMemo(
    () => ready && !survey.unsupported && survey.usable.length > 0,
    [ready, survey]
  );

  return { survey, ready, canSpeak };
}
