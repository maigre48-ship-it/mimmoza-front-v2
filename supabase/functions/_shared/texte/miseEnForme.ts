// supabase/functions/_shared/texte/miseEnForme.ts
// =============================================================================
// LOT F1 — Lisibilité : mise en forme DÉTERMINISTE des énumérations « en ligne ».
// -----------------------------------------------------------------------------
// Le modèle n'obéit pas toujours aux consignes de format : il écrit encore des
// objectifs, des plans ou des questions d'un seul bloc :
//   « La mission doit : (1) vérifier … ; (2) appliquer … ; … (12) vérifier … »
//   « Plan : 1. **Récupérer …** 2. **Lire …** 3. … »
//   « Articles repérés : ARTICLE UC 1 – … (p. 102) ; ARTICLE UC 2 – … ; … »
// `mettreEnForme` est le filet de sécurité : elle remet un élément par ligne, en
// Markdown (« 1. … » pour une énumération numérotée, « - … » pour une liste
// « A ; B ; C »), SANS toucher au contenu.
//
// Garanties :
//   · mots identiques : seuls les séparateurs de fin d'élément (« ; », « , ») et
//     les liaisons « et » / « ou » en bordure d'élément sont retirés ; les numéros
//     d'origine sont conservés (« (3) » devient « 3. ») ;
//   · rien n'est cassé : nombres décimaux, dates (09/12/2025), articles
//     (« UC 10-1 », « art. UC 9 »), pages (« p. 109 »), montants
//     (« 3 821 404 € »), heures, URL, code (blocs ``` et `code` en ligne),
//     tableaux, titres, citations et listes déjà formées ne sont pas modifiés ;
//   · idempotente : mettreEnForme(mettreEnForme(x)) === mettreEnForme(x) ;
//   · fonction PURE, sans dépendance (Deno ET navigateur : le front l'importe
//     telle quelle, voir src/spaces/copilot/utils/lisibilite.ts).
// =============================================================================

type Style = 'parenthese' | 'fermante' | 'point';

interface Marqueur { debut: number; fin: number; n: number; style: Style }

const FORTS = /[:;.!?)*»"”…]/;
const MOTS_BLOQUANTS = new Set([
  'article', 'articles', 'art', 'n°', 'no', 'numéro', 'numero', 'p', 'pp', 'page', 'pages', 'zone', 'secteur',
  'niveau', 'niveaux', 'lot', 'lots', 'phase', 'étape', 'etape', 'chapitre', 'titre', 'section', 'annexe', 'tome',
  'alinéa', 'alinea', 'al', 'pièce', 'piece', 'bâtiment', 'batiment', 'bât', 'bat', 'groupe', 'type', 'catégorie',
  'categorie', 'classe', 'cas', 'point', 'version', 'tranche', 'option', 'scénario', 'scenario', 'variante',
  'îlot', 'ilot', 'parcelle', 'plan', 'figure', 'fig', 'tableau', 'r+',
]);
const ABREVIATIONS = new Set([
  'p', 'pp', 'art', 'cf', 'n°', 'no', 'm', 'mm', 'mme', 'mlle', 'dr', 'st', 'ste', 'ex', 'env', 'réf', 'ref',
  'vol', 'al', 'chap', 'fig', 'éd', 'ed', 'av', 'bd', 'max', 'min', 'hab', 'approx', 'resp',
]);
const MAJUSCULE = /^(?:\*\*)?[A-ZÀ-ÖØ-Þ«"“]/;

/** Profondeur de parenthèses / crochets juste avant `pos`. */
function profondeur(s: string, pos: number): number {
  let d = 0;
  for (let i = 0; i < pos; i++) {
    const c = s[i];
    if (c === '(' || c === '[') d++;
    else if ((c === ')' || c === ']') && d > 0) d--;
  }
  return d;
}

/** Dernier caractère non blanc avant `pos` ('' en début de ligne). */
function precedent(s: string, pos: number): string {
  for (let i = pos - 1; i >= 0; i--) if (!/\s/.test(s[i])) return s[i];
  return '';
}

/** Dernier mot avant `pos`, sans ponctuation de bordure, en minuscules. */
function motPrecedent(s: string, pos: number): { brut: string; bas: string } {
  const m = /(\S+)\s*$/.exec(s.slice(0, pos));
  const brut = (m?.[1] ?? '').replace(/^[(«"“[]+|[,;:)»"”\]]+$/g, '');
  return { brut, bas: brut.toLowerCase().replace(/\.$/, '') };
}

function marqueurs(s: string): Marqueur[] {
  const res: Marqueur[] = [];
  const motifs: [Style, RegExp][] = [
    ['parenthese', /(?<=^|\s)\((\d{1,2})\)(?=\s+\S)/g],
    ['fermante', /(?<=^|\s)(\d{1,2})\)(?=\s+\S)/g],
    ['point', /(?<=^|\s)(\d{1,2})\.(?=\s+\S)/g],
  ];
  for (const [style, re] of motifs) {
    for (const m of s.matchAll(re)) {
      const debut = m.index ?? 0;
      if (profondeur(s, debut) > 0) continue;          // « (p. 12) », « (voir 2) » : pas un marqueur
      let fin = debut + m[0].length;
      while (fin < s.length && /\s/.test(s[fin])) fin++;
      res.push({ debut, fin, n: Number(m[1]), style });
    }
  }
  return res.sort((a, b) => a.debut - b.debut);
}

