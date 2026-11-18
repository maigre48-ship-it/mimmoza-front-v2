// src/spaces/copilot/studio3d/CartePlanLu.tsx
// =============================================================================
// LOT G6 (18/11/2026) — Carte « Plan lu » du chat MimmozIA.
//   · en attente : le plan joint est lu dans le Studio (sans jeton) ; si la lecture n'aboutit pas, deux replis :
//     relever la maison sur la photo, ou saisir 2 ou 3 cotes ;
//   · plan lu : échelle, dimensions hors tout, emprise lue et écart avec la base de l'IGN, côtés, pièces, points
//     douteux ; 1 à 3 valeurs clés à confirmer (ou corriger) quand c'est nécessaire, puis « Utiliser ce plan ».
// Aucune valeur n'est calculée ici : tout vient de la lecture du Studio ou de la saisie (logique : planLuChat.ts).
// =============================================================================
import { useState } from 'react';
import { FileText } from 'lucide-react';
import {
  confirmerValeur, fr, LIBELLE_STATUT_PLAN, lignesPlanLu, lireSaisie, planLuDepuisSaisie, planPretPourLeParcours, valeursCles,
  type CleConfirmation, type PlanLuSite,
} from './planLuChat';
import './CarteExtensionMaison.css';

export type EtatCartePlanLu =
  | { readonly mode: 'attente'; readonly nom: string }
  | { readonly mode: 'lu'; readonly plan: PlanLuSite }
  | { readonly mode: 'saisie' };

const bouton: React.CSSProperties = { border: '1px solid #c4b5fd', background: '#fff', color: '#4c1d95', borderRadius: 8, padding: '4px 10px', fontSize: 13, cursor: 'pointer' };
const principal: React.CSSProperties = { ...bouton, background: '#6d28d9', color: '#fff', borderColor: '#6d28d9' };

function Correction({ cle, onValider, onAnnuler }: { cle: CleConfirmation; onValider: (v: number[]) => void; onAnnuler: () => void }) {
  const [t, setT] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const aide = cle === 'dimensions' ? 'longueur × largeur des murs extérieurs, ex. « 12,10 × 8 »' : cle === 'niveaux' ? 'nombre de niveaux, ex. « 2 »' : 'surface en m², ex. « 128 »';
  return <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
    <input aria-label={aide} placeholder={aide} value={t} onChange={(e) => { setT(e.target.value); setErr(null); }} style={{ fontSize: 13, padding: '3px 6px', minWidth: 180 }} />
    <button type="button" style={bouton} onClick={() => { const v = lireSaisie(cle, t); if (v) onValider(v); else setErr('Valeur illisible.'); }}>Valider</button>
    <button type="button" style={bouton} onClick={onAnnuler}>Annuler</button>
    {err && <span role="alert" style={{ color: '#b91c1c', fontSize: 12 }}>{err}</span>}
  </span>;
}

function Saisie({ onValider, onAnnuler }: { onValider: (p: PlanLuSite) => void; onAnnuler: () => void }) {
  const [L, setL] = useState(''); const [l, setl] = useState(''); const [n, setN] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return <div className="mz-ext__bloc">
    <p>Donnez les dimensions <strong>hors tout des murs extérieurs</strong> de la maison (et, si vous le savez, le nombre de niveaux). Elles seront comparées à la base des bâtiments de l’IGN.</p>
    <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <label>Longueur (m) <input value={L} onChange={(e) => setL(e.target.value)} inputMode="decimal" style={{ width: 70 }} /></label>
      <label>Largeur (m) <input value={l} onChange={(e) => setl(e.target.value)} inputMode="decimal" style={{ width: 70 }} /></label>
      <label>Niveaux <input value={n} onChange={(e) => setN(e.target.value)} inputMode="numeric" style={{ width: 50 }} /></label>
    </p>
    <p style={{ display: 'flex', gap: 8 }}>
      <button type="button" style={principal} onClick={() => { const p = planLuDepuisSaisie({ longueur: L, largeur: l, niveaux: n }, Date.now()); if (p) onValider(p); else setErr('Cotes illisibles : longueur et largeur entre 1 et 300 m, niveaux entier.'); }}>Utiliser ces cotes</button>
      <button type="button" style={bouton} onClick={onAnnuler}>Annuler</button>
    </p>
    {err && <p role="alert" style={{ color: '#b91c1c' }}>{err}</p>}
  </div>;
}

