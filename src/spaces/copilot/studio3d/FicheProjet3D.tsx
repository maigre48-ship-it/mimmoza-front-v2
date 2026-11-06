// src/spaces/copilot/studio3d/FicheProjet3D.tsx
// =============================================================================
// LOT FICHE-3D — Champs « Programme », « Dimensions » et « Style » de la fiche
// « Espace 3D — Dossier du projet » (JarvisDraftPanel).
//
//   - Programme et dimensions : chiffres du MOTEUR (volume préparé par Mimmo pour la
//     conception, ligne studio_preparations relue sans confiance), jamais le texte du
//     modèle ; l'utilisateur modifie forme, longueur, largeur, niveaux et le moteur
//     recalcule (ficheDimensions.ts : SDP, logements, reculs, vérifications PLU).
//   - Style : cartes des styles que le Studio sait rendre (briefCreatif.STYLES, une
//     seule liste) et habillage = le MÊME brief que la carte « Brief créatif » du chat
//     (le plus récent gagne, fiche ou carte) ; « Modifier l'habillage » ouvre cette carte.
//
// LOT BRIEF-UNIFIÉ (06/11/2026) — UN SEUL lieu pour le brief : la section « Style et
// habillage » ci-dessous. Le chat n'affiche plus qu'une ligne qui ouvre cette section
// (état `habillage` tenu par CopilotChat) ; quand Mimmo attend le brief d'un rendu (demandeEnCours),
// « Valider » envoie le bloc TYPÉ et Mimmo enchaîne sur le devis. Les styles ne sont
// montrés qu'ici (cartes) : la carte d'habillage n'a plus sa ligne « Style ».
// Mise en page : requêtes de conteneur (largeur RÉELLE du panneau, ≈ 450–500 px ou agrandi).
// Composants minces : toute la logique est dans ficheDimensions.ts et briefCreatif.ts.
//
// LOT FORMES-BATIMENT (section Dimensions seulement : IconeForme, Schema, AilesCorps,
// SuggestionFormes, DimensionsFiche) : plots multiples, en L, en U, cour fermée, redans
// (formesBatiment.ts) ; saisie aile par aile ; plan coté du contour réel ; comparaison des
// formes par le moteur (suggestion, l'utilisateur choisit) ; « Préparer la 3D avec cette
// forme » envoie un bloc ```mimmoza-forme``` que le serveur relit et recalcule.
// =============================================================================
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUpRight, Box, Palette, RotateCcw, Sparkles } from 'lucide-react';
import { messageErreur } from '@/components/ui/messageErreur';
import type { JarvisDraft } from './jarvisDraft';
import type { ConfirmedTerrain } from './terrainCadastre';
import type { IssueOuvertureStudio } from './JarvisDraftPanel';
import { LIBELLES_VERDICT, ouverturePreparation, type MessageOutils } from './preparationStudio';
import type { EtatFiche3D } from './useFiche3D';
import {
  FORMES, apercuDepuisEvaluation, ecartsProgramme, messageForme, phraseSuggestion, programmeMoteur, raisonFormeIndisponible, schemaForme,
  type CorpsEvalue, type EvaluationFiche, type Forme, type FormeComparee,
} from './ficheDimensions';
import { ROLES_AILES } from './formesBatiment';
import {
  CHOIX_DEFAUT, STYLES, briefCourant, demandeEnCours, demandePanneau, dessinStyle, recapitulatif,
  type ChoixBrief, type DemandeBrief, type LimitesBrief, type Style,
} from './briefCreatif';
import { VignetteTravee } from './VignetteTravee';
import { CarteBriefCreatif } from './CarteBriefCreatif';
import { libelleNiveaux } from './volumeParcelle';
import './FicheProjet3D.css';

type MessageFiche = MessageOutils & { role: string; text: string };
type OuvrirStudio = (draft: JarvisDraft, conversationId: string, terrain?: ConfirmedTerrain & { adresse?: string | null }) => Promise<IssueOuvertureStudio>;
const fr = (v: number, d = 0) => v.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 });

