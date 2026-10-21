// La fiche est écrite dans la réponse du copilote et reste donc liée à
// l'historique de la conversation, sans stockage local supplémentaire.
import { levelFootprint } from './massingGeometry.ts';
export interface JarvisDraft {
  version: 1;
  objectif: string | null;
  localisation: string | null;
  programme: string | null;
  dimensions: string | null;
  style: string | null;
  contraintes: string | null;
  questions: string[];
  pieces: string[];
}

export interface JarvisMassing {
  largeurM: number;
  profondeurM: number;
  niveaux: number;
  logements: number | null;
  appearance: JarvisAppearance;
  buildings?: JarvisBuildingMassing[];
  separationM?: number;
  segments?: JarvisSegment[];
  facadeRules?: JarvisFacadeRule[];
}

export interface JarvisSegment {
  name: string;
  largeurM: number;
  profondeurM: number;
  niveaux: number;
  retraitM: number;
  x: number;
  z: number;
  fromLevelIndex?: number;
}

export interface JarvisFacadeRule {
  side: 'sud' | 'nord' | 'est' | 'ouest';
  action: 'retrait' | 'avancee';
  position: 'gauche' | 'centre' | 'droite';
  widthM: number | null;
  depthM: number;
  fromLevel: number;
  toLevel: number | null;
  sideAssumed: boolean;
  widthAssumed: boolean;
}

export interface JarvisBuildingMassing {
  name: string;
  largeurM: number;
  profondeurM: number;
  niveaux: number;
  appearance: JarvisAppearance;
  segments?: JarvisSegment[];
}

export interface JarvisStudioBuilding {
  name: string;
  commande: string;
  centreZ: number;
}

export interface JarvisAppearance {
  facade: 'brique' | 'bois' | 'beton-blanc' | 'beton-brut' | 'verre' | null;
  roof: 'terrasse' | 'pente' | 'deux-pans' | 'quatre-pans' | null;
  openings: 'baies-vitrees' | 'fenetres-verticales' | 'fenetres-horizontales' | 'mur-rideau' | null;
  shape: 'barre' | 'l' | 'u' | 't' | 'h' | 'cour' | 'gradins' | 'socle-tour' | null;
  architecturalStyle: 'contemporain' | 'haussmannien' | 'traditionnel' | 'industriel' | null;
  articulation: { depthM: number; bays: number } | null;
}

/** Seuls les mots explicitement présents dans le dossier deviennent des choix visuels. */
export function jarvisAppearance(draft: JarvisDraft): JarvisAppearance {
  const style = appearanceFromText(draft.style ?? '');
  const objective = appearanceFromText(draft.objectif ?? '');
  return {
    facade: style.facade ?? objective.facade,
    roof: style.roof ?? objective.roof,
    openings: style.openings ?? objective.openings,
    shape: style.shape ?? objective.shape,
    architecturalStyle: style.architecturalStyle ?? objective.architecturalStyle,
    articulation: facadeRules(draft).length ? null : style.articulation ?? objective.articulation,
  };
}