export function CartePlanLu({ etat, onPlan, onValider, onSaisie, onRelevePhoto, onRelire, onFermer }: {
  etat: EtatCartePlanLu;
  /** Plan modifié (confirmation, correction) : mémorisé et donné au contexte de la page. */
  onPlan: (p: PlanLuSite) => void;
  /** « Utiliser ce plan » : envoie le message de validation à Mimmo (le plan part dans le contexte de la page). */
  onValider: (p: PlanLuSite) => void;
  onSaisie: () => void;
  onRelevePhoto: () => void;
  onRelire: () => void;
  onFermer: () => void;
}) {
  const [corrige, setCorrige] = useState<CleConfirmation | null>(null);
  const [detail, setDetail] = useState(false);
  const entete = <p style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
    <FileText size={16} aria-hidden /> <strong style={{ flex: 1 }}>Plan de votre maison</strong>
    <button type="button" aria-label="Fermer" style={{ ...bouton, padding: '0 8px' }} onClick={onFermer}>×</button>
  </p>;
  const cadre: React.CSSProperties = { position: 'fixed', right: 16, bottom: 96, zIndex: 890, width: 'min(460px, 94vw)', maxHeight: '70vh', overflow: 'auto', background: '#fff', border: '1px solid #c4b5fd', borderRadius: 12, padding: 12, fontSize: 13, lineHeight: 1.45, boxShadow: '0 10px 30px rgba(15,23,42,.18)', color: '#1e1b4b' };

  if (etat.mode === 'saisie') {
    return <section role="dialog" aria-label="Cotes de la maison" style={cadre}>{entete}<Saisie onValider={(p) => { onPlan(p); onValider(p); }} onAnnuler={onFermer} /></section>;
  }
  if (etat.mode === 'attente') {
    return <section role="status" aria-label="Lecture du plan" style={cadre}>{entete}
      <p>« {etat.nom} » est lu dans le Studio, sur votre ordinateur, sans jeton. Répondez à ses questions puis posez le relevé : le résultat s’affichera ici.</p>
      <p>Si la lecture n’aboutit pas (scan flou, plan sans cotes ni échelle) :</p>
      <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" style={bouton} onClick={onRelevePhoto}>Relever la maison sur la photo</button>
        <button type="button" style={bouton} onClick={onSaisie}>Saisir 2 ou 3 cotes</button>
        <button type="button" style={bouton} onClick={onRelire}>Rouvrir le plan dans le Studio</button>
      </p>
    </section>;
  }

  const p = etat.plan;
  const cles = valeursCles(p);
  const pret = planPretPourLeParcours(p);
  return <section role="dialog" aria-label="Plan lu" style={cadre}>{entete}
    {lignesPlanLu(p).map((l) => <p key={l} style={{ margin: '4px 0' }}>{l}</p>)}
    {p.emprise?.signale && <p role="alert" style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 8, padding: '6px 8px' }}>
      L’emprise lue s’écarte de plus de 10 % de celle de la base de l’IGN : vérifiez que c’est bien le plan de cette maison et que son échelle est juste. L’extension reste calculée sur le contour de l’IGN.
    </p>}
    <table className="mz-ext__table"><tbody>
      {cles.map((v) => <tr key={v.cle}>
        <th scope="row">{v.libelle}</th>
        <td>{v.valeur}{v.necessaire && v.raison ? <><br /><span style={{ color: '#92400e' }}>À confirmer : {v.raison}</span></> : null}</td>
        <td>
          <span className={`mz-ext__statut`} title={LIBELLE_STATUT_PLAN[v.statut]}>{LIBELLE_STATUT_PLAN[v.statut]}</span>
          {corrige === v.cle
            ? <><br /><Correction cle={v.cle} onValider={(x) => { setCorrige(null); onPlan(confirmerValeur(p, v.cle, x)); }} onAnnuler={() => setCorrige(null)} /></>
            : v.statut !== 'confirme' && <span style={{ display: 'inline-flex', gap: 4, marginLeft: 6 }}>
              <button type="button" style={bouton} onClick={() => onPlan(confirmerValeur(p, v.cle))}>C’est juste</button>
              <button type="button" style={bouton} onClick={() => setCorrige(v.cle)}>Corriger</button>
            </span>}
        </td>
      </tr>)}
    </tbody></table>
    {p.pointsDouteux.length > 0 && <div className="mz-ext__bloc"><p style={{ margin: '6px 0 2px' }}><strong>Points douteux</strong></p>
      <ul style={{ margin: 0, paddingLeft: 18 }}>{p.pointsDouteux.map((d) => <li key={d}>{d}</li>)}</ul></div>}
    <p style={{ margin: '6px 0' }}><button type="button" style={{ ...bouton, border: 'none', padding: 0, textDecoration: 'underline' }} onClick={() => setDetail((x) => !x)}>{detail ? 'Masquer le détail' : 'Voir les côtés et les pièces'}</button></p>
    {detail && <div className="mz-ext__bloc">
      {p.cotesExterieures.length > 0 && <><p style={{ margin: '4px 0' }}><strong>Façades</strong></p><ul style={{ margin: 0, paddingLeft: 18 }}>
        {p.cotesExterieures.map((c, i) => <li key={`${c.libelle}-${i}`}>{c.libelle} : {fr(c.longueurLueM)} m lus{c.ecartM !== null ? ` (IGN ${fr(c.longueurBdTopoM!)} m, écart ${c.ecartM > 0 ? '+' : ''}${fr(c.ecartM)} m)` : ''} — {LIBELLE_STATUT_PLAN[c.statut]}</li>)}
      </ul></>}
      {p.pieces.length > 0 && <><p style={{ margin: '4px 0' }}><strong>Pièces</strong></p><ul style={{ margin: 0, paddingLeft: 18 }}>
        {p.pieces.map((x, i) => <li key={`${x.nom}-${i}`}>{x.nom ?? 'pièce sans nom lu'} ({x.niveau}) : {fr(x.surfaceM2, 1)} m² — {LIBELLE_STATUT_PLAN[x.statut]}</li>)}
      </ul></>}
    </div>}
    <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
      <button type="button" style={pret ? principal : { ...principal, opacity: 0.5, cursor: 'not-allowed' }} disabled={!pret} onClick={() => onValider(p)}
        title={pret ? undefined : 'Confirmez ou corrigez d’abord les valeurs « à confirmer ».'}>Utiliser ce plan</button>
      <button type="button" style={bouton} onClick={onSaisie}>Saisir les cotes à la place</button>
    </p>
  </section>;
}