// ── Programme ────────────────────────────────────────────────────────────────
export function ProgrammeFiche({ fiche, texteModele }: { fiche: Extract<EtatFiche3D, { etat: 'ok' }>; texteModele: string | null }) {
  const ecarts = ecartsProgramme(texteModele, fiche.ev);
  return <div className="mz-fiche3d mz-fiche3d--programme">
    <p className="mz-fiche3d__valeur">{programmeMoteur(fiche.ev)}</p>
    <p className="mz-fiche3d__source">Calculé par le moteur{fiche.ev.modifie ? ' avec vos dimensions' : ' (volume préparé par Mimmo)'} — valeurs indicatives.</p>
    {ecarts.length > 0 && <div className="mz-fiche3d__ecart" role="note">
      <strong>Mimmo avait écrit « {texteModele} »</strong> : ce sont les chiffres du moteur qui comptent.
      <ul>{ecarts.map((e) => <li key={e.libelle}>{e.libelle} : {e.modele} → {e.moteur}</li>)}</ul>
    </div>}
  </div>;
}

// ── Dimensions ───────────────────────────────────────────────────────────────
function IconeForme({ forme }: { forme: Forme }) {
  const r = (x: number, y: number, w: number, h: number) => <rect x={x} y={y} width={w} height={h} rx="1" />;
  return <svg viewBox="0 0 40 28" aria-hidden="true" className="mz-fiche3d__icone">
    {forme === 'barre' && r(4, 10, 32, 8)}
    {forme === 'barres' && <>{r(4, 4, 32, 7)}{r(4, 17, 32, 7)}</>}
    {forme === 'plot' && r(12, 6, 16, 16)}
    {forme === 'plots' && <>{r(3, 9, 10, 10)}{r(15, 9, 10, 10)}{r(27, 9, 10, 10)}</>}
    {forme === 'l' && <path d="M5 4h8v14h22v7H5z" />}
    {forme === 'u' && <path d="M4 4h8v14h16V4h8v21H4z" />}
    {forme === 'cour' && <path fillRule="evenodd" d="M5 3h30v22H5zM13 9v10h14V9z" />}
    {forme === 'redans' && <path d="M3 17h12v-5h11V7h11v8H26v5H15v5H3z" />}
  </svg>;
}

function ChampNombre({ valeur, libelle, suffixe, onValider, pas = 0.5, min, max }: {
  valeur: number; libelle: string; suffixe: string; onValider: (v: string) => void; pas?: number; min: number; max: number;
}) {
  // Remonté (clé = valeur) quand le moteur borne ou recalcule la valeur : pas de synchronisation par effet.
  const [texte, setTexte] = useState(String(valeur).replace('.', ','));
  const valider = () => { if (texte.replace(',', '.') !== String(valeur)) onValider(texte); };
  return <label className="mz-fiche3d__champ">
    <span>{libelle}</span>
    <span className="mz-fiche3d__saisie">
      <input inputMode="decimal" value={texte} aria-label={libelle} onChange={(e) => setTexte(e.target.value)} onBlur={valider}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') valider(); }} data-pas={pas} data-min={min} data-max={max} />
      <em>{suffixe}</em>
    </span>
  </label>;
}