/** Consignes chiffrées de façade ; les dimensions absentes restent des hypothèses affichées. */
export function facadeRules(draft: JarvisDraft): JarvisFacadeRule[] {
  const source = [draft.objectif, draft.style, draft.contraintes].filter(Boolean).join('. ')
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’]/g, "'");
  const clauses = source.split(/(?:;|(?<!\d)\.(?!\d)|\s+et\s+(?=(?:avance|recule|retire|sur la facade|retrait)))/).map(part => part.trim()).filter(Boolean);
  const result: JarvisFacadeRule[] = [];
  let currentSide: JarvisFacadeRule['side'] = 'sud';
  for (const clause of clauses) {
    const side = /facade\s+(sud|nord|est|ouest)/.exec(clause)?.[1] as JarvisFacadeRule['side'] | undefined;
    if (side) currentSide = side;
    const action = /\b(recule|reculer|retire|retrait|renfonce|avance|avancer|avancee)\b/.exec(clause)?.[1];
    if (!action || (action === 'retrait' && !/facade/.test(clause))
      || !/(?:facade|aile|metres?\s+centraux?|\b\d+(?:[,.]\d+)?\s*m\b)/.test(clause)) continue;
    const depthMatches = [...clause.matchAll(/\bde\s+(\d{1,2}(?:[,.]\d{1,2})?)\s*(?:m\b|metres?\b)/g)];
    const depth = depthMatches.length ? Number(depthMatches[depthMatches.length - 1]![1]!.replace(',', '.')) : NaN;
    if (!(depth >= 0.4 && depth <= 5)) continue;
    const widthMatch = /(\d{1,3}(?:[,.]\d{1,2})?)\s*(?:m\b|metres?\b)\s*(?:centraux?|de\s+large(?:ur)?|sur\s+la\s+largeur)/.exec(clause);
    const widthM = widthMatch ? Number(widthMatch[1].replace(',', '.')) : null;
    const position = /\b(?:droite|droit)\b/.test(clause) ? 'droite' : /\b(?:gauche|gauch)\b/.test(clause) ? 'gauche' : 'centre';
    const range = /\bdu\s+r\s*\+\s*(\d{1,2})\s+au\s+r\s*\+\s*(\d{1,2})/.exec(clause);
    const from = range ? Number(range[1]) : /(?:a\s+partir\s+du|depuis\s+le)\s+r\s*\+\s*(\d{1,2})/.exec(clause)?.[1];
    const single = /\bau\s+r\s*\+\s*(\d{1,2})/.exec(clause)?.[1];
    const ground = /rez[- ]de[- ]chaussee|\brdc\b/.test(clause);
    const fromLevel = range ? Number(range[1]) : from !== undefined ? Number(from) : single !== undefined ? Number(single) : 0;
    const toLevel = range ? Number(range[2]) : ground ? 0 : single !== undefined ? Number(single) : null;
    if (fromLevel > 29 || (toLevel !== null && toLevel < fromLevel) || (widthM !== null && (widthM < 2 || widthM > 100))) continue;
    result.push({ side: currentSide, action: /avance/.test(action) ? 'avancee' : 'retrait', position,
      widthM, depthM: depth, fromLevel, toLevel, sideAssumed: !side, widthAssumed: widthM === null });
    if (result.length === 2) break;
  }
  return result;
}

function appearanceFromText(value: string): JarvisAppearance {
  const text = value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const facade = /mur[- ]rideau|facades? (?:en )?verre|batiment en verre/.test(text) ? 'verre'
    : /facades? (?:en )?briques?|(?:immeuble|batiment) en briques?|\bbriques?\b/.test(text) ? 'brique'
    : /facades? (?:en )?bois|bardage bois|(?:immeuble|batiment) en bois/.test(text) ? 'bois'
    : /beton blanc/.test(text) ? 'beton-blanc'
    : /beton brut|beton banche/.test(text) ? 'beton-brut' : null;
  const roof = /toiture[- ]terrasse|toit terrasse|toiture plate|toit plat/.test(text) ? 'terrasse'
    : /toiture.{0,20}(?:a )?deux pans|toit.{0,20}(?:a )?deux pans|\bbipente\b/.test(text) ? 'deux-pans'
    : /toiture.{0,20}(?:a )?quatre pans|toit.{0,20}(?:a )?quatre pans/.test(text) ? 'quatre-pans'
    : /(?:toiture|toit).{0,20}\ben pente\b|\btoit pente\b/.test(text) ? 'pente' : null;
  const openings = /mur[- ]rideau/.test(text) ? 'mur-rideau'
    : /baies? vitrees?/.test(text) ? 'baies-vitrees'
    : /fenetres? horizontales?|bandeaux? filants?/.test(text) ? 'fenetres-horizontales'
    : /fenetres? verticales?/.test(text) ? 'fenetres-verticales' : null;
  const shape = /\ben forme de h\b|\b(en h|plan en h)\b/.test(text) ? 'h'
    : /\ben forme de t\b|\b(en t|plan en t)\b/.test(text) ? 't'
    : /\ben forme de l\b|\b(en l|plan en l)\b/.test(text) ? 'l'
    : /\ben forme de u\b|\b(en u|plan en u)\b/.test(text) ? 'u'
    : /\bpatio\b|cour interieure|cour centrale|cour fermee/.test(text) ? 'cour'
    : /\bgradins?\b|en escalier|redents?/.test(text) ? 'gradins'
    : /tour sur socle|sur (?:un )?socle|sur podium/.test(text) ? 'socle-tour'
    : /\ben barre\b|\bforme de barre\b/.test(text) ? 'barre' : null;
  const architecturalStyle = /haussmann/.test(text) ? 'haussmannien'
    : /industriel/.test(text) ? 'industriel'
    : /traditionnel|neo[- ]?traditionnel|mediterraneen/.test(text) ? 'traditionnel'
    : /contemporain|moderne/.test(text) ? 'contemporain' : null;
  const articulated = /decroch|redent|renfoncement|avant.corps|facade[^.;]{0,30}(?:retrait|avancee)|(?:retrait|avancee)\s+(?:de\s+la\s+)?facade/.test(text);
  const amount = /(?:decroch|redent|renfoncement|avant.corps)[^.;]{0,45}?(?:de\s+)?(\d{1,2}(?:[,.]\d{1,2})?)\s*m\b/.exec(text)
    ?? /facade[^.;]{0,30}?(?:retrait|avancee)[^.;]{0,20}?(\d{1,2}(?:[,.]\d{1,2})?)\s*m\b/.exec(text)
    ?? /(?:retrait|avancee)\s+(?:de\s+la\s+)?facade[^.;]{0,20}?(\d{1,2}(?:[,.]\d{1,2})?)\s*m\b/.exec(text);
  const depthM = amount ? Number(amount[1].replace(',', '.')) : 1.5;
  const articulation = articulated && depthM >= 0.4 && depthM <= 3
    ? { depthM, bays: 5 } : null;
  return { facade, roof, openings, shape, architecturalStyle, articulation };
}

