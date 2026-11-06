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
// Composants minces : toute la logique est dans ficheDimensions.ts et briefCreatif.ts.
// =============================================================================
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { ArrowUpRight, Box, Palette, RotateCcw } from 'lucide-react';
import { messageErreur } from '@/components/ui/messageErreur';
import type { JarvisDraft } from './jarvisDraft';
import type { ConfirmedTerrain } from './terrainCadastre';
import type { IssueOuvertureStudio } from './JarvisDraftPanel';
import { LIBELLES_VERDICT, ouverturePreparation, type MessageOutils } from './preparationStudio';
import type { EtatFiche3D } from './useFiche3D';
import {
  FORMES, apercuDepuisEvaluation, ecartsProgramme, programmeMoteur, raisonFormeIndisponible, schemaForme, type EvaluationFiche, type Forme,
} from './ficheDimensions';
import { CHOIX_DEFAUT, STYLES, briefCourant, demandeFiche, dessinStyle, recapitulatif, type ChoixBrief, type LimitesBrief, type Style } from './briefCreatif';
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
    {forme === 'l' && <path d="M5 4h8v14h22v7H5z" />}
    {forme === 'u' && <path d="M4 4h8v14h16V4h8v21H4z" />}
    {forme === 'cour' && <path fillRule="evenodd" d="M5 3h30v22H5zM13 9v10h14V9z" />}
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
      <polygon points={c.points} className="mz-fiche3d__corps" strokeWidth={t / 7} />
      <text x={c.ex} y={c.ey} fontSize={t * 1.1} textAnchor="middle" dominantBaseline="central" className="mz-fiche3d__lettre">{c.etiquette}</text>
      {c.cotes.map((k, i) => <g key={i} className="mz-fiche3d__cote">
        <line x1={k.x1} y1={k.y1} x2={k.x2} y2={k.y2} strokeWidth={t / 10} />
        <text x={k.tx} y={k.ty} fontSize={t * 0.82} textAnchor="middle" dominantBaseline="central">{k.texte}</text>
      </g>)}
    </g>)}
  </svg>;
}

const VERDICT_CLASSE = { dans_la_limite: 'is-ok', au_dela: 'is-ko', a_verifier: 'is-av', non_controle: 'is-nc' } as const;

export function DimensionsFiche({ fiche, conversationId, onOpenStudio, texteModele }: {
  fiche: Extract<EtatFiche3D, { etat: 'ok' }>; conversationId: string | null; onOpenStudio?: OuvrirStudio;
  /** Texte « Dimensions » écrit par le modèle : remplacé par le moteur, l'écart est signalé. */
  texteModele: string | null;
}) {
  const { ev, saisie } = fiche;
  const ecartTexte = texteModele && ecartsProgramme(texteModele, ev).length > 0;
  const [ouverture, setOuverture] = useState(false);
  const [notice, setNotice] = useState('');
  const idForme = useId();
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
    </fieldset>

    <Schema ev={ev} />
    {ecartTexte && <p className="mz-fiche3d__ecart" role="note">Mimmo avait écrit « {texteModele} » : remplacé par les dimensions calculées par le moteur.</p>}

    <div className="mz-fiche3d__batiments">
      {ev.corps.map((c, i) => <div key={c.id} className="mz-fiche3d__batiment">
        <p className="mz-fiche3d__titre-bat"><span aria-hidden="true">{String.fromCharCode(65 + i)}</span>{c.nom}</p>
        <div className="mz-fiche3d__grille">
          <ChampNombre key={`l${c.longueurM}`} libelle="Longueur" suffixe="m" valeur={c.longueurM} min={6} max={120} onValider={(v) => fiche.modifier(i, 'longueurM', v)} />
          <ChampNombre key={`p${c.largeurM}`} libelle="Largeur" suffixe="m" valeur={c.largeurM} min={6} max={40} onValider={(v) => fiche.modifier(i, 'largeurM', v)} />
          <ChampNombre key={`n${c.niveaux}`} libelle="Niveaux" suffixe={libelleNiveaux(c.niveaux)} valeur={c.niveaux} pas={1} min={1} max={30} onValider={(v) => fiche.modifier(i, 'niveaux', v)} />
          <div className="mz-fiche3d__champ mz-fiche3d__champ--lecture">
            <span>Hauteur</span>
            <strong>{fr(c.hauteurStudioM, 2)} m</strong>
            {fiche.brief?.attique && <small>{fr(c.hauteurStudioAttiqueM, 2)} m avec l’attique</small>}
          </div>
        </div>
      </div>)}
    </div>

    <dl className="mz-fiche3d__chiffres" aria-label="Chiffres recalculés par le moteur">
      <div><dt>Surface de plancher</dt><dd>≈ {fr(ev.sdpM2)} m²</dd></div>
      <div><dt>Logements</dt><dd>{ev.logementsPlaces}{ev.logementsVises !== null ? ` / ${ev.logementsVises} visés` : ''}</dd></div>
      <div><dt>Emprise au sol</dt><dd>{fr(ev.empriseM2)} m² · {fr(ev.empriseRatio * 100, 1)} %</dd></div>
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
      {conversationId && onOpenStudio && <button type="button" className="is-primary" disabled={ouverture || ev.alertes.some((a) => /déborde|chevauchent/.test(a))} onClick={() => void ouvrir()}>
        <Box size={14} aria-hidden="true" /> {ouverture ? 'Ouverture…' : 'Voir ces dimensions en 3D'} <ArrowUpRight size={14} aria-hidden="true" />
      </button>}
    </div>}
    {ev.modifie && <p className="mz-fiche3d__note">Essai dans la fiche : un rendu demandé à Mimmo part encore du volume préparé.</p>}
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