function Schema({ ev }: { ev: EvaluationFiche }) {
  const s = schemaForme(ev);
  const t = Math.max(s.vue.w, s.vue.h) / 26;
  return <svg className="mz-fiche3d__schema" viewBox={`${s.vue.x} ${s.vue.y} ${s.vue.w} ${s.vue.h}`} role="img"
    aria-label={`Plan de la parcelle et des bâtiments : ${ev.corps.map((c, i) => `${String.fromCharCode(65 + i)} ${fr(c.longueurM, 1)} × ${fr(c.largeurM, 1)} m`).join(', ')}`}>
    <polygon points={s.parcelle} className="mz-fiche3d__parcelle" strokeWidth={t / 6} />
    {s.corps.map((c) => <g key={c.etiquette}>
      {/* Lot formes-batiment : contour réel (cour en creux, règle evenodd). */}
      <path d={c.trace} fillRule="evenodd" className="mz-fiche3d__corps" strokeWidth={t / 7} />
      {c.ailes.length === 0 && <text x={c.ex} y={c.ey} fontSize={t * 1.1} textAnchor="middle" dominantBaseline="central" className="mz-fiche3d__lettre">{c.etiquette}</text>}
      {c.ailes.map((a) => <g key={a.etiquette}>
        <text x={a.ex} y={a.ey} fontSize={t * 0.95} textAnchor="middle" dominantBaseline="central" className="mz-fiche3d__lettre">{a.etiquette}</text>
        <text x={a.ex} y={a.ey + t * 1.05} fontSize={t * 0.62} textAnchor="middle" dominantBaseline="central" className="mz-fiche3d__aile-txt">{a.texte}</text>
      </g>)}
      {c.cotes.map((k, i) => <g key={i} className="mz-fiche3d__cote">
        <line x1={k.x1} y1={k.y1} x2={k.x2} y2={k.y2} strokeWidth={t / 10} />
        <text x={k.tx} y={k.ty} fontSize={t * 0.82} textAnchor="middle" dominantBaseline="central">{k.texte}</text>
      </g>)}
    </g>)}
  </svg>;
}

const VERDICT_CLASSE = { dans_la_limite: 'is-ok', au_dela: 'is-ko', a_verifier: 'is-av', non_controle: 'is-nc' } as const;

/** Lot formes-batiment : ailes d'un bâtiment en L, en U, à cour ou à redans (longueur hors tout, épaisseur, niveaux). */
function AilesCorps({ c, i, fiche }: { c: CorpsEvalue; i: number; fiche: Extract<EtatFiche3D, { etat: 'ok' }> }) {
  const roles = c.formeAiles ? ROLES_AILES[c.formeAiles] : [];
  return <div className="mz-fiche3d__ailes">
    {(c.ailes ?? []).map((a, k) => {
      const ev = c.ailesEvaluees?.find((x) => x.index === k);
      const lie = c.formeAiles === 'cour' && k >= 2;
      return <div key={k} className="mz-fiche3d__aile">
        <p className="mz-fiche3d__titre-aile"><span aria-hidden="true">{String.fromCharCode(65 + i)}{k + 1}</span>{a.nom} · {roles[k] ?? ''}
          {ev && <small>{fr(ev.empriseM2)} m² au sol · recul {fr(ev.reculReelM, 1)} m</small>}</p>
        <div className="mz-fiche3d__grille">
          <ChampNombre key={`al${k}-${a.longueurM}`} libelle={`Longueur ${a.nom}`} suffixe={lie ? 'm (liée)' : 'm'} valeur={a.longueurM} min={6} max={120} onValider={(v) => fiche.modifierAile(i, k, 'longueurM', v)} />
          <ChampNombre key={`ae${k}-${a.largeurM}`} libelle={`Épaisseur ${a.nom}`} suffixe="m" valeur={a.largeurM} min={6} max={40} onValider={(v) => fiche.modifierAile(i, k, 'largeurM', v)} />
          <ChampNombre key={`an${k}-${a.niveaux}`} libelle={`Niveaux ${a.nom}`} suffixe={libelleNiveaux(a.niveaux)} valeur={a.niveaux} pas={1} min={1} max={30} onValider={(v) => fiche.modifierAile(i, k, 'niveaux', v)} />
          <div className="mz-fiche3d__champ mz-fiche3d__champ--lecture"><span>Hauteur</span><strong>{fr(ev?.hauteurStudioM ?? 0, 2)} m</strong></div>
        </div>
      </div>;
    })}
    {c.formeAiles === 'redans' && <div className="mz-fiche3d__grille">
      <ChampNombre key={`d${c.decalageM}`} libelle="Décalage des redans" suffixe="m" valeur={c.decalageM ?? 0} min={-36} max={36} onValider={(v) => fiche.modifierDecalage(i, v)} />
    </div>}
    <p className="mz-fiche3d__source">Longueurs hors tout ; le centre et l’orientation du bâtiment sont gardés.{c.formeAiles === 'cour' ? ' Cour fermée : les côtés opposés ont la même longueur.' : ''}</p>
  </div>;
}

