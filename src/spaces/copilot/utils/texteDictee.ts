/** Structure minimale compatible avec SpeechRecognitionResultList. */
type ResultatsDictee = ArrayLike<{
  readonly isFinal: boolean;
  readonly [index: number]: { readonly transcript: string };
}>;

/** Chaque événement remplace les provisoires précédents et conserve les segments finaux. */
export function texteDictee(base: string, results: ResultatsDictee): string {
  const finals: string[] = [];
  const interim: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    (result.isFinal ? finals : interim).push(result[0].transcript.trim());
  }
  const transcription = [...finals, ...interim].filter(Boolean).join(' ');
  return transcription ? base + (base ? ' ' : '') + transcription : base;
}
