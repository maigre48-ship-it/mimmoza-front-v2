// src/lib/studio/parcoursTerrain.ts
// =============================================================================
// VIS-20 (23/11/2026) — « Le parcours ne quitte jamais le chat » : étapes 1 (Terrain) et 2 (Programme & conception)
// se font DANS la page MimmozIA (champ de l'étape, carte cadastrale du panneau Espace 3D, message à Mimmo).
//
// Code PUR (node --test) : lecture de la saisie « adresse ou parcelle(s) », sélection multiple sur la carte → assiette,
// messages envoyés à Mimmo, programme pré-rempli depuis la demande. Aucun accès au navigateur ni au réseau.
// =============================================================================

/** Saisie de l'étape 1 lue : parcelles reconnues (IDU 14 caractères ou « section + numéro »), sinon une adresse. */
export interface SaisieTerrain { parcelles: string[]; adresse: string | null }

const RE_IDU = /\b(\d{2}[0-9AB]\d{2})(\d{3})([0-9A-Z]{2})(\d{1,4})\b/gi;
const RE_COURTE = /(?<![\p{L}\d])(0?[A-Z]{1,2})\s*(?:n[°o]\s*)?(\d{1,4})(?![\p{L}\d])/gu;
const RE_SUITE = /^\s*(?:,|\+|&|et|\/)\s*(?:n[°o]\s*)?(\d{1,4})(?![\p{L}\d])/iu;

const pad4 = (n: string) => n.padStart(4, '0');
const section2 = (s: string) => (s.length === 1 ? `0${s}` : s).toUpperCase();

/** Numéros qui suivent une parcelle (« AI0001 et 2, 3 ») : même section, même commune. */
function suites(texte: string, depuis: number): { numeros: string[]; fin: number } {
  const numeros: string[] = [];
  let pos = depuis;
  for (;;) {
    const m = RE_SUITE.exec(texte.slice(pos));
    if (!m) break;
    numeros.push(pad4(m[1]));
    pos += m[0].length;
  }
  return { numeros, fin: pos };
}

/**
 * « 64065000AI0001 et 2 » → 64065000AI0001, 64065000AI0002 ; « AI0001 + AI0002 » → AI0001, AI0002 ;
 * « 12 rue du Port, Ascain » → adresse. Doublons retirés, ordre de saisie gardé (la première = parcelle principale).
 */
export function lireSaisieTerrain(saisie: string | null | undefined): SaisieTerrain {
  const texte = (saisie ?? '').replace(/\s+/g, ' ').trim();
  const parcelles: string[] = [];
  const ajouter = (id: string) => { if (!parcelles.includes(id)) parcelles.push(id); };
  let reste = texte;
  for (const m of texte.matchAll(RE_IDU)) {
    const base = `${m[1]}${m[2]}${m[3].toUpperCase()}`;
    ajouter(`${base}${pad4(m[4])}`);
    for (const n of suites(texte, (m.index ?? 0) + m[0].length).numeros) ajouter(`${base}${n}`);
    reste = reste.replace(m[0], ' ');
  }
  if (!parcelles.length) {
    for (const m of reste.matchAll(RE_COURTE)) {
      const sec = section2(m[1]);
      // « AI » doit être en capitales : un mot courant (« le 12 ») n'est jamais une section.
      if (m[1] !== m[1].toUpperCase()) continue;
      ajouter(`${sec}${pad4(m[2])}`);
      for (const n of suites(reste, (m.index ?? 0) + m[0].length).numeros) ajouter(`${sec}${n}`);
    }
    // Une adresse (« 12 rue de la Paix ») n'a pas de section en capitales collée à un numéro : rien de reconnu → adresse.
  }
  return { parcelles, adresse: parcelles.length ? null : (texte.length >= 3 ? texte : null) };
}

const liste = (l: readonly string[]) => (l.length <= 1 ? (l[0] ?? '') : `${l.slice(0, -1).join(', ')} et ${l[l.length - 1]}`);
const SUITE_ETAPE_2 = 'puis enchaîne ici, dans le chat, sur l’étape 2 — Programme & conception.';

/** Message envoyé à Mimmo par le champ de l'étape 1 ; null : saisie vide. */
export function messageTerrainParcours(saisie: string | null | undefined): string | null {
  const s = lireSaisieTerrain(saisie);
  if (s.parcelles.length > 1) return `Mon terrain : parcelles ${liste(s.parcelles)} (assiette de ${String(s.parcelles.length)} parcelles). Retrouve-les, fais-moi confirmer ce terrain, ${SUITE_ETAPE_2}`;
  if (s.parcelles.length === 1) return `Mon terrain : parcelle ${s.parcelles[0]}. Retrouve-la, fais-moi confirmer ce terrain, ${SUITE_ETAPE_2}`;
  if (s.adresse) return `Mon terrain se trouve à cette adresse : ${s.adresse}. Trouve la ou les parcelles concernées, fais-moi confirmer ce terrain, ${SUITE_ETAPE_2}`;
  return null;
}

/** Parcelle cochée sur la carte cadastrale du panneau. */
export interface ParcelleCarte { id: string; surface_m2: number | null }

/** Clic sur une parcelle de la carte : ajoutée si absente, retirée sinon (sélection multiple = assiette). */
export function basculerParcelleAssiette(selection: readonly ParcelleCarte[], p: ParcelleCarte): ParcelleCarte[] {
  const id = p.id.trim().toUpperCase();
  if (!id) return [...selection];
  return selection.some((x) => x.id === id) ? selection.filter((x) => x.id !== id)
    : [...selection, { id, surface_m2: typeof p.surface_m2 === 'number' && Number.isFinite(p.surface_m2) && p.surface_m2 > 0 ? Math.round(p.surface_m2) : null }];
}

