// src/spaces/copilot/agent/RapportMission.tsx
// Rapport final (ou partiel) d'une mission : synthèse, classement, tableau
// comparatif des terrains, fiches, hypothèses du bilan, contacts, sources,
// limites — et exports PDF / Word / Excel / bilan Excel modifiable.
// Lit les rapports v2 ET v1 (rapport/rapportModele.ts) ; rien n'est recalculé
// ici, sauf la charge foncière au m² quand seul le total est connu (signalé).
import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import type { Mission } from './agent.types';
import { formatJetons } from './agentLogique';
import { useAgentUi } from './agentUi.store';
import {
  construireModeleRapport, DEFINITIONS_HYPOTHESES, fEur, fEurM2, fM2, fNb, formatHypothese, type TerrainModele,
} from './rapport/rapportModele';
import { LIBELLE_QUALITE_CONTACT, proprietaireTexte } from './rapport/rapportTexte';
import type { FormatExport } from './rapport/exporterRapport';

const EXPORTS: { format: FormatExport; label: string; titre: string }[] = [
  { format: 'pdf', label: 'PDF', titre: 'Télécharger le rapport en PDF' },
  { format: 'docx', label: 'Word', titre: 'Télécharger le rapport en Word (modifiable)' },
  { format: 'xlsx', label: 'Excel', titre: 'Télécharger le rapport et le bilan en Excel' },
];