/** Lot formes-batiment : comparaison des formes par le moteur — suggestion de Mimmo, l'utilisateur choisit. */
function SuggestionFormes({ fiche }: { fiche: Extract<EtatFiche3D, { etat: 'ok' }> }) {
  const [liste, setListe] = useState<FormeComparee[] | null>(null);
  if (fiche.saisie.forme === 'moteur') return null;
  if (!liste) {
    return <button type="button" className="mz-fiche3d__suggerer" onClick={() => setListe(fiche.comparer())}>
      <Sparkles size={14} aria-hidden="true" /> Quelle forme maximise le programme ?
    </button>;
  }
  const phrase = phraseSuggestion(liste);
  return <div className="mz-fiche3d__suggestion" role="region" aria-label="Comparaison des formes par le moteur">
    <p><strong>Suggestion de Mimmo</strong> · {phrase ?? 'aucune forme calculable sur cette parcelle.'}</p>
    <table>
      <thead><tr><th>Forme</th><th>Logts</th><th>Niv.</th><th>SDP</th><th>Emprise</th><th>Façade</th><th></th></tr></thead>
      <tbody>{liste.map((x, k) => <tr key={x.forme} className={`${k === 0 && x.ev ? 'is-tete' : ''}${x.ev && !x.dansLesRegles ? ' is-ko' : ''}`}>
        <td>{x.libelle}</td>
        {x.ev ? <><td>{x.logements}</td><td>{libelleNiveaux(x.niveaux)}</td><td>{fr(x.sdpM2)} m²</td><td>{fr(x.empriseM2)} m²</td><td>{fr(x.facadeM)} m</td>
          <td>{fiche.saisie.forme === x.forme ? <em>choisie</em> : <button type="button" onClick={() => x.saisie && fiche.choisirSaisie(x.saisie)}>Essayer</button>}</td></>
          : <td colSpan={6} className="mz-fiche3d__raison">{x.raison}</td>}
      </tr>)}</tbody>
    </table>
    <p className="mz-fiche3d__source">Classement du moteur : dans les règles, logements placés, moins de niveaux, moins de façade, moins d’emprise. Une suggestion, pas une conformité.</p>
  </div>;
}

