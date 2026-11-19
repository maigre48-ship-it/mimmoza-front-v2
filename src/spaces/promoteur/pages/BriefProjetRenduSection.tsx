// src/spaces/promoteur/pages/BriefProjetRenduSection.tsx
// =============================================================================
// VIS-04 (18/11/2026) — « Brief relié au rendu » (Style & tendances).
//
// Montre le BRIEF PROJET de l'étude tel qu'il partira au rendu (direction retenue, palette, matériaux, programme,
// habillage choisi dans le chat) et laisse régler ce qui n'a pas d'autre source : gamme, vues (catalogue commun,
// pack plaquette pré-coché, vues à venir grisées « bientôt »), lumière, saison, précisions libres.
// Persistance : briefProjet.store (userStorage par compte et par étude). Aucune refonte : mêmes classes que la page.
// =============================================================================
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { catalogueVues, LIBELLES_GROUPE_VUE, MAX_VUES_PAR_IMAGE, VUES_DISPONIBLES, vueCochable, vuesPreCochees, type GroupeVue, type VueCatalogue } from '@/lib/studio/catalogueVues';
import { LIBELLES_AMBIANCE_RENDU, LIBELLES_GAMME, LIBELLES_SAISON, PRECISIONS_PROJET_MAX, resumeBriefProjet, type BriefProjet, type ReglagesRendu } from '@/lib/studio/briefProjet';
import { AMBIANCES_V2, GAMMES_V2, SAISONS_V2, type AmbianceV2, type GammeV2, type SaisonV2 } from '@/spaces/promoteur/shared/echangeStudio/mimmozaProjetV2';
import { BRIEF_PROJET_EVENT, briefProjetDeLEtude } from '@/spaces/promoteur/shared/briefProjet.store';

const inputClass = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900';
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : 'non renseigné');