export function RapportMission({ mission, partiel }: { mission: Mission; partiel: boolean }) {
  const modele = useMemo(() => construireModeleRapport(mission, mission.rapport_brut), [mission]);
  const [export_, setExport] = useState<FormatExport | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [toutLire, setToutLire] = useState(false);

  if (!modele) return null;
  const m = modele;
  const actions = mission.rapport?.actions_proposees ?? [];
  const memoire = mission.rapport?.memoire_ajoutee ?? 0;

  const exporter = async (format: FormatExport) => {
    if (export_) return;
    setExport(format); setErreur(null);
    try {
      const { exporterRapport } = await import('./rapport/exporterRapport');
      await exporterRapport(format, m);
    } catch {
      setErreur('Le fichier n’a pas pu être préparé. Réessayez dans un instant.');
    } finally { setExport(null); }
  };

  const synthese = toutLire ? m.synthese : m.synthese.slice(0, 2);

  return (
    <section className="mzag-carte mzag-rapport" aria-label="Rapport de la mission">
      <div className="mzag-item__haut">
        <span className="mzag-sur">{partiel ? 'Rapport partiel' : 'Rapport'} · {m.dateAffichee}</span>
      </div>
      <h3 className="mzag-titre" style={{ marginTop: 4 }}>{m.titre}</h3>

      <div className="mzag-actions mzag-rapport__exports" aria-busy={export_ !== null}>
        <span className="mzag-petit">Télécharger :</span>
        {EXPORTS.map((e) => (
          <button key={e.format} type="button" className="mzag-btn mzag-btn--petit" title={e.titre} disabled={export_ !== null} onClick={() => void exporter(e.format)}>
            <Download size={13} aria-hidden /> {export_ === e.format ? 'Préparation…' : e.label}
          </button>
        ))}
        <button type="button" className="mzag-btn mzag-btn--petit mzag-btn--plein" disabled={export_ !== null || m.terrains.length === 0}
          title="Classeur Excel avec formules : modifiez les hypothèses, tout se recalcule" onClick={() => void exporter('bilan')}>
          <FileSpreadsheet size={13} aria-hidden /> {export_ === 'bilan' ? 'Préparation…' : 'Bilan promoteur (Excel modifiable)'}
        </button>
      </div>
      {erreur && <p className="mzag-alerte" role="alert" style={{ margin: '8px 0 0' }}>{erreur}</p>}

      {synthese.length > 0 && (
        <>
          <h4>Synthèse</h4>
          {synthese.map((p, i) => <p key={i} className="mzag-rapport__para">{p}</p>)}
          {m.synthese.length > 2 && (
            <button type="button" className="mzag-btn mzag-btn--discret mzag-btn--petit" onClick={() => setToutLire((x) => !x)}>
              {toutLire ? 'Réduire' : 'Lire toute la synthèse'}
            </button>
          )}
        </>
      )}

      {m.terrains.length > 0 && (
        <>
          <h4>Comparatif des terrains</h4>
          <div className="mzag-tableau-wrap">
            <table className="mzag-tableau">
              <thead>
                <tr><th>Rang</th><th>Parcelle</th><th>Surface</th><th>Zonage</th><th>Propriétaire</th><th>Charge foncière</th><th>€/m² terrain</th><th>Verdict</th></tr>
              </thead>
              <tbody>
                {m.terrains.map((t) => (
                  <tr key={t.idu}>
                    <td>#{t.rang}</td>
                    <td><strong title={t.idu}>{t.idu.slice(-6)}</strong>{t.adresse && <div className="mzag-petit">{t.adresse}</div>}</td>
                    <td>{fM2(t.surface_m2)}</td>
                    <td title={t.zonageLibelle ?? undefined}>{t.zonageCode ?? '—'}</td>
                    <td>{proprietaireTexte(t)}</td>
                    <td>{fEur(t.charge_fonciere)}</td>
                    <td title={t.cfM2Calculee ? 'Charge foncière ÷ surface du terrain' : undefined}>{fEurM2(t.charge_fonciere_m2)}</td>
                    <td><span className={`mzag-verdict mzag-verdict--${t.ton}`}>{t.verdict ?? '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {m.noteBilanIdentique && <p className="mzag-info" style={{ margin: '10px 0 0' }}>{m.noteBilanIdentique}</p>}
        </>
      )}

      {m.classement.some((c) => c.justification && c.justification !== m.terrains.find((t) => t.idu === c.idu)?.verdict) && (
        <>
          <h4>Classement</h4>
          <ol className="mzag-puces">{m.classement.map((c) => <li key={c.idu}><strong>{c.idu.slice(-6)}</strong> — {c.justification}</li>)}</ol>
        </>
      )}

      {m.terrains.length > 0 && (
        <>
          <h4>Fiches des terrains</h4>
          <div className="mzag-pile">{m.terrains.map((t) => <FicheTerrain key={t.idu} t={t} />)}</div>
        </>
      )}

      <details className="mzag-rapport__bloc">
        <summary>Hypothèses du bilan</summary>
        {m.hypothesesDepuisTexte && <p className="mzag-petit">Certaines valeurs viennent du texte du rapport : à vérifier.</p>}
        <div className="mzag-tableau-wrap" style={{ marginTop: 8 }}>
          <table className="mzag-tableau">
            <thead><tr><th>Hypothèse</th><th>Valeur</th><th>Source</th></tr></thead>
            <tbody>
              {DEFINITIONS_HYPOTHESES.map((d) => {
                const v = m.hypotheses[d.cle];
                return (
                  <tr key={d.cle}>
                    <td>{d.libelle}</td>
                    <td className={v.valeur == null ? 'mzag-a-renseigner' : undefined}>{formatHypothese(d, v.valeur)}</td>
                    <td className="mzag-petit">{v.source ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mzag-petit" style={{ marginBottom: 0 }}>Le « Bilan promoteur (Excel modifiable) » reprend ces valeurs avec de vraies formules.</p>
      </details>

      {m.contacts.length > 0 && (
        <details className="mzag-rapport__bloc">
          <summary>Contacts ({m.contacts.length})</summary>
          <ul className="mzag-puces">
            {m.contacts.map((c, i) => (
              <li key={i}>
                <strong>{c.nom}</strong> ({LIBELLE_QUALITE_CONTACT[c.qualite] ?? c.qualite})
                {[c.telephone, c.email, c.adresse].filter(Boolean).map((x) => ` · ${x}`).join('')}
                {c.source && <span className="mzag-petit"> — source : {c.source}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {m.sources.length > 0 && (
        <details className="mzag-rapport__bloc">
          <summary>Sources ({m.sources.length})</summary>
          <ul className="mzag-puces">{m.sources.map((s) => <li key={s}>{s}</li>)}</ul>
        </details>
      )}

      {m.limites.length > 0 && (
        <details className="mzag-rapport__bloc">
          <summary>Limites ({m.limites.length})</summary>
          <ul className="mzag-puces">{m.limites.map((l) => <li key={l}>{l}</li>)}</ul>
        </details>
      )}

      <p className="mzag-petit" style={{ marginTop: 12 }}>{m.avertissement}</p>

      <div className="mzag-actions" style={{ marginTop: 10 }}>
        {actions.length > 0 && (
          <button type="button" className="mzag-btn mzag-btn--petit" onClick={() => useAgentUi.getState().ouvrir('actions')}>
            {actions.length} courrier{actions.length > 1 ? 's' : ''} à relire
          </button>
        )}
        {memoire > 0 && (
          <button type="button" className="mzag-btn mzag-btn--petit mzag-btn--discret" onClick={() => useAgentUi.getState().ouvrir('memoire')}>
            {memoire} élément{memoire > 1 ? 's' : ''} mémorisé{memoire > 1 ? 's' : ''}
          </button>
        )}
        {m.jetons != null && <span className="mzag-petit">Coût réel : {formatJetons(m.jetons)}</span>}
      </div>
    </section>
  );
}

function FicheTerrain({ t }: { t: TerrainModele }) {
  return (
    <details className="mzag-fiche">
      <summary>
        <span className={`mzag-verdict mzag-verdict--${t.ton}`}>{t.verdict ?? '—'}</span>
        <strong>#{t.rang} · {t.idu}</strong>
        {t.adresse && <span className="mzag-petit"> — {t.adresse}</span>}
      </summary>
      <dl className="mzag-fiche__infos">
        {t.score != null && <><dt>Score</dt><dd>{fNb(t.score)}</dd></>}
        <dt>Surface</dt><dd>{fM2(t.surface_m2)}</dd>
        <dt>Zonage</dt><dd>{[t.zonageCode, t.zonageLibelle].filter(Boolean).join(' — ') || '—'}</dd>
        <dt>Propriétaire</dt><dd>{proprietaireTexte(t)}{t.proprietaire?.deduit && <span className="mzag-petit"> (d’après le texte du rapport)</span>}</dd>
        <dt>Logements possibles</dt><dd>{fNb(t.potentiel_logements)}</dd>
        <dt>Charge foncière</dt><dd>{fEur(t.charge_fonciere)} · {fEurM2(t.charge_fonciere_m2)} de terrain</dd>
        {t.bilan && <><dt>Bilan</dt><dd>{t.bilan.statut === 'complet' ? 'Complet' : 'Partiel'}{t.bilan.ca_ht != null ? ` · CA ${fEur(t.bilan.ca_ht)}` : ''}</dd></>}
        {t.bilan?.justification && <><dt>Hypothèses propres</dt><dd>{t.bilan.justification}</dd></>}
      </dl>
      {t.points_forts.length > 0 && <><div className="mzag-petit" style={{ marginTop: 6 }}>Points forts</div><ul className="mzag-puces">{t.points_forts.map((p) => <li key={p}>{p}</li>)}</ul></>}
      {t.points_bloquants.length > 0 && <><div className="mzag-petit" style={{ marginTop: 6 }}>Points bloquants</div><ul className="mzag-puces">{t.points_bloquants.map((p) => <li key={p}>{p}</li>)}</ul></>}
      {t.contraintes.length > 0 && <><div className="mzag-petit" style={{ marginTop: 6 }}>Contraintes</div><ul className="mzag-puces">{t.contraintes.map((c, i) => <li key={i}><strong>{c.type}</strong> : {c.libelle}{c.source ? <span className="mzag-petit"> ({c.source})</span> : null}</li>)}</ul></>}
      {t.bilan && t.bilan.manques.length > 0 && <><div className="mzag-petit" style={{ marginTop: 6 }}>À renseigner pour le bilan</div><ul className="mzag-puces">{t.bilan.manques.map((x) => <li key={x}>{x}</li>)}</ul></>}
      {t.sources.length > 0 && <p className="mzag-petit" style={{ marginBottom: 0 }}>Sources : {t.sources.join(' · ')}</p>}
    </details>
  );
}
