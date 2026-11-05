// src/spaces/copilot/agent/conception/CarteConceptionPrete.tsx
// En tête du rapport d'une mission de CONCEPTION (rapport.conception) : règles
// réunies, règles encore inconnues, et accès aux trois voies du plan.
import { Building2 } from 'lucide-react';
import { LIBELLE_REGLE, regleAPreciser, regleConnue, type RegleConception } from '@/spaces/promoteur/shared/echangeStudio/conception';
import { useAgentUi } from '../agentUi.store';
import { fM2 } from '../rapport/rapportModele';
import { lireConceptionPrete } from './conceptionLogique';
import { useAtelierConception } from './conceptionUi.store';
import './conception.css';

/** Valeur affichée : « non réglementée » (lot Q1) ou valeur et unité. */
function valeurAffichee(r: RegleConception): string {
  if (r.nature === 'non_reglementee') return 'non réglementée';
  const base = `${String(r.valeur).replace('.', ',')} ${r.unite}`;
  if (r.nature !== 'par_secteur' || !r.secteur) return base;
  // Lot Q1 : mesure retenue (acrotère / égout / la plus restrictive) et réserve de la règle relative.
  return `${base} (secteur ${r.secteur}${r.mesure_retenue ? ` — ${r.mesure_retenue}` : ''})${r.regle_relative ? `, sous réserve de « ${r.regle_relative} »` : ''}`;
}

/** Détail cité d'un secteur : « acrotère 21 m, égout 21 m, faîtage 24 m ». */
function detailSecteur(e: NonNullable<RegleConception['valeurs_par_secteur']>[number], unite: string): string {
  const m = ([['acrotère', e.acrotere_terrasse], ['égout', e.egout], ['faîtage', e.faitage]] as const).filter(([, v]) => typeof v === 'number');
  const f = (v: number | string) => `${String(v).replace('.', ',')} ${unite}`;
  return (m.length ? m.map(([n, v]) => `${n} ${f(v as number)}`).join(', ') : f(e.valeur)) + (e.exceptions ? ` ; exception non retenue : ${e.exceptions}` : '');
}

/** Règle par secteur, secteur inconnu : valeurs de chaque secteur et renvoi au plan. */
function aPreciser(r: RegleConception): string {
  const vals = (r.valeurs_par_secteur ?? []).map((e) => `secteur ${e.secteur} : ${detailSecteur(e, r.unite)}`).join(' | ');
  return `${LIBELLE_REGLE[r.cle].libelle} — selon le secteur du plan graphique (${vals})${r.article ? `, ${r.article}` : ''} : secteur de la parcelle à indiquer.` +
    (r.regle_relative ? ` En plus : « ${r.regle_relative} ».` : '');
}

export function CarteConceptionPrete({ rapport }: { rapport: unknown }) {
  const c = lireConceptionPrete(rapport);
  if (!c) return null;
  // Lot Q1 : « non réglementée » (citée) compte comme connue ; « par secteur, secteur inconnu » est à préciser.
  const connues = c.regles.filter(regleConnue);
  const aPreciserListe = c.regles.filter(regleAPreciser);
  return (
    <section className="mzcp-suite" aria-label="Conception prête">
      <span className="mzag-sur"><Building2 size={14} aria-hidden /> Règles prêtes · parcelle {c.idu}</span>
      <p className="mzag-rapport__para" style={{ marginTop: 6 }}>
        {[c.commune, c.surface_m2 ? fM2(c.surface_m2) : null].filter(Boolean).join(' · ')}
        {' — '}{connues.length} règle(s) connue(s) sur {c.regles.length || 9}{aPreciserListe.length > 0 ? `, ${aPreciserListe.length} à préciser` : ''}.
      </p>
      {connues.length > 0 && (
        <ul className="mzag-puces">
          {connues.map((r) => <li key={r.cle}>{LIBELLE_REGLE[r.cle].libelle} : {valeurAffichee(r)} <span className="mzag-petit">({r.source}{r.article ? `, ${r.article}` : ''}{r.statut === 'estime' ? ', estimée' : ''})</span></li>)}
        </ul>
      )}
      {aPreciserListe.length > 0 && <ul className="mzag-puces">{aPreciserListe.map((r) => <li key={r.cle} className="mzag-a-renseigner">{aPreciser(r)}</li>)}</ul>}
      {c.regles_manquantes.length > 0 && <p className="mzag-petit">Encore inconnues (non contrôlées dans le modèle) : {c.regles_manquantes.join(', ')}.</p>}
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