export function StyleFiche({ messages, apercu, limites, onSend }: {
  messages: readonly MessageFiche[]; apercu: ReturnType<typeof apercuDepuisEvaluation> | null; limites: LimitesBrief; onSend?: (texte: string) => void;
}) {
  const brief = useMemo(() => briefCourant(messages), [messages]);
  const [ouverte, setOuverte] = useState(false);
  const choix: ChoixBrief = brief ?? CHOIX_DEFAUT;
  return <div className="mz-fiche3d mz-fiche3d--style">
    <div className="mz-fiche3d__styles" role="radiogroup" aria-label="Style architectural">
      {STYLES.map((s) => <button key={s.valeur} type="button" role="radio" aria-checked={s.valeur === 'contemporain'} disabled={!s.disponible}
        className={`mz-fiche3d__style${s.valeur === 'contemporain' ? ' is-actif' : ''}${s.disponible ? '' : ' is-bientot'}`} title={s.disponible ? s.detail : 'Bientôt disponible.'}>
        <VignetteStyle style={s.valeur} choix={choix} />
        <span className="mz-fiche3d__nom">{s.libelle}{!s.disponible && <em> · bientôt</em>}</span>
        <span className="mz-fiche3d__desc">{s.descriptif}</span>
      </button>)}
    </div>
    <p className="mz-fiche3d__source">Vignettes : façades types dessinées aux dimensions du Studio (illustrations, pas des rendus ; les styles « bientôt » ne sont pas encore rendus par le Studio).</p>
    <div className="mz-fiche3d__habillage">
      <Palette size={15} aria-hidden="true" />
      <p><strong>Habillage</strong> · {recapitulatif(choix, { limites })}{!brief ? ' (proposé par Mimmo)' : brief.defauts.length ? ' (en partie proposé par Mimmo)' : ''}</p>
      {!ouverte && <button type="button" onClick={() => setOuverte(true)} disabled={!onSend}>{brief ? 'Modifier l’habillage' : 'Choisir l’habillage'}</button>}
    </div>
    {ouverte && <CarteBriefCreatif demande={demandeFiche(brief, apercu, limites)} messageId="" onSend={onSend} onEnvoye={() => setOuverte(false)} onFermer={() => setOuverte(false)} />}
  </div>;
}