export function DimensionsFiche({ fiche, conversationId, onOpenStudio, texteModele, onSend }: {
  fiche: Extract<EtatFiche3D, { etat: 'ok' }>; conversationId: string | null; onOpenStudio?: OuvrirStudio;
  /** Texte « Dimensions » écrit par le modèle : remplacé par le moteur, l'écart est signalé. */
  texteModele: string | null;
  /** Lot formes-batiment : envoi du message « Préparer la 3D avec cette forme » (bloc mimmoza-forme). */
  onSend?: (texte: string) => void;
}) {
  const { ev, saisie } = fiche;
  const ecartTexte = texteModele && ecartsProgramme(texteModele, ev).length > 0;
  const [ouverture, setOuverture] = useState(false);
  const [notice, setNotice] = useState('');
  const idForme = useId();
  // Lot formes-batiment : la forme et les dimensions saisies partent au serveur, qui les recalcule avec le moteur.
  const bloque = ev.alertes.some((a) => /déborde|chevauchent/.test(a));
  const message = ev.modifie ? messageForme(saisie, ev) : null;
  const [dernierEnvoi, setDernierEnvoi] = useState<string | null>(null);
  const envoye = message !== null && message === dernierEnvoi;
  const preparer = () => {
    if (!message || !onSend) return;
    onSend(message); setDernierEnvoi(message);
  };
  const ouvrir = async () => {
    if (!conversationId || !onOpenStudio || ouverture) return;
    setOuverture(true); setNotice('');
    try {
      const o = ouverturePreparation({ ...fiche.prep, volume: ev.volume });
      if (!o.ok) throw new Error(o.erreur);
      const issue = await onOpenStudio(o.fiche, conversationId, o.terrain);
      if (issue === 'parcelle-requise') setNotice('Le Studio demande de confirmer la parcelle.');
    } catch (e) { setNotice(messageErreur(e, 'Ouverture de Studio impossible.')); } finally { setOuverture(false); }
  };
  return <div className="mz-fiche3d mz-fiche3d--dimensions">
    <fieldset className="mz-fiche3d__formes">
      <legend id={idForme}>Forme du bâtiment</legend>
      <div role="radiogroup" aria-labelledby={idForme}>
        {FORMES.map((f) => {
          const raison = raisonFormeIndisponible(f.valeur, saisie);
          const actif = saisie.forme === f.valeur;
          return <button key={f.valeur} type="button" role="radio" aria-checked={actif} disabled={!!raison && !actif} title={raison ?? f.detail}
            className={`mz-fiche3d__forme${actif ? ' is-actif' : ''}${!f.disponible ? ' is-bientot' : ''}`} onClick={() => fiche.choisirForme(f.valeur)}>
            <IconeForme forme={f.valeur} />
            <span className="mz-fiche3d__nom">{f.libelle}{!f.disponible && <em> · bientôt</em>}</span>
          </button>;
        })}
      </div>
      {saisie.forme === 'moteur' && <p className="mz-fiche3d__note">Forme choisie par le moteur pour ce programme ; vous pouvez ajuster les dimensions.</p>}
      {fiche.raisonForme && <p className="mz-fiche3d__note" role="status">{fiche.raisonForme}</p>}
    </fieldset>
    <SuggestionFormes key={fiche.prep.id} fiche={fiche} />

    <Schema ev={ev} />
    {ecartTexte && <p className="mz-fiche3d__ecart" role="note">Mimmo avait écrit « {texteModele} » : remplacé par les dimensions calculées par le moteur.</p>}

    <div className="mz-fiche3d__batiments">
      {ev.corps.map((c, i) => <div key={c.id} className="mz-fiche3d__batiment">
        <p className="mz-fiche3d__titre-bat"><span aria-hidden="true">{String.fromCharCode(65 + i)}</span>{c.nom}</p>
        {c.ailes ? <AilesCorps c={c} i={i} fiche={fiche} /> : <div className="mz-fiche3d__grille">
          <ChampNombre key={`l${c.longueurM}`} libelle="Longueur" suffixe="m" valeur={c.longueurM} min={6} max={120} onValider={(v) => fiche.modifier(i, 'longueurM', v)} />
          <ChampNombre key={`p${c.largeurM}`} libelle="Largeur" suffixe="m" valeur={c.largeurM} min={6} max={40} onValider={(v) => fiche.modifier(i, 'largeurM', v)} />
          <ChampNombre key={`n${c.niveaux}`} libelle="Niveaux" suffixe={libelleNiveaux(c.niveaux)} valeur={c.niveaux} pas={1} min={1} max={30} onValider={(v) => fiche.modifier(i, 'niveaux', v)} />
          <div className="mz-fiche3d__champ mz-fiche3d__champ--lecture">
            <span>Hauteur</span>
            <strong>{fr(c.hauteurStudioM, 2)} m</strong>
            {fiche.brief?.attique && <small>{fr(c.hauteurStudioAttiqueM, 2)} m avec l’attique</small>}
          </div>
        </div>}
      </div>)}
    </div>

    <dl className="mz-fiche3d__chiffres" aria-label="Chiffres recalculés par le moteur">
      <div><dt>Surface de plancher</dt><dd>≈ {fr(ev.sdpM2)} m²</dd></div>
      <div><dt>Logements</dt><dd>{ev.logementsPlaces}{ev.logementsVises !== null ? ` / ${ev.logementsVises} visés` : ''}</dd></div>
      <div><dt>Emprise au sol</dt><dd>{`${fr(ev.empriseM2)}\u00a0m² · ${fr(ev.empriseRatio * 100, 1)}\u00a0%`}</dd></div>
    </dl>
    <p className="mz-fiche3d__source">Hauteurs aux cotes du Studio (rez 3,30 m, étages 2,80 m, dalles 0,22 m). SDP ≈ emprise × niveaux, 70 m² par logement : hypothèses du moteur, en lecture seule.</p>

    {ev.alertes.length > 0 && <ul className="mz-fiche3d__alertes" role="status">{ev.alertes.slice(0, 5).map((a) => <li key={a}>{a}</li>)}</ul>}

    <details className="mz-fiche3d__verifs" open={ev.modifie}>
      <summary>Vérifications PLU du moteur ({ev.controles.length + (ev.hauteurStudio ? 1 : 0)})</summary>
      <ul>
        {ev.controles.map((c) => <li key={c.cle} className={VERDICT_CLASSE[c.verdict]}>
          <strong>{c.libelle}</strong> — <span className="mz-fiche3d__verdict">{LIBELLES_VERDICT[c.verdict]}</span>{c.explication ? ` : ${c.explication}` : ''}
        </li>)}
        {ev.hauteurStudio && <li className={VERDICT_CLASSE[ev.hauteurStudio.verdict]}>
          <strong>Hauteur dessinée</strong> — <span className="mz-fiche3d__verdict">{LIBELLES_VERDICT[ev.hauteurStudio.verdict]}</span> : {ev.hauteurStudio.texte}
        </li>}
      </ul>
      <p className="mz-fiche3d__source">Jamais « conforme » : une règle n’est « dans la limite » que si elle est confirmée et citée (article). Conformité à vérifier par un professionnel.</p>
    </details>

    {ev.modifie && <div className="mz-fiche3d__actions">
      <button type="button" onClick={fiche.revenir}><RotateCcw size={14} aria-hidden="true" /> Revenir au volume du moteur</button>
      {conversationId && onOpenStudio && <button type="button" className="is-primary" disabled={ouverture || bloque} onClick={() => void ouvrir()}>
        <Box size={14} aria-hidden="true" /> {ouverture ? 'Ouverture…' : 'Voir ces dimensions en 3D'} <ArrowUpRight size={14} aria-hidden="true" />
      </button>}
      {onSend && <button type="button" disabled={bloque || envoye} onClick={preparer}>
        <Sparkles size={14} aria-hidden="true" /> {envoye ? 'Demandé à Mimmo' : 'Préparer la 3D avec cette forme'}
      </button>}
    </div>}
    {ev.modifie && <p className="mz-fiche3d__note">Essai dans la fiche : un rendu part du volume préparé — « Préparer la 3D avec cette forme » le fait recalculer et enregistrer par Mimmo.</p>}
    {notice && <p role="alert">{notice}</p>}
  </div>;
}

