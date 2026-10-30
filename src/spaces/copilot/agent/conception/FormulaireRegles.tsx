// src/spaces/copilot/agent/conception/FormulaireRegles.tsx
// Réponse à la question STRUCTURÉE de la mission de conception : les règles
// clés du PLU, pré-remplies (valeur, unité, source, article), modifiables,
// avec « inconnu » possible ; dépôt du règlement PDF et « Faire lire le
// règlement par l'agent ». La réponse part en JSON par agent_mission_repondre.
import { useMemo, useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { construireReponseRegles, type QuestionReglesConception } from '@/spaces/promoteur/shared/echangeStudio/conception';
import { repondreMission } from '../agentApi';
import { useAgentUi } from '../agentUi.store';
import { deposerFichier, utilisateurId } from './conceptionApi';
import { avertissementSaisie, cheminReglement, dossierReglement, lignesFormulaire, lireSaisie, type LigneFormulaire } from './conceptionLogique';
import './conception.css';

export function FormulaireRegles({ missionId, question, onRepondu }: { missionId: string; question: QuestionReglesConception; onRepondu: () => void }) {
  const [lignes, setLignes] = useState<LigneFormulaire[]>(() => lignesFormulaire(question));
  const [reglement, setReglement] = useState<string | null>(null);
  const [nomReglement, setNomReglement] = useState<string | null>(null);
  const [lire, setLire] = useState(true);
  const [commentaire, setCommentaire] = useState('');
  const [occupe, setOccupe] = useState<'depot' | 'envoi' | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const fichier = useRef<HTMLInputElement | null>(null);

  const saisies = useMemo(() => lignes.map((l) => ({ l, s: lireSaisie(l, l.saisie, l.inconnu) })), [lignes]);
  const invalide = saisies.some((x) => !x.s.ok);
  const maj = (cle: LigneFormulaire['cle'], champs: Partial<LigneFormulaire>) => setLignes((ls) => ls.map((l) => (l.cle === cle ? { ...l, ...champs } : l)));

  const deposer = async (f: File) => {
    setErreur(null);
    try {
      const uid = await utilisateurId();
      const dossier = dossierReglement(question, uid);
      if (!dossier) { setErreur('Le dossier de conception n’existe pas encore : décrivez les règles ci-dessous, ou réessayez après la prochaine étape de la mission.'); return; }
      const ch = cheminReglement(uid, dossier, f);
      if (!ch.ok) { setErreur(ch.erreur); return; }
      setOccupe('depot');
      await deposerFichier(ch.chemin, f, ch.type);
      setReglement(ch.chemin); setNomReglement(f.name); setLire(true);
    } catch (e) { setErreur(e instanceof Error ? e.message : 'Dépôt impossible.'); }
    finally { setOccupe(null); }
  };

  const envoyer = async () => {
    if (invalide) return;
    setOccupe('envoi'); setErreur(null);
    try {
      const json = construireReponseRegles(
        saisies.map(({ l, s }) => ({ cle: l.cle, valeur: s.ok ? s.valeur : null, unite: l.unite, article: l.article })),
        { reglement, lire_reglement: lire, commentaire },
      );
      await repondreMission(missionId, json);
      useAgentUi.getState().signalerChangement();
      onRepondu();
    } catch (e) { setErreur(e instanceof Error ? e.message : 'Envoi impossible.'); }
    finally { setOccupe(null); }
  };

  return (
    <section className="mzag-question mzcp-form" aria-label="Règles du PLU à confirmer">
      <p>{question.message}</p>
      <p className="mzag-petit" style={{ margin: '0 0 8px', fontWeight: 400 }}>
        Parcelle {question.idu}. Corrigez ou confirmez chaque règle ; cochez « inconnu » plutôt que de deviner. Aucune règle n’est inventée.
      </p>
      <div className="mzag-tableau-wrap">
        <table className="mzag-tableau mzcp-form__table">
          <thead><tr><th>Règle</th><th>Valeur</th><th>Inconnu</th><th>Article</th><th>Source actuelle</th></tr></thead>
          <tbody>
            {saisies.map(({ l, s }) => (
              <tr key={l.cle}>
                <td><strong>{l.libelle}</strong>{l.texte && <details><summary className="mzag-petit">Extrait</summary><span className="mzag-petit">{l.texte}</span></details>}</td>
                <td>
                  <span className="mzcp-form__valeur">
                    <input className="mzag-input" value={l.saisie} disabled={l.inconnu} inputMode={l.formule ? 'text' : 'decimal'}
                      aria-label={`${l.libelle} (${l.unite})`} onChange={(e) => maj(l.cle, { saisie: e.target.value })} />
                    <span className="mzag-petit">{l.unite}</span>
                  </span>
                  {!s.ok && <div className="mzag-petit" style={{ color: '#b91c1c' }}>{s.erreur}</div>}
                  {s.ok && avertissementSaisie(l, s.valeur) && <div className="mzag-petit" style={{ color: '#b45309' }}>{avertissementSaisie(l, s.valeur)}</div>}
                </td>
                <td><input type="checkbox" checked={l.inconnu} onChange={(e) => maj(l.cle, { inconnu: e.target.checked })} aria-label={`${l.libelle} inconnue`} /></td>
                <td><input className="mzag-input" value={l.article} maxLength={60} placeholder="ex. UC 10" onChange={(e) => maj(l.cle, { article: e.target.value })} aria-label={`Article pour ${l.libelle}`} /></td>
                <td className="mzag-petit">{l.statut === 'manquant' ? 'non trouvée' : `${l.source}${l.statut === 'estime' ? ' (estimée)' : ''}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mzcp-form__reglement">
        <input ref={fichier} type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void deposer(f); }} />
        <button type="button" className="mzag-btn mzag-btn--petit" disabled={occupe !== null} onClick={() => fichier.current?.click()}>
          <FileUp size={13} aria-hidden /> {occupe === 'depot' ? 'Envoi…' : reglement ? 'Remplacer le règlement' : 'Déposer le règlement (PDF)'}
        </button>
        {nomReglement ? <span className="mzag-petit">{nomReglement}</span>
          : <span className="mzag-petit">PDF de 3 Mo au plus : si le règlement est gros, gardez seulement les dispositions générales et le chapitre de votre zone.</span>}
        {reglement && (
          <label className="mzag-petit" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={lire} onChange={(e) => setLire(e.target.checked)} />
            Faire lire le règlement par l’agent (lecture comptée en jetons, dans la réserve de la mission)
          </label>
        )}
      </div>
      <textarea className="mzag-textarea" rows={2} maxLength={500} placeholder="Une précision pour l’agent (facultatif)" value={commentaire} onChange={(e) => setCommentaire(e.target.value)} />
      {erreur && <p className="mzag-alerte" role="alert" style={{ margin: '8px 0 0' }}>{erreur}</p>}
      <div className="mzag-actions" style={{ marginTop: 8 }}>
        <button type="button" className="mzag-btn mzag-btn--plein mzag-btn--petit" disabled={invalide || occupe !== null} onClick={() => void envoyer()}>
          {occupe === 'envoi' ? 'Envoi…' : 'Valider ces règles et reprendre'}
        </button>
      </div>
    </section>
  );
}