function chaineValide(s: string, ch: Marqueur[]): boolean {
  if (ch.length < 2) return false;
  // Aucun élément vide (« 1. 2. 3. » n'est pas une liste).
  for (let k = 0; k < ch.length - 1; k++) if (!s.slice(ch[k].fin, ch[k + 1].debut).trim()) return false;
  if (ch[0].style !== 'point') return true;
  // Style « 1. » : le plus ambigu (« article 1. », « niveau 2. »). Le premier
  // marqueur suit un début de ligne ou une ponctuation forte (« Plan : 1. »).
  const p0 = precedent(s, ch[0].debut);
  if (p0 !== '' && !FORTS.test(p0)) return false;
  let faibles = 0;
  for (let k = 1; k < ch.length; k++) {
    const p = precedent(s, ch[k].debut);
    if (FORTS.test(p)) continue;
    faibles++;
    if (s.startsWith('**', ch[k].fin)) continue;                 // « … 2. **Lire …** » : item en gras
    const { brut, bas } = motPrecedent(s, ch[k].debut);
    if (MOTS_BLOQUANTS.has(bas) || /^[A-Z]{1,4}\d*$/.test(brut) || /^\d/.test(brut)) return false;
  }
  return faibles === 0 || ch.length >= 3;
}

/** Première chaîne valide 1, 2, 3… (même style), la plus tôt dans la ligne. */
function meilleureChaine(s: string): Marqueur[] | null {
  const tous = marqueurs(s);
  let meilleure: Marqueur[] | null = null;
  for (const depart of tous) {
    if (depart.n !== 1) continue;
    if (meilleure && depart.debut >= meilleure[0].debut) break;
    const ch = [depart];
    for (const m of tous) {
      const dernier = ch[ch.length - 1];
      if (m.style === depart.style && m.debut >= dernier.fin && m.n === dernier.n + 1) ch.push(m);
    }
    if (chaineValide(s, ch)) meilleure = ch;
  }
  return meilleure;
}

/** Indice de fin de la première phrase de `t` (ponctuation incluse), ou -1. */
function finDePhrase(t: string): number {
  for (const m of t.matchAll(/([.!?…])(\s+)/g)) {
    const i = m.index ?? 0;
    const apres = t.slice(i + m[0].length);
    if (!MAJUSCULE.test(apres)) continue;
    if (profondeur(t, i) > 0) continue;
    if (m[1] === '.') {
      const { brut, bas } = motPrecedent(t, i);
      if (ABREVIATIONS.has(bas) || /^[A-Za-zÀ-ÿ]$/.test(brut)) continue;
    }
    return i + 1;
  }
  return -1;
}

/** Retire les séparateurs de bordure : « ; », « , » et les liaisons « et » / « ou ». */
function nettoyerElement(t: string, dernier: boolean): string {
  let x = t.trim();
  let avant = '';
  while (avant !== x) {
    avant = x;
    x = x.replace(/[\s;,]+$/, '').replace(/\s+(?:et|ou)$/i, '').trim();
    if (dernier) x = x.replace(/^(?:et|ou)\s+/i, '');
  }
  return x;
}

/** Sépare le dernier élément de la suite éventuelle (phrases après la liste). */
function couperDernier(t: string): [string, string] {
  const f = finDePhrase(t);
  if (f < 0) return [t, ''];
  return [t.slice(0, f), t.slice(f)];
}

function decouperEnumeration(s: string): string[] | null {
  const ch = meilleureChaine(s);
  if (!ch) return null;
  const intro = s.slice(0, ch[0].debut).trimEnd();
  const lignes: string[] = intro ? [intro] : [];
  let suite = '';
  for (let k = 0; k < ch.length; k++) {
    let brut = s.slice(ch[k].fin, k + 1 < ch.length ? ch[k + 1].debut : s.length);
    if (k === ch.length - 1) [brut, suite] = couperDernier(brut);
    const el = nettoyerElement(brut, k === ch.length - 1);
    if (!el) return null;
    lignes.push(`${ch[k].n}. ${el}`);
  }
  if (suite.trim()) lignes.push(...decouperLigne(suite.trim()));
  return lignes;
}