// ── Style ────────────────────────────────────────────────────────────────────
function VignetteStyle({ style, choix }: { style: Style; choix: ChoixBrief }) {
  const d = dessinStyle(style);
  if (!d) return <VignetteTravee choix={choix} className="mz-fiche3d__vignette" />;
  return <svg className="mz-fiche3d__vignette" viewBox={`-0.6 -0.2 ${d.largeur + 1.2} ${d.hauteur}`} preserveAspectRatio="xMidYMax meet" aria-hidden="true">
    {d.rects.map((r, i) => <rect key={`r${i}`} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} fillOpacity={r.opacite ?? 1} stroke={r.trait ?? 'none'} strokeWidth={r.trait ? 0.04 : 0} />)}
    {d.polys.map((p, i) => <polygon key={`p${i}`} points={p.points.map((q) => q.join(',')).join(' ')} fill={p.fill} fillOpacity={p.opacite ?? 1} />)}
  </svg>;
}

const LIB_TYPE_RENDU = { film: 'du film', visite360: 'de la visite 360°', image: 'de l’image' } as const;

/**
 * Lot brief-unifié — état de la section habillage, tenu par CopilotChat (le panneau peut se remonter : changement de
 * conversation, fiche du moteur chargée après coup) : ouverte ou non, demande du chat (type du rendu attendu), jeton
 * (une valeur par ouverture demandée, pour faire défiler la section en vue).
 */
export interface EtatHabillage { ouverte: boolean; demande: DemandeBrief | null; jeton: number }

