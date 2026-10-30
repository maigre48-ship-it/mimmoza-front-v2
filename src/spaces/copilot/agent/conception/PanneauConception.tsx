// src/spaces/copilot/agent/conception/PanneauConception.tsx
// Onglet « Conception » du panneau de l'agent : projets en conception, règles
// du PLU réunies (avec leur source), choix de la voie du plan, versions
// enregistrées (bilan, conformité), film / visite 360° d'une version.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Clapperboard, FileUp, Orbit, PenLine, Sparkles } from 'lucide-react';
import { LIBELLE_REGLE, type PrecisionPlan } from '@/spaces/promoteur/shared/echangeStudio/conception';
import { construireTravail, creerTravail, optionsParDefaut, type TypeTravail } from '@/lib/studio/travaux';
import { dateCourte } from '../agentLogique';
import { fEur, fM2 } from '../rapport/rapportModele';
import { useAgentUi } from '../agentUi.store';
import {
  choisirVoiePlan, deposerFichier, lireConceptionParId, lireMissionOrigine, listerConceptions, listerVersions, urlSignee, utilisateurId,
} from './conceptionApi';
import {
  cheminPlan, LIBELLE_STATUT_CONCEPTION, texteTypologies, VOIES_PLAN, type Conception, type VersionConception,
} from './conceptionLogique';
import { useAtelierConception } from './conceptionUi.store';
import { projetConception } from './projetConception';
import './conception.css';

export function PanneauConception() {
  const [liste, setListe] = useState<Conception[] | null>(null);
  // Ouverture depuis le rapport d'une mission de conception : la conception concernée d'emblée.
  const [choisie, setChoisie] = useState<string | null>(() => {
    const id = useAtelierConception.getState().aAfficher;
    if (id) useAtelierConception.getState().afficher(null);
    return id;
  });
  const [erreur, setErreur] = useState<string | null>(null);
  const version = useAgentUi((s) => s.version);

  useEffect(() => {
    let vivant = true;
    void listerConceptions().then((l) => { if (vivant) { setListe(l); setErreur(null); } })
      .catch((e) => { if (vivant) { setListe([]); setErreur(e instanceof Error ? e.message : 'Lecture impossible.'); } });
    return () => { vivant = false; };
  }, [version]);

  if (choisie) return <DetailConception key={choisie} id={choisie} onRetour={() => setChoisie(null)} />;
  if (liste === null) return <p className="mzag-muet">Chargement…</p>;
  if (erreur && !liste.length) return <p className="mzag-alerte">{erreur}</p>;
  if (!liste.length) {
    return (
      <div className="mzag-vide">
        <strong>Aucun projet en conception</strong>
        À la fin d’une prospection, choisissez un terrain dans « Et maintenant ? Concevoir le projet » : MimmozIA réunit les règles du PLU, puis vous choisissez comment obtenir le plan.
      </div>
    );
  }
  return (
    <div className="mzag-liste">
      {liste.map((c) => (
        <button key={c.id} type="button" className="mzag-item" onClick={() => setChoisie(c.id)}>
          <div className="mzag-item__haut">
            <span className="mzag-item__objectif">Parcelle {c.idu}{c.commune ? ` · ${c.commune}` : ''}</span>
            <span className="mzag-pastille mzag-pastille--actif">{LIBELLE_STATUT_CONCEPTION[c.statut]}</span>
          </div>
          <span className="mzag-petit">
            {c.programme?.nb_logements ? `${c.programme.nb_logements} logements · ` : ''}{c.version_courante ? `version ${c.version_courante} · ` : ''}{dateCourte(c.maj_le ?? c.cree_le)}
          </span>
        </button>
      ))}
    </div>
  );
}