/** Une esquisse n'est affichée que si les dimensions et le nombre de niveaux sont explicites. */
export function jarvisMassing(draft: JarvisDraft): JarvisMassing | null {
  const buildings = explicitBuildings(draft);
  if (buildings) {
    const logements = /\b(\d{1,4})\s+logements?\b/i.exec(draft.programme ?? draft.objectif ?? '');
    const spacing = /(?:s[ée]par[ée]s?|espac[ée]s?|[ée]cart(?:[ée]s)?|distance)\s+(?:de\s+)?(\d{1,3}(?:[,.]\d{1,2})?)\s*m\b/i.exec([draft.objectif, draft.dimensions, draft.contraintes].filter(Boolean).join(' '));
    const separationM = spacing ? Number(spacing[1].replace(',', '.')) : undefined;
    return {
      largeurM: buildings[0].largeurM, profondeurM: buildings[0].profondeurM,
      niveaux: buildings[0].niveaux, logements: logements ? Number(logements[1]) : null,
      appearance: buildings[0].appearance, buildings,
      ...(separationM !== undefined && separationM >= 2 && separationM <= 100 ? { separationM } : {}),
    };
  }
  const segments = explicitSegments(draft);
  if (segments) {
    const largeurM = segments.reduce((sum, part) => sum + part.largeurM, 0);
    const profondeurM = Math.max(...segments.map(part => part.profondeurM + part.retraitM));
    const logements = /\b(\d{1,4})\s+logements?\b/i.exec(draft.programme ?? draft.objectif ?? '');
    const rules = facadeRules(draft);
    return { largeurM, profondeurM, niveaux: Math.max(...segments.map(part => part.niveaux)),
      logements: logements ? Number(logements[1]) : null, appearance: jarvisAppearance(draft), segments,
      ...(rules.length ? { facadeRules: rules } : {}) };
  }
  const source = [draft.objectif, draft.dimensions, draft.programme].filter(Boolean).join(' ');
  const dimensions = /\b(\d{1,3}(?:[,.]\d{1,2})?)\s*(?:m|m[eè]tres?)\s*(?:sur|x|×)\s*(\d{1,3}(?:[,.]\d{1,2})?)\s*(?:m|m[eè]tres?)?\b/i.exec(draft.dimensions ?? source);
  const etages = /\bR\s*\+\s*(\d{1,2})\b/i.exec(draft.objectif ?? source);
  if (!dimensions || !etages) return null;
  const largeurM = Number(dimensions[1].replace(',', '.'));
  const profondeurM = Number(dimensions[2].replace(',', '.'));
  const niveaux = Number(etages[1]) + 1;
  if (largeurM < 3 || largeurM > 200 || profondeurM < 3 || profondeurM > 200 || niveaux > 30) return null;
  const logements = /\b(\d{1,4})\s+logements?\b/i.exec(draft.programme ?? source);
  const rules = facadeRules(draft);
  return { largeurM, profondeurM, niveaux, logements: logements ? Number(logements[1]) : null,
    appearance: jarvisAppearance(draft), ...(rules.length ? { facadeRules: rules } : {}) };
}

