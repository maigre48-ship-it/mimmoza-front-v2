// src/spaces/copilot/agent/conception/CarteConceptionPrete.tsx
// En tête du rapport d'une mission de CONCEPTION (rapport.conception) : règles
// réunies, règles encore inconnues, et accès aux trois voies du plan.
import { Building2 } from 'lucide-react';
import { LIBELLE_REGLE } from '@/spaces/promoteur/shared/echangeStudio/conception';
import { useAgentUi } from '../agentUi.store';
import { fM2 } from '../rapport/rapportModele';
import { lireConceptionPrete } from './conceptionLogique';
import { useAtelierConception } from './conceptionUi.store';
import './conception.css';

export function CarteConceptionPrete({ rapport }: { rapport: unknown }) {
  const c = lireConceptionPrete(rapport);
  if (!c) return null;
  const connues = c.regles.filter((r) => r.statut !== 'manquant');
  return (
    <section className="mzcp-suite" aria-label="Conception prête">
      <span className="mzag-sur"><Building2 size={14} aria-hidden /> Règles prêtes · parcelle {c.idu}</span>
      <p className="mzag-rapport__para" style={{ marginTop: 6 }}>
        {[c.commune, c.surface_m2 ? fM2(c.surface_m2) : null].filter(Boolean).join(' · ')}
        {' — '}{connues.length} règle(s) connue(s) sur {c.regles.length || 9}.
      </p>
      {connues.length > 0 && (
        <ul className="mzag-puces">
          {connues.map((r) => <li key={r.cle}>{LIBELLE_REGLE[r.cle].libelle} : {String(r.valeur).replace('.', ',')} {r.unite} <span className="mzag-petit">({r.source}{r.article ? `, ${r.article}` : ''}{r.statut === 'estime' ? ', estimée' : ''})</span></li>)}
        </ul>
      )}
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