/** Assiette de la sélection : identifiants, surface cadastrale totale (null si une surface manque), libellé court. */
export function resumeAssiette(selection: readonly ParcelleCarte[]): { ids: string[]; surface_m2: number | null; libelle: string } {
  const ids = selection.map((p) => p.id);
  const surfaces = selection.map((p) => p.surface_m2);
  const surface = surfaces.length && surfaces.every((v): v is number => typeof v === 'number') ? surfaces.reduce((a, b) => a + b, 0) : null;
  const court = ids.map((id) => (id.length === 14 ? id.slice(8) : id));
  const libelle = ids.length === 0 ? 'Aucune parcelle choisie'
    : `${court.join(' + ')}${surface !== null ? ` · ${surface.toLocaleString('fr-FR')} m²` : ''}${ids.length > 1 ? ` (assiette de ${String(ids.length)} parcelles)` : ''}`;
  return { ids, surface_m2: surface, libelle };
}

/** Message de confirmation d'une sélection faite sur la carte (une parcelle ou une assiette) ; null : rien de choisi. */
export function messageAssietteCarte(selection: readonly ParcelleCarte[]): string | null {
  if (!selection.length) return null;
  const r = resumeAssiette(selection);
  const detail = selection.map((p) => `${p.id}${p.surface_m2 !== null ? ` (${p.surface_m2.toLocaleString('fr-FR')} m²)` : ''}`);
  const tete = selection.length > 1
    ? `Je confirme mon terrain, choisi sur la carte : assiette de ${String(selection.length)} parcelles — ${liste(detail)}${r.surface_m2 !== null ? `, ${r.surface_m2.toLocaleString('fr-FR')} m² cadastraux au total` : ''}.`
    : `Je confirme mon terrain, choisi sur la carte : parcelle ${detail[0]}.`;
  return `${tete} Retiens ce terrain pour le projet, ${SUITE_ETAPE_2}`;
}

/**
 * Où centrer la carte : un IDU complet (commune, section, numéro → parcelle IGN), sinon une adresse à chercher.
 * null : rien d'exploitable (une parcelle « AI0001 » sans commune ne localise rien).
 */
export function requeteCarte(saisie: string | null | undefined): { genre: 'idu'; insee: string; section: string; numero: string } | { genre: 'adresse'; q: string } | null {
  const s = lireSaisieTerrain(saisie);
  const idu = s.parcelles.find((p) => p.length === 14);
  if (idu) return { genre: 'idu', insee: idu.slice(0, 5), section: idu.slice(8, 10), numero: idu.slice(10) };
  if (s.parcelles.length) return null;
  return s.adresse ? { genre: 'adresse', q: s.adresse } : null;
}

// ── Étape 2 — programme ──────────────────────────────────────────────────────

export interface ProgrammeParcours { logements: number | null; niveaux: number | null; typologies: string[] }

const TYPOS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];

/** Programme lu dans la demande (messages de l'utilisateur, le plus récent l'emporte) : pré-remplissage, jamais imposé. */
export function programmeDeLaDemande(textes: readonly string[]): ProgrammeParcours {
  const p: ProgrammeParcours = { logements: null, niveaux: null, typologies: [] };
  for (const brut of textes) {
    const t = (brut ?? '').replace(/```[\s\S]*?```/g, ' ');
    const lg = [...t.matchAll(/(\d{1,4})\s*(?:logements?|lgts?|appartements?)\b/giu)].pop();
    if (lg) p.logements = Number(lg[1]);
    const r = [...t.matchAll(/\bR\s*\+\s*(\d{1,2})\b/gi)].pop();
    const niv = [...t.matchAll(/(\d{1,2})\s*niveaux?\b/giu)].pop();
    const et = [...t.matchAll(/(\d{1,2})\s*[ée]tages?\b/giu)].pop();
    if (r) p.niveaux = Number(r[1]) + 1;
    else if (niv) p.niveaux = Number(niv[1]);
    else if (et) p.niveaux = Number(et[1]) + 1;
    const ty = [...new Set([...t.matchAll(/\bT\s*([1-6])\b/gi)].map((m) => `T${m[1]}`))];
    if (ty.length) p.typologies = TYPOS.filter((x) => ty.includes(x));
  }
  return p;
}

/** « T2, T3 » / « T1/T3 » saisi dans le champ → liste ordonnée. */
export function lireTypologies(saisie: string): string[] {
  const ty = [...(saisie ?? '').matchAll(/T\s*([1-6])/gi)].map((m) => `T${m[1]}`);
  return TYPOS.filter((x) => ty.includes(x));
}

/** Message envoyé à Mimmo par l'étape 2 : la mission de conception proposée ICI, avec le programme saisi. */
export function messageProgrammeParcours(p: ProgrammeParcours): string {
  const bits: string[] = [];
  if (p.logements && p.logements > 0) bits.push(`${String(p.logements)} logement${p.logements > 1 ? 's' : ''}`);
  if (p.niveaux && p.niveaux > 0) bits.push(p.niveaux === 1 ? 'plain-pied (R+0)' : `R+${String(p.niveaux - 1)} (${String(p.niveaux)} niveaux)`);
  if (p.typologies.length) bits.push(`typologie${p.typologies.length > 1 ? 's' : ''} ${liste(p.typologies)}`);
  const programme = bits.length ? `avec ce programme : ${bits.join(', ')}` : 'avec le programme que tu connais (demande-moi en une question ce qui manque)';
  return `Étape 2 — Programme & conception : propose-moi ici, dans le chat, la mission de conception sur mon terrain ${programme}.`;
}