/** Corps contigus, explicitement dimensionnés, d'un seul bâtiment. */
function explicitSegments(draft: JarvisDraft): JarvisSegment[] | null {
  const source = [draft.objectif, draft.dimensions, draft.contraintes].filter(Boolean).join('. ');
  if (/\b(?:b[âa]timent|immeuble)\s+[A-H]\b/i.test(source)) return null;
  const markers = [...source.matchAll(/\b(?:partie\s+centrale|corps\s+central|aile\s+gauche|aile\s+droite)\b/gi)];
  if (markers.length < 2 || markers.length > 3) return null;
  const parts = markers.map((marker, index) => {
    const section = source.slice(marker.index, markers[index + 1]?.index);
    const dimensions = /\b(\d{1,3}(?:[,.]\d{1,2})?)\s*(?:m|m[eè]tres?)\s*(?:sur|x|×)\s*(\d{1,3}(?:[,.]\d{1,2})?)\s*(?:m|m[eè]tres?)?\b/i.exec(section);
    const level = /\bR\s*\+\s*(\d{1,2})\b/i.exec(section);
    if (!dimensions || !level) return null;
    const largeurM = Number(dimensions[1].replace(',', '.'));
    const profondeurM = Number(dimensions[2].replace(',', '.'));
    const niveaux = Number(level[1]) + 1;
    const retreat = /\bretrait\s+(?:de\s+)?(\d{1,2}(?:[,.]\d{1,2})?)\s*m\b/i.exec(section);
    const retraitM = retreat ? Number(retreat[1].replace(',', '.')) : 0;
    if (largeurM < 3 || largeurM > 100 || profondeurM < 3 || profondeurM > 100 || niveaux > 30 || retraitM > 20) return null;
    return { name: marker[0].replace(/^./, c => c.toUpperCase()), largeurM, profondeurM, niveaux, retraitM, x: 0, z: 0 };
  });
  if (parts.some(part => !part) || new Set(parts.map(part => part!.name.toLowerCase())).size !== parts.length) return null;
  const ordered = [
    ...parts.filter(part => part!.name.toLowerCase().includes('gauche')),
    ...parts.filter(part => /central/.test(part!.name.toLowerCase())),
    ...parts.filter(part => part!.name.toLowerCase().includes('droite')),
  ];
  if (ordered.length !== parts.length) return null;
  const total = ordered.reduce((sum, part) => sum + part!.largeurM, 0);
  const maxDepth = Math.max(...ordered.map(part => part!.profondeurM + part!.retraitM));
  let left = -total / 2;
  return ordered.map(part => {
    const segment = { ...part!, x: left + part!.largeurM / 2,
      z: -maxDepth / 2 + part!.retraitM + part!.profondeurM / 2 };
    left += part!.largeurM;
    return segment;
  });
}

/** R2 — nombre maximal de bâtiments d'une composition (même borne que le contrat v2 et Studio). */
export const COMPOSITION_MAX = 8;