export function BriefProjetRenduSection({ studyId, source }: { studyId: string | null; /** Change quand Style & tendances change. */ source: string }) {
  const [brief, setBrief] = useState<BriefProjet>(() => briefProjetDeLEtude(studyId));
  useEffect(() => { setBrief(briefProjetDeLEtude(studyId)); }, [studyId, source]);
  useEffect(() => {
    const maj = () => setBrief(briefProjetDeLEtude(studyId));
    window.addEventListener(BRIEF_PROJET_EVENT, maj);
    return () => window.removeEventListener(BRIEF_PROJET_EVENT, maj);
  }, [studyId]);
  const regler = (r: ReglagesRendu) => setBrief(briefProjetDeLEtude(studyId, { reglages: r }));
  const vues: VueCatalogue[] = brief.rendu.vues.length ? brief.rendu.vues : vuesPreCochees();
  const basculer = (v: VueCatalogue) => {
    const avec = vues.includes(v);
    if (avec && vues.length === 1) return;
    if (!avec && vues.length >= MAX_VUES_PAR_IMAGE) return;
    regler({ vues: VUES_DISPONIBLES.filter((x) => (x === v ? !avec : vues.includes(x))) });
  };
  const resume = resumeBriefProjet(brief);

  return <section className="rounded-3xl border border-indigo-200 bg-white p-5 sm:p-7" aria-label="Brief relié au rendu">
    <p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Brief relié au rendu · révision {brief.revision}</p>
    <h2 className="mt-1 text-xl font-semibold">Ce que le Studio recevra pour les images et le film</h2>
    <p className="mt-2 text-sm text-slate-600">Un seul brief par étude, repris automatiquement par le chat et par « Film, visite, image ». Le Studio applique ce qu’il sait dessiner (matières de son catalogue, couleurs de façade et de menuiseries, lumière, saison) et liste dans le résultat ce qu’il n’applique pas.</p>
    <ul className="mt-3 space-y-1 text-sm text-slate-700">
      <li><strong>Direction :</strong> {brief.directionStyle?.titre ?? 'aucune direction retenue (choisissez-en une ci-dessus)'} · Style & tendances du {date(brief.sources.style)}</li>
      <li><strong>Palette :</strong> {brief.palette.length ? brief.palette.map((c) => <span key={c.hex + c.nom} className="mr-2 inline-flex items-center gap-1"><span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm border border-slate-300" style={{ background: c.hex }} />{c.nom}</span>) : 'aucune'}</li>
      <li><strong>Matériaux :</strong> {brief.materiaux.length ? brief.materiaux.map((m) => m.libelle).join(' · ') : 'aucun'}{brief.sources.habillage ? ` · habillage du chat du ${date(brief.sources.habillage)}` : ''}</li>
      <li><strong>Programme :</strong> {brief.programme.typologies.length ? brief.programme.typologies.map((t) => `${t.type} × ${String(t.nombre)}${t.shabM2 ? ` (${String(t.shabM2)} m²)` : ''}`).join(' · ') : 'non renseigné dans Programmation'}{brief.programme.mix?.niveaux ? ` · ${String(brief.programme.mix.niveaux)} niveaux visés` : ''}</li>
      {resume && <li className="text-xs text-slate-500">{resume}</li>}
    </ul>
    <div className="mt-4 grid gap-3 md:grid-cols-3">
      <label className="text-sm font-medium">Gamme<select value={brief.gamme ?? ''} onChange={(e) => regler({ gamme: (e.target.value || null) as GammeV2 | null })} className={inputClass}>
        <option value="">Non précisée</option>{GAMMES_V2.map((g) => <option key={g} value={g}>{LIBELLES_GAMME[g]}</option>)}</select></label>
      <label className="text-sm font-medium">Lumière<select value={brief.rendu.ambiance ?? ''} onChange={(e) => regler({ ambiance: (e.target.value || null) as AmbianceV2 | null })} className={inputClass}>
        <option value="">Celle du devis</option>{AMBIANCES_V2.map((a) => <option key={a} value={a}>{LIBELLES_AMBIANCE_RENDU[a]}</option>)}</select></label>
      <label className="text-sm font-medium">Saison<select value={brief.rendu.saison ?? ''} onChange={(e) => regler({ saison: (e.target.value || null) as SaisonV2 | null })} className={inputClass}>
        <option value="">Non précisée</option>{SAISONS_V2.map((s) => <option key={s} value={s}>{LIBELLES_SAISON[s]}</option>)}</select></label>
    </div>
    {(['exterieur', 'privatif', 'interieur'] as GroupeVue[]).map((groupe) => <fieldset key={groupe} className="mt-4">
      <legend className="text-sm font-medium">{groupe === 'exterieur' ? `Vues souhaitées · ${LIBELLES_GROUPE_VUE[groupe]} (1 à ${String(MAX_VUES_PAR_IMAGE)}, pack plaquette par défaut)` : LIBELLES_GROUPE_VUE[groupe]}</legend>
      <div className="mt-2 flex flex-wrap gap-2">{catalogueVues().filter((c) => c.groupe === groupe).map((c) => vueCochable(c)
        ? <button key={c.id} type="button" aria-pressed={vues.includes(c.id)} onClick={() => basculer(c.id)}
          title={c.condition ? `Produite ${c.condition} ; sinon refusée avec sa raison.` : undefined}
          className={`inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-sm font-semibold ${vues.includes(c.id) ? 'bg-indigo-700 text-white' : 'border border-indigo-300 text-indigo-700'}`}>
          {vues.includes(c.id) && <Check size={14} />}{c.libelle}{c.statut === 'sous_condition' && <span className="text-xs font-normal opacity-75"> · selon le projet</span>}</button>
        : <button key={c.id} type="button" disabled aria-disabled="true" title="Vue prévue, pas encore produite par la machine de rendu"
          className="cursor-not-allowed rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-400">{c.libelle} · bientôt</button>)}</div>
    </fieldset>)}
    <label className="mt-4 block text-sm font-medium">Précisions pour le rendu<textarea rows={2} className={inputClass} maxLength={PRECISIONS_PROJET_MAX}
      value={brief.precisions ?? ''} onChange={(e) => regler({ precisions: e.target.value })}
      placeholder="Ex. menuiseries bronze, garde-corps en verre, lumière de fin de journée, automne" /></label>
    <p className="mt-2 text-xs text-slate-500">Compris : couleurs de façade et de menuiseries, matières courantes (brique, pierre, béton, enduit, bois, verre), garde-corps, soubassement, lumière, saison. Le reste est indiqué « non appliqué » dans le résultat, jamais ignoré.</p>
  </section>;
}