function DetailConception({ id, onRetour }: { id: string; onRetour: () => void }) {
  const [c, setC] = useState<Conception | null>(null);
  const [versions, setVersions] = useState<VersionConception[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const fichier = useRef<HTMLInputElement | null>(null);
  const version = useAgentUi((s) => s.version);

  const relire = useCallback(async () => {
    try {
      const [cc, vs] = await Promise.all([lireConceptionParId(id), listerVersions(id)]);
      setC(cc); setVersions(vs); setErreur(cc ? null : 'Projet introuvable.');
    } catch (e) { setErreur(e instanceof Error ? e.message : 'Lecture impossible.'); }
  }, [id]);
  useEffect(() => { void relire(); }, [relire, version]);

  const ouvrirAtelier = async (voie: PrecisionPlan, planFichier: string | null) => {
    if (!c) return;
    setOccupe(voie); setErreur(null);
    try {
      await choisirVoiePlan(c.id, voie, planFichier);
      const planUrl = planFichier ? await urlSignee(planFichier) : null;
      useAgentUi.getState().fermer();
      useAtelierConception.getState().ouvrir({ conception: { ...c, plan_source: voie, plan_fichier: planFichier }, voie, planUrl, modeleUrl: null });
    } catch (e) { setErreur(e instanceof Error ? e.message : 'Ouverture impossible.'); }
    finally { setOccupe(null); }
  };

  const deposerPlan = async (f: File) => {
    if (!c) return;
    setErreur(null);
    try {
      const uid = await utilisateurId();
      const ch = cheminPlan(uid, c.id, f);
      if (!ch.ok) { setErreur(ch.erreur); return; }
      setOccupe('plan_fourni');
      await deposerFichier(ch.chemin, f, ch.type);
      await ouvrirAtelier('plan_fourni', ch.chemin);
    } catch (e) { setErreur(e instanceof Error ? e.message : 'Dépôt impossible.'); setOccupe(null); }
  };

  const reprendre = async (v: VersionConception) => {
    if (!c || !c.plan_source) return;
    const modeleUrl = v.modele_ref ? await urlSignee(v.modele_ref) : null;
    const planUrl = c.plan_fichier ? await urlSignee(c.plan_fichier) : null;
    useAgentUi.getState().fermer();
    useAtelierConception.getState().ouvrir({ conception: c, voie: c.plan_source, planUrl, modeleUrl });
  };

  const lancerRendu = async (v: VersionConception, type: TypeTravail) => {
    if (!c) return;
    setOccupe(`${type}-${v.n}`); setInfo(null); setErreur(null);
    try {
      const mission = await lireMissionOrigine(c.mission_id ?? c.mission_origine_id);
      if (!mission?.conversation_id) { setErreur('Ouvrez la conversation de la mission pour lancer un film ou une visite.'); return; }
      const page = new URL(window.location.href); page.hash = '';
      const projet = projetConception(c, crypto.randomUUID(), window.location.origin, page.href);
      if (!projet.ok) { setErreur(`Le projet n’a pas pu être préparé : ${projet.erreur}.`); return; }
      // Le rendu part de la version enregistrée : le Studio recharge `conception.modele_ref`.
      const charge = { ...projet.projet, conception: { conception_id: c.id, n: v.n, modele_ref: v.modele_ref } };
      const draft = {
        version: 1, objectif: `Projet sur la parcelle ${c.idu}${c.commune ? ` à ${c.commune}` : ''} — version ${v.n}`,
        localisation: c.commune, programme: v.metriques ? `${v.metriques.nb_logements ?? 'nombre de'} logements${v.metriques.nb_logements == null ? ' à préciser' : ''}, ${Math.round(v.metriques.sdp_m2)} m² SDP` : null,
        dimensions: v.metriques ? `${v.metriques.niveaux} niveaux, ${v.metriques.hauteur_m} m` : null, style: null, contraintes: null, questions: [], pieces: [],
      };
      const t = construireTravail(type, draft, mission.conversation_id, charge, optionsParDefaut(type));
      if (!t.ok) { setErreur(t.erreur); return; }
      const r = await creerTravail(t.valeur);
      setInfo(r.disponible ? `${type === 'film' ? 'Film' : 'Visite 360°'} lancé : suivez-le dans la conversation de la mission (dossier 3D).` : 'Les films et visites seront bientôt disponibles.');
    } catch (e) { setErreur(e instanceof Error ? e.message : 'Lancement impossible.'); }
    finally { setOccupe(null); }
  };

  const retour = <button type="button" className="mzag-btn mzag-btn--discret mzag-btn--petit" onClick={onRetour}><ArrowLeft size={14} aria-hidden /> Tous les projets</button>;
  if (!c) return <div className="mzag-pile">{retour}{erreur ? <p className="mzag-alerte">{erreur}</p> : <p className="mzag-muet">Chargement…</p>}</div>;

  // Une conception archivée se consulte seulement (jamais de désarchivage depuis l'interface).
  const archivee = c.statut === 'archive';
  const reglesPretes = c.statut !== 'regles' && !archivee;
  return (
    <div className="mzag-pile">
      {retour}
      <section className="mzag-carte">
        <div className="mzag-item__haut">
          <span className="mzag-sur">Conception · {LIBELLE_STATUT_CONCEPTION[c.statut]}</span>
        </div>
        <h3 className="mzag-titre" style={{ margin: '6px 0 2px' }}>Parcelle {c.idu}</h3>
        <p className="mzag-petit" style={{ margin: 0 }}>
          {[c.commune, c.parcelle?.surface_m2 ? fM2(c.parcelle.surface_m2) : null].filter(Boolean).join(' · ')}
          {c.programme ? ` · ${c.programme.nb_logements ?? '?'} logements (${texteTypologies(c.programme.typologies)})${c.programme.gabarit ? ` · ${c.programme.gabarit}` : ''}` : ''}
        </p>
      </section>

      {erreur && <p className="mzag-alerte" role="alert">{erreur}</p>}
      {info && <p className="mzag-ok" role="status">{info}</p>}

      <section className="mzag-carte">
        <span className="mzag-sur">Règles du PLU retenues</span>
        {c.regles.length === 0 ? <p className="mzag-muet">La mission rassemble encore les règles.</p> : (
          <div className="mzag-tableau-wrap" style={{ marginTop: 8 }}>
            <table className="mzag-tableau">
              <thead><tr><th>Règle</th><th>Valeur</th><th>Statut</th><th>Source</th></tr></thead>
              <tbody>
                {c.regles.map((r) => (
                  <tr key={r.cle}>
                    <td>{LIBELLE_REGLE[r.cle].libelle}</td>
                    <td>{r.valeur == null ? <span className="mzag-a-renseigner">inconnue</span> : `${String(r.valeur).replace('.', ',')} ${r.unite}`}</td>
                    <td><span className={`mzag-pastille mzag-pastille--${r.statut === 'confirme' ? 'succes' : r.statut === 'estime' ? 'attente' : 'neutre'}`}>{r.statut === 'confirme' ? 'Confirmée' : r.statut === 'estime' ? 'Estimée' : 'Inconnue'}</span></td>
                    <td className="mzag-petit">{r.source}{r.article ? `, ${r.article}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <span className="mzag-sur">Comment obtenir le plan ?</span>
        {archivee && <p className="mzag-petit">Projet archivé : consultation seulement.</p>}
        {!reglesPretes && !archivee && <p className="mzag-petit">Disponible dès que la mission aura réuni les règles.</p>}
        <div className="mzcp-voies">
          <article className={`mzcp-voie${c.plan_source === 'plan_fourni' ? ' is-choisie' : ''}`}>
            <FileUp size={20} aria-hidden />
            <strong>{VOIES_PLAN.plan_fourni.titre}</strong>
            <p>{VOIES_PLAN.plan_fourni.texte}</p>
            <p className="mzcp-precision">{VOIES_PLAN.plan_fourni.precision}</p>
            <input ref={fichier} type="file" accept="application/pdf,image/png,image/jpeg" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void deposerPlan(f); }} />
            <button type="button" className="mzag-btn mzag-btn--petit" disabled={!reglesPretes || occupe !== null} onClick={() => fichier.current?.click()}>
              {occupe === 'plan_fourni' ? 'Envoi…' : 'Déposer le plan'}
            </button>
          </article>
          <article className={`mzcp-voie${c.plan_source === 'dessin' ? ' is-choisie' : ''}`}>
            <PenLine size={20} aria-hidden />
            <strong>{VOIES_PLAN.dessin.titre}</strong>
            <p>{VOIES_PLAN.dessin.texte}</p>
            <p className="mzcp-precision">{VOIES_PLAN.dessin.precision}</p>
            <button type="button" className="mzag-btn mzag-btn--petit" disabled={!reglesPretes || occupe !== null} onClick={() => void ouvrirAtelier('dessin', null)}>
              {occupe === 'dessin' ? 'Ouverture…' : 'Dessiner dans l’Atelier'}
            </button>
          </article>
          <article className={`mzcp-voie${c.plan_source === 'auto' ? ' is-choisie' : ''}`}>
            <Sparkles size={20} aria-hidden />
            <strong>{VOIES_PLAN.auto.titre}</strong>
            <p>{VOIES_PLAN.auto.texte}</p>
            <p className="mzcp-precision">{VOIES_PLAN.auto.precision}</p>
            <button type="button" className="mzag-btn mzag-btn--petit" disabled={!reglesPretes || occupe !== null} onClick={() => void ouvrirAtelier('auto', null)}>
              {occupe === 'auto' ? 'Ouverture…' : 'Laisser Mimmoza proposer'}
            </button>
          </article>
        </div>
      </section>

      {versions.length > 0 && (
        <section className="mzag-carte">
          <span className="mzag-sur">Versions enregistrées</span>
          <ul className="mzcp-versions">
            {versions.map((v) => {
              const ko = v.conformite.filter((x) => x.ok === false).length;
              const inconnues = v.conformite.filter((x) => x.ok === null).length;
              return (
                <li key={v.id}>
                  <div className="mzag-item__haut">
                    <strong>Version {v.n}</strong>
                    <span className="mzag-petit">{dateCourte(v.cree_le)}</span>
                  </div>
                  {v.resume && <p className="mzag-petit" style={{ margin: '2px 0' }}>{v.resume}</p>}
                  <p style={{ margin: '2px 0', fontSize: 13 }}>
                    {v.metriques ? `${fM2(v.metriques.sdp_m2)} SDP · ${v.metriques.nb_logements == null ? 'logements à préciser' : `${v.metriques.nb_logements} logements`} · ` : ''}
                    Charge foncière : <strong>{fEur(v.bilan?.charge_fonciere_admissible_ht ?? null)}</strong>
                  </p>
                  <p className="mzag-petit" style={{ margin: 0 }}>
                    PLU : {ko ? `${ko} dépassement(s)` : 'aucun dépassement relevé'}{inconnues ? ` · ${inconnues} règle(s) non contrôlée(s)` : ''}
                  </p>
                  <div className="mzag-actions" style={{ marginTop: 6 }}>
                    <button type="button" className="mzag-btn mzag-btn--petit" disabled={occupe !== null || !c.plan_source || archivee} onClick={() => void reprendre(v)}>Rouvrir dans l’Atelier</button>
                    <button type="button" className="mzag-btn mzag-btn--petit mzag-btn--discret" disabled={occupe !== null || !v.modele_ref} onClick={() => void lancerRendu(v, 'film')}>
                      <Clapperboard size={13} aria-hidden /> {occupe === `film-${v.n}` ? 'Lancement…' : 'Film'}
                    </button>
                    <button type="button" className="mzag-btn mzag-btn--petit mzag-btn--discret" disabled={occupe !== null || !v.modele_ref} onClick={() => void lancerRendu(v, 'visite360')}>
                      <Orbit size={13} aria-hidden /> {occupe === `visite360-${v.n}` ? 'Lancement…' : 'Visite 360°'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