/** R2 — 2 à 8 bâtiments nommés (A à H) et chiffrés : aucune dimension n'est déduite d'un autre. */
function explicitBuildings(draft: JarvisDraft): JarvisBuildingMassing[] | null {
  const source = [draft.objectif, draft.dimensions, draft.style].filter(Boolean).join('. ');
  const markers = [...source.matchAll(/\b(?:b[âa]timent|immeuble)\s+([A-H])\b/gi)];
  if (markers.length < 2 || markers.length > COMPOSITION_MAX
    || new Set(markers.map(marker => marker[1].toUpperCase())).size !== markers.length) return null;
  const buildings = markers.map((marker, index) => {
    const section = source.slice(marker.index, index + 1 < markers.length ? markers[index + 1].index : undefined);
    const dimensions = /\b(\d{1,3}(?:[,.]\d{1,2})?)\s*(?:m|m[eè]tres?)\s*(?:sur|x|×)\s*(\d{1,3}(?:[,.]\d{1,2})?)\s*(?:m|m[eè]tres?)?\b/i.exec(section);
    const level = /\bR\s*\+\s*(\d{1,2})\b/i.exec(section);
    if (!dimensions || !level) return null;
    const largeurM = Number(dimensions[1].replace(',', '.'));
    const profondeurM = Number(dimensions[2].replace(',', '.'));
    const niveaux = Number(level[1]) + 1;
    if (largeurM < 3 || largeurM > 200 || profondeurM < 3 || profondeurM > 200 || niveaux > 30) return null;
    return { name: `Bâtiment ${marker[1].toUpperCase()}`, largeurM, profondeurM, niveaux,
      appearance: { ...jarvisAppearance(draft), ...Object.fromEntries(Object.entries(appearanceFromText(section)).filter(([, value]) => value !== null)) } as JarvisAppearance };
  });
  return buildings.every(Boolean) ? buildings as JarvisBuildingMassing[] : null;
}

const BLOCK = /```mimmoza-3d\s*([\s\S]*?)```/g;
const FIELDS = ['objectif', 'localisation', 'programme', 'dimensions', 'style', 'contraintes'] as const;

export function parseJarvisDraft(raw: unknown): JarvisDraft | null {
  if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1) return null;
  const value = raw as Record<string, unknown>;
  const draft = { version: 1 } as JarvisDraft;
  for (const field of FIELDS) {
    const v = value[field];
    draft[field] = typeof v === 'string' && v.trim() ? v.trim().slice(0, 2000) : null;
  }
  draft.questions = Array.isArray(value.questions)
    ? value.questions.filter((v): v is string => typeof v === 'string').map(v => v.trim()).filter(Boolean).slice(0, 6)
    : [];
  draft.pieces = Array.isArray(value.pieces)
    ? value.pieces.filter((v): v is string => typeof v === 'string').map(v => v.trim()).filter(Boolean).slice(0, 20)
    : [];
  return draft;
}

export function readJarvisDraft(text: string): JarvisDraft | null {
  const blocks = [...text.matchAll(BLOCK)];
  for (let i = blocks.length - 1; i >= 0; i--) {
    try {
      const draft = parseJarvisDraft(JSON.parse(blocks[i][1]));
      if (draft) return draft;
    } catch { /* bloc incomplet pendant le streaming */ }
  }
  return null;
}