/** Liste « intro : A ; B ; C » (au moins 3 éléments, séparateurs hors parenthèses). */
function decouperPointVirgule(s: string): string[] | null {
  const seps: number[] = [];
  let d = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[') d++;
    else if ((c === ')' || c === ']') && d > 0) d--;
    else if (c === ';' && d === 0 && (i + 1 >= s.length || /\s/.test(s[i + 1]))) seps.push(i);
  }
  if (seps.length < 2) return null;
  // Deux-points d'introduction : le dernier avant le premier « ; », hors parenthèses,
  // suivi d'une espace (exclut « https:// » et « 10:30 »).
  let deuxPoints = -1;
  for (let i = seps[0] - 1; i >= 0; i--) {
    if (s[i] === ':' && /\s/.test(s[i + 1] ?? '') && profondeur(s, i) === 0) { deuxPoints = i; break; }
  }
  if (deuxPoints < 0) return null;
  const bornes = [deuxPoints, ...seps];
  const elements: string[] = [];
  for (let k = 0; k < bornes.length; k++) {
    elements.push(s.slice(bornes[k] + 1, k + 1 < bornes.length ? bornes[k + 1] : s.length));
  }
  const [dernier, suite] = couperDernier(elements[elements.length - 1]);
  elements[elements.length - 1] = dernier;
  const propres = elements.map((e, k) => nettoyerElement(e, k === elements.length - 1));
  if (propres.length < 3 || propres.some((e) => !e)) return null;
  if (propres.join(' ').length < 80) return null;                 // liste courte : on la laisse en ligne
  const lignes = [s.slice(0, deuxPoints + 1).trimEnd(), ...propres.map((e) => `- ${e}`)];
  if (suite.trim()) lignes.push(...decouperLigne(suite.trim()));
  return lignes;
}

function decouperLigne(s: string): string[] {
  return decouperEnumeration(s) ?? decouperPointVirgule(s) ?? [s];
}

const DEJA_STRUCTUREE = /^\s*(?:[|#>]|[-*•+]\s|\d{1,2}[.)]\s|\(\d{1,2}\)\s)/;
const COMMENCE_PAR_UN = /^\s*(?:1[.)]|\(1\))\s/;
const CLOTURE = /^\s*(?:```|~~~)/;

function unePasse(texte: string): string {
  const fin = texte.includes('\r\n') ? '\r\n' : '\n';
  const sortie: string[] = [];
  let dansCode = false;
  for (const ligne of texte.split(/\r?\n/)) {
    if (CLOTURE.test(ligne)) { dansCode = !dansCode; sortie.push(ligne); continue; }
    if (dansCode || !ligne.trim()) { sortie.push(ligne); continue; }
    // Lignes déjà structurées (liste, titre, tableau, citation) : intactes, sauf
    // une ligne qui commence par « 1. » et enchaîne « 2. », « 3. »… sur la même ligne.
    if (DEJA_STRUCTUREE.test(ligne) && !COMMENCE_PAR_UN.test(ligne)) { sortie.push(ligne); continue; }
    // Code en ligne protégé : rien n'est découpé à l'intérieur de `…`.
    const codes: string[] = [];
    const protegee = ligne.replace(/`[^`\n]+`/g, (c) => `${String.fromCharCode(0xE100 + codes.push(c) - 1)}`);
    const retrait = /^\s*/.exec(protegee)?.[0] ?? '';
    const lignes = decouperLigne(protegee.slice(retrait.length));
    if (lignes.length === 1) { sortie.push(ligne); continue; }
    const restaurer = (x: string) => x.replace(/(.)/g, (_, k: string) => codes[k.charCodeAt(0) - 0xE100]);
    lignes.forEach((l, i) => sortie.push(restaurer(i === 0 ? retrait + l : l)));
  }
  return sortie.join(fin);
}

/**
 * Met un élément par ligne dans les énumérations écrites en ligne, sans changer
 * les mots. Renvoie le texte inchangé s'il n'y a rien à faire.
 */
export function mettreEnForme(texte: string): string {
  if (typeof texte !== 'string' || !texte) return texte;
  let x = texte;
  // Point fixe (au plus 4 passes) : garantit l'idempotence même quand un
  // élément contient lui-même une énumération.
  for (let i = 0; i < 4; i++) {
    const y = unePasse(x);
    if (y === x) break;
    x = y;
  }
  return x;
}
