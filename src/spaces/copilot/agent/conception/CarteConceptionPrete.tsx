// src/spaces/copilot/agent/conception/CarteConceptionPrete.tsx
// En tête du rapport d'une mission de CONCEPTION (rapport.conception) : règles
// réunies, règles encore inconnues, et accès aux trois voies du plan.
import { Building2 } from 'lucide-react';
import { LIBELLE_REGLE, regleAPreciser, regleConnue, type RegleConception } from '@/spaces/promoteur/shared/echangeStudio/conception';
import { useAgentUi } from '../agentUi.store';
import { fM2 } from '../rapport/rapportModele';
import { lireConceptionPrete } from './conceptionLogique';
import { useAtelierConception } from './conceptionUi.store';
import { detailSecteurAffiche, harmoniserReglesAffichees, nouvellesInconnues, valeurAffichee } from './reglesAffichage';
import './conception.css';

/** Règle par secteur, secteur inconnu : valeurs de chaque secteur et renvoi au plan. */
function aPreciser(r: RegleConception): string {
  const vals = (r.valeurs_par_secteur ?? []).map((e) => `secteur ${e.secteur} : ${detailSecteurAffiche(e, r.unite)}`).join(' | ');
  return `${LIBELLE_REGLE[r.cle].libelle} — selon le secteur du plan graphique (${vals})${r.article ? `, ${r.article}` : ''} : secteur de la parcelle à indiquer.` +
    (r.regle_relative ? ` En plus : « ${r.regle_relative} ».` : '');
}

export function CarteConceptionPrete({ rapport }: { rapport: unknown }) {
  const c = lireConceptionPrete(rapport);
  if (!c) return null;
  // Lot A : mêmes gardes que le moteur, aussi pour les rapports déjà stockés (formule « voir recul aux limites »,
  // « non réglementée » d'un autre sujet → inconnue).
  const regles = harmoniserReglesAffichees(c.regles);
  const inconnues = [...new Set([...c.regles_manquantes, ...nouvellesInconnues(c.regles, regles)])];
  // Lot Q1 : « non réglementée » (citée) compte comme connue ; « par secteur, secteur inconnu » est à préciser.
  const connues = regles.filter(regleConnue);
  const aPreciserListe = regles.filter(regleAPreciser);
  return (
    <section className="mzcp-suite" aria-label="Conception prête">
      <span className="mzag-sur"><Building2 size={14} aria-hidden /> Règles prêtes · parcelle {c.idu}</span>
      <p className="mzag-rapport__para" style={{ marginTop: 6 }}>
        {[c.commune, c.surface_m2 ? fM2(c.surface_m2) : null].filter(Boolean).join(' · ')}
        {' — '}{connues.length} règle(s) connue(s) sur {regles.length || 9}{aPreciserListe.length > 0 ? `, ${aPreciserListe.length} à préciser` : ''}.
      </p>
      {connues.length > 0 && (
        <ul className="mzag-puces">
          {connues.map((r) => <li key={r.cle}>{LIBELLE_REGLE[r.cle].libelle} : {valeurAffichee(r)} <span className="mzag-petit">({r.source}{r.article ? `, ${r.article}` : ''}{r.statut === 'estime' ? ', estimée' : ''})</span></li>)}
        </ul>
      )}
      {aPreciserListe.length > 0 && <ul className="mzag-puces">{aPreciserListe.map((r) => <li key={r.cle} className="mzag-a-renseigner">{aPreciser(r)}</li>)}</ul>}
      {inconnues.length > 0 && <p className="mzag-petit">Encore inconnues (non contrôlées dans le modèle) : {inconnues.join(', ')}.</p>}
      {c.alertes_programme.length > 0 && <ul className="mzag-puces">{c.alertes_programme.map((a) => <li key={a} className="mzag-a-renseigner">{a}</li>)}</ul>}
      <div className="mzag-actions" style={{ marginTop: 8 }}>
        <button type="button" className="mzag-btn mzag-btn--plein mzag-btn--petit" onClick={() => { useAtelierConception.getState().afficher(c.conception_id); useAgentUi.getState().ouvrir('conception'); }}>
          Choisir comment obtenir le plan
        </button>
        {c.prochaine_etape && <span className="mzag-petit">{c.prochaine_etape}</span>}
      </div>
    </section>
  );
}
