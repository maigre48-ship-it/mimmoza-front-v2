// src/spaces/copilot/onboarding/PremierContact.tsx
// =============================================================================
// PREMIER CONTACT GUIDÉ — encart d'accueil (fermable, non bloquant) + checklist
// « Bien démarrer » qui se coche à partir des données réelles du compte.
// Chargé en différé par MimmozIAPage (React.lazy) : n'alourdit pas l'accueil.
// =============================================================================

import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowRight, Box, Calculator, Check, Home, LandPlot, LifeBuoy, MapPin, TrendingUp, X,
} from 'lucide-react';
import type { PlanId } from '@/lib/billing/planAccess';
import {
  type ActionDemarrage,
  type EtatOnboarding,
  type IconeAction,
  type ProfilDeclare,
  PROFILS,
  actionsPourProfil,
  afficherChecklist,
  afficherEncart,
  etapesChecklist,
  normaliserProfil,
  rappelQuota,
} from './onboardingRegles';
import { chargerOnboarding, enregistrerOnboarding, signalerConnexionEmails } from './onboardingDonnees';
import { type AffichagePremierContact, memoriserAffichage } from './reserve';
import { ExempleRapport } from './ExempleRapport';
import './PremierContact.css';

const ICONES: Record<IconeAction, typeof MapPin> = {
  adresse: MapPin,
  bilan: Calculator,
  '3d': Box,
  rentabilite: TrendingUp,
  plu: LandPlot,
  estimation: Home,
};

export interface PremierContactProps {
  plan: PlanId;
  /** Profil déduit des usages (v_user_profile), utilisé si rien n'est déclaré. */
  profilDeduit?: string | null;
  /** Envoie la demande à Mimmo (bascule en conversation). */
  onLancer: (demande: string) => void;
  /** Pré-remplit la barre de saisie sans envoyer. */
  onPreRemplir: (demande: string) => void;
  /** Appelé après fermeture de l'encart (pour rendre le focus à la saisie). */
  onFerme?: () => void;
  /** Affichage réservé par la page avant le chargement (même gabarit = pas de saut). */
  affichageReserve: AffichagePremierContact;
}

function CarteAction({ action, onLancer, onPreRemplir }: {
  action: ActionDemarrage;
  onLancer: (d: string) => void;
  onPreRemplir: (d: string) => void;
}) {
  const [valeur, setValeur] = useState('');
  const idChamp = useId();
  const Icone = ICONES[action.icone];

  const soumettre = (e: FormEvent) => {
    e.preventDefault();
    if (action.champ) {
      const v = valeur.trim();
      if (!v) { onPreRemplir(action.demande('')); return; }
      onLancer(action.demande(v));
      return;
    }
    onLancer(action.demande());
  };

  return (
    <li className="mzia-onb__action">
      <form onSubmit={soumettre} className="mzia-onb__action-form">
        <div className="mzia-onb__action-head">
          <span className="mzia-onb__action-icon" aria-hidden><Icone size={18} /></span>
          <span className="mzia-onb__action-txt">
            <strong>{action.titre}</strong>
            <span>{action.sousTitre}</span>
          </span>
        </div>
        {action.champ ? (
          <div className="mzia-onb__field">
            <label htmlFor={idChamp} className="mzia-onb__sr">{action.champ.libelle}</label>
            <input
              id={idChamp}
              type="text"
              inputMode="text"
              autoComplete="street-address"
              placeholder={action.champ.placeholder}
              value={valeur}
              onChange={(e) => setValeur(e.target.value)}
            />
            <button type="submit" className="mzia-onb__go" aria-label={`${action.titre} : lancer`}>
              <ArrowRight size={16} aria-hidden />
            </button>
          </div>
        ) : (
          <button type="submit" className="mzia-onb__launch">
            Lancer <ArrowRight size={15} aria-hidden />
          </button>
        )}
        {action.mention && <p className="mzia-onb__mention">{action.mention}</p>}
      </form>
    </li>
  );
}