export function StyleFiche({ messages, apercu, limites, onSend, habillage, onHabillage }: {
  messages: readonly MessageFiche[]; apercu: ReturnType<typeof apercuDepuisEvaluation> | null; limites: LimitesBrief; onSend?: (texte: string) => void;
  /** Lot brief-unifié : état contrôlé par le chat (absent : état local, comme avant). */
  habillage?: EtatHabillage | null;
  onHabillage?: (ouverte: boolean) => void;
}) {
  const brief = useMemo(() => briefCourant(messages), [messages]);
  // Rendu en attente de l'habillage (Mimmo l'a demandé) : « Valider » enverra un bloc typé → devis.
  const enCours = useMemo(() => demandeEnCours(messages as never), [messages]);
  const [ouverteLocale, setOuverteLocale] = useState(false);
  const controle = !!habillage && !!onHabillage;
  const ouverte = controle ? habillage.ouverte : ouverteLocale;
  const ouvrir = (v: boolean) => (controle ? onHabillage(v) : setOuverteLocale(v));
  const section = useRef<HTMLDivElement | null>(null);
  const jeton = habillage?.jeton ?? 0;
  useEffect(() => {
    if (controle && ouverte && jeton > 0) section.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [controle, ouverte, jeton]);
  // « Modifier l'habillage » sous un devis : type de CE devis ; sinon la demande de Mimmo en attente ; sinon habillage du projet.
  const demandeChat = habillage?.demande?.origine === 'devis' ? habillage.demande : null;
  const demande = demandePanneau(demandeChat ?? enCours?.demande ?? null, brief, apercu, limites);
  const bandeau = demande.type
    ? (demande.origine === 'devis' ? `Modification de l’habillage ${LIB_TYPE_RENDU[demande.type]} : un nouveau devis sera établi.` : `Mimmo attend votre habillage pour établir le devis ${LIB_TYPE_RENDU[demande.type]}.`)
    : null;
  const choix: ChoixBrief = brief ?? CHOIX_DEFAUT;
  return <div className="mz-fiche3d mz-fiche3d--style" ref={section}>
    <div className="mz-fiche3d__styles" role="radiogroup" aria-label="Style architectural">
      {STYLES.map((s) => <button key={s.valeur} type="button" role="radio" aria-checked={s.valeur === 'contemporain'} disabled={!s.disponible}
        className={`mz-fiche3d__style${s.valeur === 'contemporain' ? ' is-actif' : ''}${s.disponible ? '' : ' is-bientot'}`} title={s.disponible ? s.detail : 'Bientôt disponible.'}>
        <VignetteStyle style={s.valeur} choix={choix} />
        <span className="mz-fiche3d__nom">{s.libelle}{!s.disponible && <em> · bientôt</em>}</span>
        <span className="mz-fiche3d__desc">{s.descriptif}</span>
      </button>)}
    </div>
    <p className="mz-fiche3d__source">Vignettes : façades types dessinées aux dimensions du Studio (illustrations, pas des rendus ; les styles « bientôt » ne sont pas encore rendus par le Studio).</p>
    <div className={`mz-fiche3d__habillage${enCours && !ouverte ? ' is-attente' : ''}`}>
      <Palette size={15} aria-hidden="true" />
      <p><strong>Habillage</strong> · {recapitulatif(choix, { limites })}{!brief ? ' (proposé par Mimmo)' : brief.defauts.length ? ' (en partie proposé par Mimmo)' : ''}
        {enCours && !ouverte && <><br /><em>Mimmo attend votre habillage pour le devis.</em></>}</p>
      {!ouverte && <button type="button" onClick={() => ouvrir(true)} disabled={!onSend}>{brief ? 'Modifier l’habillage' : 'Choisir l’habillage'}</button>}
    </div>
    {/* La clé remonte la carte à chaque nouvelle demande (autre type de rendu, brief connu différent). */}
    {ouverte && <CarteBriefCreatif key={`${demande.origine}-${demande.type ?? 'projet'}-${jeton}`} demande={demande} messageId={enCours?.messageId ?? ''} onSend={onSend}
      onEnvoye={() => ouvrir(false)} onFermer={() => ouvrir(false)} toujoursOuverte sansStyles bandeau={bandeau} />}
  </div>;
}
