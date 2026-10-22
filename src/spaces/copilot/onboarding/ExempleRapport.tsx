// src/spaces/copilot/onboarding/ExempleRapport.tsx
// =============================================================================
// Extrait STATIQUE d'un rapport d'analyse, sur une PARCELLE FICTIVE.
// Clairement libellé « Exemple » : aucune valeur ne correspond à un terrain réel,
// aucun prix (pas de DVF sur cet extrait).
// =============================================================================

const LIGNES: readonly [string, string][] = [
  ['Zone du PLU', 'UB — habitat collectif'],
  ['Surface du terrain', '820 m²'],
  ['Emprise au sol maximale', '60 %'],
  ['Hauteur maximale', '15 m (R+4)'],
  ['Risque principal', 'Retrait-gonflement des argiles, aléa moyen'],
  ['Potentiel indicatif', '≈ 1 600 m² de surface de plancher'],
];

export function ExempleRapport() {
  return (
    <figure className="mzia-onb-ex" aria-label="Exemple de résultat, sur une parcelle fictive">
      <div className="mzia-onb-ex__badge">Exemple</div>
      <p className="mzia-onb-ex__kicker">Analyse de parcelle</p>
      <p className="mzia-onb-ex__title">Parcelle fictive AB 123 · Commune d’exemple</p>
      <dl className="mzia-onb-ex__rows">
        {LIGNES.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mzia-onb-ex__verdict">À approfondir : règles de stationnement à vérifier</p>
      <figcaption>
        Exemple illustratif sur une parcelle fictive. Vos analyses citent leurs sources
        (cadastre, PLU, Géorisques) et leurs hypothèses.
      </figcaption>
    </figure>
  );
}