function Checklist({ etat, compacte, onFermer }: { etat: EtatOnboarding; compacte: boolean; onFermer: () => void }) {
  const etapes = etapesChecklist(etat);
  const faites = etapes.filter((e) => e.fait).length;
  const idTitre = useId();
  return (
    <aside className={`mzia-onb-check${compacte ? ' is-compact' : ''}`} aria-labelledby={idTitre}>
      <div className="mzia-onb-check__head">
        <h3 id={idTitre}>Bien démarrer <span>{faites}/{etapes.length}</span></h3>
        <button type="button" className="mzia-onb__close mzia-onb__close--small" onClick={onFermer} aria-label="Masquer la liste « Bien démarrer »">
          <X size={15} aria-hidden />
        </button>
      </div>
      <div className="mzia-onb-check__bar" role="progressbar" aria-valuemin={0} aria-valuemax={etapes.length} aria-valuenow={faites} aria-label="Progression">
        <span style={{ width: `${(faites / etapes.length) * 100}%` }} />
      </div>
      <ul>
        {etapes.map((e) => (
          <li key={e.id} className={e.fait ? 'is-done' : ''}>
            <span className="mzia-onb-check__tick" aria-hidden>{e.fait && <Check size={12} strokeWidth={3} />}</span>
            <span className="mzia-onb-check__txt">
              <strong>{e.libelle}</strong>
              <span>{e.aide}</span>
            </span>
            <span className="mzia-onb__sr">{e.fait ? '(fait)' : '(à faire)'}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export default function PremierContact({ plan, profilDeduit, onLancer, onPreRemplir, onFerme, affichageReserve }: PremierContactProps) {
  const [etat, setEtat] = useState<EtatOnboarding | null>(null);
  const [profil, setProfil] = useState<ProfilDeclare | null>(null);
  const idTitre = useId();

  useEffect(() => {
    let vivant = true;
    void chargerOnboarding()
      .then((d) => {
        if (!vivant) return;
        if (!d) { setEtat(null); memoriserAffichage('rien'); return; }
        setEtat(d.etat);
        setProfil(d.profil);
        if (afficherEncart(d.etat)) signalerConnexionEmails();
      })
      .catch(() => { if (vivant) setEtat(null); });
    return () => { vivant = false; };
  }, []);

  const affichage: AffichagePremierContact | null = etat
    ? afficherEncart(etat) ? 'encart' : afficherChecklist(etat) ? 'checklist' : 'rien'
    : null;

  useEffect(() => { if (affichage) memoriserAffichage(affichage); }, [affichage]);

  const profilEffectif = profil ?? normaliserProfil(profilDeduit);
  const actions = useMemo(() => actionsPourProfil(profilEffectif), [profilEffectif]);
  const quota = useMemo(() => rappelQuota(plan), [plan]);

  const choisirProfil = useCallback((p: ProfilDeclare) => {
    setProfil(p);
    void enregistrerOnboarding({ profil: p });
  }, []);

  const fermerEncart = useCallback(() => {
    setEtat((e) => (e ? { ...e, encartFerme: true } : e));
    void enregistrerOnboarding({ encart_ferme_le: new Date().toISOString() });
    onFerme?.();
  }, [onFerme]);

  const fermerChecklist = useCallback(() => {
    setEtat((e) => (e ? { ...e, checklistFermee: true } : e));
    void enregistrerOnboarding({ checklist_fermee_le: new Date().toISOString() });
  }, []);

  // Chargement : même gabarit que ce qui était affiché la dernière fois.
  if (!etat) {
    return affichageReserve === 'rien' ? null : <SqueletteOnboarding affichage={affichageReserve} />;
  }
  if (affichage === 'rien') return null;
  if (affichage === 'checklist') return <Checklist etat={etat} compacte onFermer={fermerChecklist} />;

  return (
    <section className="mzia-onb" aria-labelledby={idTitre}>
      <button type="button" className="mzia-onb__close" onClick={fermerEncart} aria-label="Fermer l’encart d’accueil">
        <X size={18} aria-hidden />
      </button>

      <div className="mzia-onb__main">
        <p className="mzia-onb__eyebrow">PREMIERS PAS</p>
        <h2 id={idTitre}>Votre première analyse en moins d’une minute</h2>
        <p className="mzia-onb__lead">
          Mimmoza croise les données publiques (cadastre, PLU, risques, marché) et Mimmo les analyse pour vous.
          Choisissez un point de départ&nbsp;:
        </p>

        <div className="mzia-onb__profil" role="group" aria-label="Votre activité">
          <span className="mzia-onb__profil-label">Vous êtes&nbsp;:</span>
          {PROFILS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="mzia-onb__chip"
              aria-pressed={profilEffectif === p.id}
              onClick={() => choisirProfil(p.id)}
            >
              {p.libelle}
            </button>
          ))}
        </div>

        <ul className="mzia-onb__actions">
          {actions.map((a) => (
            <CarteAction key={a.id} action={a} onLancer={onLancer} onPreRemplir={onPreRemplir} />
          ))}
        </ul>
      </div>

      <div className="mzia-onb__side">
        <ExempleRapport />
        <div className="mzia-onb__quota">
          <p className="mzia-onb__quota-title">Inclus dans votre formule <strong>{quota.nomFormule}</strong></p>
          <ul>
            {quota.lignes.map((l) => <li key={l}>{l}</li>)}
          </ul>
          <p className="mzia-onb__quota-after">{quota.apres}</p>
        </div>
        <a className="mzia-onb__help" href="/aide">
          <LifeBuoy size={15} aria-hidden /> Besoin d’aide&nbsp;? Consultez le centre d’aide
        </a>
      </div>

      {afficherChecklist(etat) && (
        <div className="mzia-onb__checkslot">
          <Checklist etat={etat} compacte={false} onFermer={fermerChecklist} />
        </div>
      )}
    </section>
  );
}

/** Place réservée (classes stylées dans MimmozIAPage.css, chargées sans attendre). */
export function SqueletteOnboarding({ affichage }: { affichage: AffichagePremierContact }) {
  if (affichage === 'rien') return null;
  return <div className={affichage === 'checklist' ? 'mzia-onb-skel mzia-onb-skel--check' : 'mzia-onb-skel'} aria-hidden />;
}