export function withoutJarvisDraft(text: string): string {
  return text.replace(BLOCK, '').replace(/```mimmoza-3d[\s\S]*$/i, '').trim();
}

type DraftMessage = { role: string; text: string; createdAt?: string };

function appearanceStyle(appearance: JarvisAppearance): string | null {
  const parts = [
    appearance.facade === 'brique' ? 'Façade en brique' : appearance.facade === 'bois' ? 'Façade en bardage bois'
      : appearance.facade === 'beton-blanc' ? 'Façade en béton blanc' : appearance.facade === 'beton-brut' ? 'Façade en béton brut'
        : appearance.facade === 'verre' ? 'Façade en verre' : null,
    appearance.roof === 'terrasse' ? 'toiture-terrasse' : appearance.roof === 'deux-pans' ? 'toiture à deux pans'
      : appearance.roof === 'quatre-pans' ? 'toiture à quatre pans' : appearance.roof === 'pente' ? 'toit en pente' : null,
    appearance.openings === 'baies-vitrees' ? 'baies vitrées' : appearance.openings === 'fenetres-verticales' ? 'fenêtres verticales'
      : appearance.openings === 'fenetres-horizontales' ? 'fenêtres horizontales' : appearance.openings === 'mur-rideau' ? 'mur-rideau' : null,
    appearance.shape === 'l' ? 'forme en L' : appearance.shape === 'u' ? 'forme en U'
      : appearance.shape === 't' ? 'forme en T' : appearance.shape === 'h' ? 'forme en H'
        : appearance.shape === 'cour' ? 'cour intérieure' : appearance.shape === 'gradins' ? 'en gradins'
          : appearance.shape === 'socle-tour' ? 'tour sur socle' : appearance.shape === 'barre' ? 'en barre' : null,
    appearance.architecturalStyle ? `style ${appearance.architecturalStyle}` : null,
    appearance.articulation ? `décrochés de façade de ${String(appearance.articulation.depthM).replace('.', ',')} m` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** Répare les fiches incomplètes du copilote à partir des seules demandes explicites de l'utilisateur. */
export function reconcileJarvisDraft(draft: JarvisDraft, messages: readonly DraftMessage[], savedAt?: string): JarvisDraft {
  const eligible = messages.filter(message => message.role === 'user'
    && (!savedAt || !message.createdAt || Date.parse(message.createdAt) <= Date.parse(savedAt)));
  const first = eligible.find(message => is3DPreparationRequest(message.text));
  const base = first ? draftFromRequest(first.text) : null;
  const initialLevel = /\bR\s*\+\s*\d{1,2}\b/i.exec(base?.objectif ?? '');
  const missingBuildings = base && explicitBuildings(base) && !explicitBuildings(draft);
  const missingSegments = base && explicitSegments(base) && !explicitSegments(draft);
  const objectiveHasBuilding = /\b(immeuble|b[âa]timent|maison|villa|r[ée]sidence|tour|h[ôo]tel|[ée]cole)\b/i.test(draft.objectif ?? '');
  const objectiveHasLevel = /\bR\s*\+\s*\d{1,2}\b/i.test(draft.objectif ?? '');
  let objectif = base && (missingSegments || (initialLevel && (missingBuildings || !objectiveHasBuilding || (!savedAt && !objectiveHasLevel))))
    ? base.objectif : draft.objectif ?? base?.objectif ?? null;
  const latestLevel = [...eligible].reverse().filter(message => !/(?:à|a)\s+partir\s+du\s+R\s*\+|depuis\s+le\s+R\s*\+|\bdu\s+R\s*\+\s*\d+\s+au\s+R\s*\+|\bau\s+R\s*\+/i.test(message.text))
    .map(message => /\bR\s*\+\s*(\d{1,2})\b/i.exec(message.text)).find(Boolean);
  if (objectif && initialLevel && latestLevel && objectif === base?.objectif) {
    objectif = objectif.replace(/\bR\s*\+\s*\d{1,2}\b/i, `R+${latestLevel[1]}`);
  }
  let style = draft.style;
  const appearance: JarvisAppearance = jarvisAppearance({ ...draft, objectif: null });
  let changed = false;
  for (const message of eligible) {
    // Une correction manuelle enregistrée garde priorité champ par champ.
    const current = appearanceFromText(message.text);
    for (const field of ['facade', 'roof', 'openings', 'shape', 'architecturalStyle', 'articulation'] as const) {
      if (current[field] && (!savedAt || !appearance[field])) {
        (appearance as unknown as Record<string, JarvisAppearance[keyof JarvisAppearance]>)[field] = current[field]; changed = true;
      }
    }
  }
  if (changed) style = appearanceStyle(appearance);
  if (!facadeRules({ ...draft, style }).length) {
    const precise = eligible.filter(message => facadeRules({ ...draft, objectif: null, style: message.text, contraintes: null }).length)
      .map(message => message.text.trim());
    if (precise.length) style = [style, ...precise].filter(Boolean).join('. ').slice(0, 2000);
  }
  return {
    ...draft,
    objectif,
    programme: draft.programme ?? base?.programme ?? null,
    dimensions: draft.dimensions ?? base?.dimensions ?? null,
    style,
  };
}

export function latestJarvisDraft(messages: readonly DraftMessage[]): JarvisDraft | null {
  const initial = messages.find(message => message.role === 'user' && is3DPreparationRequest(message.text));
  const fallback = initial ? draftFromRequest(initial.text) : null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'assistant') continue;
    const draft = readJarvisDraft(messages[i].text);
    if (draft) return reconcileJarvisDraft(fallback ? {
      ...draft,
      // Le modèle peut omettre des valeurs explicites du premier message.
      // Une correction ultérieure non vide dans la fiche reste prioritaire.
      objectif: fallback.objectif && /\bR\s*\+\s*\d{1,2}\b/i.test(fallback.objectif)
        && !/\bR\s*\+\s*\d{1,2}\b/i.test(draft.objectif ?? '')
        ? fallback.objectif : draft.objectif ?? fallback.objectif,
      programme: draft.programme ?? fallback.programme,
      dimensions: draft.dimensions ?? fallback.dimensions,
    } : draft, messages);
  }
  return fallback ? reconcileJarvisDraft(fallback, messages) : null;
}

function draftFromRequest(text: string): JarvisDraft {
  const source = text.trim().slice(0, 2000);
  const dimensions = /\b(\d{1,3}(?:[,.]\d{1,2})?)\s*(?:m|m[eè]tres?)\s*(?:sur|x|×)\s*(\d{1,3}(?:[,.]\d{1,2})?)\s*(?:m|m[eè]tres?)?\b/i.exec(source);
  const logements = /\b(\d{1,4})\s+logements?\b/i.exec(source);
  return {
    version: 1,
    objectif: source,
    localisation: null,
    programme: logements ? `${logements[1]} logements` : null,
    dimensions: dimensions ? `${dimensions[1]} m sur ${dimensions[2]} m` : null,
    style: null,
    contraintes: null,
    questions: [],
    pieces: [],
  };
}

export function is3DPreparationRequest(text: string): boolean {
  const t = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /\b(3d|studio 3d|mimmoza studio|mimmozia studio|previsualisation|maquette 3d|modele 3d|rendu 3d)\b/.test(t)
    && !/^\s*(qu'est.ce|c'est quoi|comment fonctionne|pourquoi)\b/.test(t);
}

export function draftBrief(draft: JarvisDraft): string {
  const lines = ['Dossier 3D confirmé avec Mimmo.'];
  for (const field of FIELDS) {
    if (draft[field]) lines.push(`${field} : ${draft[field]}`);
  }
  return lines.join('\n').slice(0, 2000);
}

/** Instruction courte pour le moteur architectural ; le brief lisible reste séparé. */
export function studioCommand(draft: JarvisDraft): string | null {
  const buildings = explicitBuildings(draft);
  if (buildings) {
    const first = buildings[0];
    return studioCommand({ ...draft,
      objectif: `Crée un bâtiment R+${first.niveaux - 1}`,
      dimensions: `${first.largeurM} m sur ${first.profondeurM} m`,
      style: appearanceStyle(first.appearance),
    });
  }
  const source = [draft.objectif, draft.programme].filter(Boolean).join(' ');
  const type = /\bimmeuble\s+(?:de\s+)?bureaux\b/i.test(source) ? 'un immeuble de bureaux'
    : /\bimmeuble\s+collectif\b/i.test(source) ? 'un immeuble collectif'
    : /\bimmeuble\b/i.test(source) ? 'un immeuble'
    : /\br[ée]sidence\s+[ée]tudiante\b/i.test(source) ? 'une résidence étudiante'
    : /\br[ée]sidence\b/i.test(source) ? 'une résidence'
    : /\bmaison\b/i.test(source) ? 'une maison'
    : /\bvilla\b/i.test(source) ? 'une villa'
    : /\bcollectif\b/i.test(source) ? 'un immeuble collectif'
    : /\bb[âa]timent\b/i.test(source) ? 'un bâtiment'
    : /\btour\b/i.test(source) ? 'une tour'
    : /\bh[ôo]tel\b/i.test(source) ? 'un hôtel'
    : /\b[ée]cole\b/i.test(source) ? 'une école'
    : /\bbureaux\b/i.test(source) ? 'un immeuble de bureaux'
    : null;
  if (!type) return null;
  const niveaux = /\bR\s*\+\s*(\d{1,2})\b/i.exec(source);
  const dimensions = /\b(\d{1,3}(?:[,.]\d{1,2})?)\s*(?:m|m[eè]tres?)\s*(?:sur|x|×)\s*(\d{1,3}(?:[,.]\d{1,2})?)\s*(?:m|m[eè]tres?)?\b/i.exec(draft.dimensions ?? '');
  const appearance = jarvisAppearance(draft);
  const material = appearance.facade === 'brique' ? ' en brique'
    : appearance.facade === 'bois' ? ' en bardage bois'
    : appearance.facade === 'beton-blanc' ? ' en béton blanc'
    : appearance.facade === 'beton-brut' ? ' en béton brut'
    : appearance.facade === 'verre' ? ' en verre' : '';
  const roof = appearance.roof === 'terrasse' ? ', toiture-terrasse'
    : appearance.roof === 'deux-pans' || appearance.roof === 'pente' ? ', toiture à deux pans'
    : appearance.roof === 'quatre-pans' ? ', toiture à quatre pans' : '';
  const shape = appearance.shape === 'l' ? ', en forme de L' : appearance.shape === 'u' ? ', en forme de U'
    : appearance.shape === 't' ? ', en forme de T' : appearance.shape === 'h' ? ', en forme de H'
      : appearance.shape === 'cour' ? ', avec cour intérieure' : appearance.shape === 'gradins' ? ', en gradins'
        : appearance.shape === 'socle-tour' ? ', sur un socle' : appearance.shape === 'barre' ? ', en barre' : '';
  const openings = appearance.openings === 'baies-vitrees' ? ', baies vitrées'
    : appearance.openings === 'fenetres-verticales' ? ', fenêtres verticales'
    : appearance.openings === 'fenetres-horizontales' ? ', fenêtres horizontales'
    : appearance.openings === 'mur-rideau' ? ', mur-rideau' : '';
  return `Crée ${type}${niveaux ? ` R+${niveaux[1]}` : ''}${dimensions ? ` de ${dimensions[1]} m sur ${dimensions[2]} m` : ''}${shape}${material}${roof}${openings}.`;
}

/** Un seul bâtiment dans Studio, avec des ailes à hauteur et retrait indépendants. */
export function studioSegmentedVolume(draft: JarvisDraft): JarvisSegment[] | null {
  const massing = jarvisMassing(draft);
  if (!massing || massing.buildings || (!massing.segments && !massing.appearance.articulation && !massing.facadeRules?.length)) return null;
  const runs: JarvisSegment[] = [];
  const key = (rect: { x: number; z: number; width: number; depth: number }) => [rect.x, rect.z, rect.width, rect.depth].map(n => n.toFixed(3)).join(':');
  let previous = new Map<string, JarvisSegment>();
  for (let floor = 0; floor < massing.niveaux; floor++) {
    const current = new Map<string, JarvisSegment>();
    for (const rect of levelFootprint(massing, floor)) {
      const signature = key(rect);
      const continuing = previous.get(signature);
      if (continuing) { continuing.niveaux = floor + 1; current.set(signature, continuing); continue; }
      const part: JarvisSegment = { name: rect.name ?? `Partie ${String(runs.length + 1)}`,
        largeurM: rect.width, profondeurM: rect.depth, niveaux: floor + 1,
        retraitM: 0, x: rect.x, z: rect.z, fromLevelIndex: floor };
      runs.push(part); current.set(signature, part);
    }
    previous = current;
  }
  if (runs.length < 2 || runs.length > 12) return null;
  const front = Math.min(...runs.map(part => part.z - part.profondeurM / 2));
  return runs.map((part, index) => ({ ...part, name: `${part.name} ${String(index + 1)}`,
    retraitM: Math.round((part.z - part.profondeurM / 2 - front) * 100) / 100 }));
}

/**
 * Commandes indépendantes pour le transfert fidèle des gabarits dans Studio.
 * R2 — N bâtiments (2 à 8), rangés les uns derrière les autres sur l'axe Z,
 * séparés de `separationM` (8 m par défaut), l'ensemble centré sur 0 — comme
 * l'aperçu du tchat. Pour 2 bâtiments, les centres sont identiques à l'ancien calcul.
 */
export function studioComposition(draft: JarvisDraft): JarvisStudioBuilding[] | null {
  const massing = jarvisMassing(draft);
  if (!massing?.buildings || massing.buildings.length < 2 || massing.buildings.length > COMPOSITION_MAX) return null;
  const separation = massing.separationM ?? 8;
  const totalDepth = massing.buildings.reduce((sum, building) => sum + building.profondeurM, 0)
    + (massing.buildings.length - 1) * separation;
  let front = -totalDepth / 2;
  return massing.buildings.map(building => {
    const commande = studioCommand({ ...draft,
      objectif: `Crée un bâtiment R+${building.niveaux - 1}`,
      dimensions: `${building.largeurM} m sur ${building.profondeurM} m`,
      style: appearanceStyle(building.appearance),
    });
    const centreZ = front + building.profondeurM / 2;
    front += building.profondeurM + separation;
    return { name: building.name, commande: commande ?? '', centreZ };
  });
}
