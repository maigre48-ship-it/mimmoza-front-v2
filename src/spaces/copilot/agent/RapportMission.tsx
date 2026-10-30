// src/spaces/copilot/agent/RapportMission.tsx
// Rapport final (ou partiel) d'une mission : synthèse, tableau des terrains,
// verdicts, sources et limites. Aucun chiffre n'est recalculé ici.
import type { RapportMission as Rapport } from './agent.types';
import { formatJetons, tonVerdict } from './agentLogique';
import { useAgentUi } from './agentUi.store';

const m2 = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n).toLocaleString('fr-FR')} m²`);
const eur = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n).toLocaleString('fr-FR')} €`);

export function RapportMission({ rapport, partiel }: { rapport: Rapport; partiel: boolean }) {
  return (
    <section className="mzag-carte mzag-rapport" aria-label="Rapport de la mission">
      <span className="mzag-sur">{partiel ? 'Rapport partiel' : 'Rapport'}</span>
      <h3 className="mzag-titre" style={{ marginTop: 4 }}>{rapport.titre}</h3>
      {rapport.synthese && <p style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{rapport.synthese}</p>}

      {rapport.terrains.length > 0 && (
        <>
          <h4>Terrains étudiés ({rapport.terrains.length})</h4>
          <div className="mzag-tableau-wrap">
            <table className="mzag-tableau">
              <thead>
                <tr>
                  <th>Parcelle</th><th>Surface</th><th>Zonage</th><th>Verdict</th>
                  <th>Logements possibles</th><th>Charge foncière admissible</th>
                </tr>
              </thead>
              <tbody>
                {rapport.terrains.map((t, i) => (
                  <tr key={`${t.idu}-${i}`}>
                    <td>
                      <strong>{t.idu}</strong>
                      {(t.commune || t.adresse) && <div className="mzag-petit">{[t.adresse, t.commune].filter(Boolean).join(', ')}</div>}
                    </td>
                    <td>{m2(t.surface_m2)}</td>
                    <td>{t.zonage ?? 'Inconnu'}</td>
                    <td className={`mzag-verdict mzag-verdict--${tonVerdict(t.verdict)}`}>{t.verdict ?? '—'}</td>
                    <td>{t.potentiel_logements == null ? '—' : Math.round(t.potentiel_logements)}</td>
                    <td>{eur(t.charge_fonciere_admissible)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rapport.terrains.some((t) => t.points_forts.length || t.points_bloquants.length || t.sources.length) && (
            <div className="mzag-pile" style={{ marginTop: 12 }}>
              {rapport.terrains.map((t, i) => (t.points_forts.length || t.points_bloquants.length || t.sources.length) ? (
                <details key={`d-${t.idu}-${i}`}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Détail — {t.idu}</summary>
                  {t.points_forts.length > 0 && <><div className="mzag-petit" style={{ marginTop: 6 }}>Points forts</div><ul className="mzag-puces">{t.points_forts.map((p) => <li key={p}>{p}</li>)}</ul></>}
                  {t.points_bloquants.length > 0 && <><div className="mzag-petit" style={{ marginTop: 6 }}>Points bloquants</div><ul className="mzag-puces">{t.points_bloquants.map((p) => <li key={p}>{p}</li>)}</ul></>}
                  {t.sources.length > 0 && <div className="mzag-petit" style={{ marginTop: 6 }}>Sources : {t.sources.join(' · ')}</div>}
                </details>
              ) : null)}
            </div>
          )}
        </>
      )}

      {rapport.limites.length > 0 && (
        <>
          <h4>Limites</h4>
          <ul className="mzag-puces">{rapport.limites.map((l) => <li key={l}>{l}</li>)}</ul>
        </>
      )}

      <div className="mzag-actions" style={{ marginTop: 14 }}>
        {rapport.actions_proposees.length > 0 && (
          <button type="button" className="mzag-btn mzag-btn--petit" onClick={() => useAgentUi.getState().ouvrir('actions')}>
            {rapport.actions_proposees.length} courrier{rapport.actions_proposees.length > 1 ? 's' : ''} à relire
          </button>
        )}
        {rapport.memoire_ajoutee > 0 && (
          <button type="button" className="mzag-btn mzag-btn--petit mzag-btn--discret" onClick={() => useAgentUi.getState().ouvrir('memoire')}>
            {rapport.memoire_ajoutee} élément{rapport.memoire_ajoutee > 1 ? 's' : ''} mémorisé{rapport.memoire_ajoutee > 1 ? 's' : ''}
          </button>
        )}
        {rapport.jetons_consommes != null && <span className="mzag-petit">Coût réel : {formatJetons(rapport.jetons_consommes)}</span>}
      </div>
    </section>
  );
}
