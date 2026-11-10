// interior-architect-v1/schemas.ts
// Validation STRICTE de l'entrée (zod) : toute clé inconnue est refusée, toute
// valeur hors bornes aussi. Les bornes sont des garde-fous d'Edge Function
// (taille, temps de calcul), pas des règles d'architecture : elles sont
// volontairement larges et écrites ici en clair.
//
// Le contrat reproduit à l'identique les types du moteur
// (moteur/types.ts : PlanInput, InteriorBrief, version 0.2.0 ; INT-10b : types.ts
// identique en 0.3.0, même sha256). Si le contrat du moteur évolue, relire ces schémas.

import { z } from 'zod';
import { ROOM_ROLES } from './moteur/types.ts';
import { FIXTURE_KINDS } from './moteur/data/schemas.ts';
import type { InteriorBrief, PlanInput } from './moteur/types.ts';

// ── Bornes (garde-fous techniques) ─────────────────────────────
export const BORNES = {
  coordonneeMaxM: 500,
  idMax: 64,
  texteMax: 2000,
  piecesMax: 40,
  mursMax: 600,
  ouverturesMax: 300,
  equipementsMax: 300,
  sommetsMin: 3,
  sommetsMax: 128,
  occupantsAdultesMax: 12,
  occupantsEnfantsMax: 12,
  listeIdsMax: 60,
  graineMax: 1_000_000,
  descriptionMax: 2000,
} as const;

const Id = z.string().trim().min(1).max(BORNES.idMax);
const Coord = z.number().finite().gte(-BORNES.coordonneeMaxM).lte(BORNES.coordonneeMaxM);
const Vec2Schema = z.tuple([Coord, Coord]);
const Positif = z.number().finite().positive();

const WallSchema = z.object({
  id: Id,
  a: Vec2Schema,
  b: Vec2Schema,
  thickness: z.number().finite().gte(0).lte(2),
  loadBearing: z.boolean().nullable(),
  exterior: z.boolean().optional(),
  level: z.number().int().gte(-5).lte(50).optional(),
}).strict();

const OpeningSchema = z.object({
  id: Id,
  kind: z.enum(['door', 'window', 'french_window', 'opening']),
  wallId: Id,
  offset: z.number().finite().gte(0).lte(BORNES.coordonneeMaxM),
  width: Positif.lte(20),
  sillHeight: z.number().finite().gte(0).lte(5).optional(),
  swing: z.object({ into: Id.nullable(), hinge: z.enum(['a', 'b']) }).strict().nullable().optional(),
  connects: z.tuple([Id.nullable(), Id.nullable()]),
}).strict();

const FixtureSchema = z.object({
  id: Id,
  kind: z.enum(FIXTURE_KINDS),
  roomId: Id,
  position: Vec2Schema,
  size: z.object({ w: Positif.lte(20), d: Positif.lte(20) }).strict().optional(),
  supposed: z.boolean().optional(),
  reason: z.string().max(BORNES.texteMax).optional(),
}).strict();

const RoomSchema = z.object({
  id: Id,
  name: z.string().trim().max(120).optional(),
  declaredRole: z.enum(ROOM_ROLES).nullable(),
  polygon: z.array(Vec2Schema).min(BORNES.sommetsMin).max(BORNES.sommetsMax),
  level: z.number().int().gte(-5).lte(50),
}).strict();

export const PlanInputSchema = z.object({
  id: Id,
  label: z.string().trim().min(1).max(200),
  typology: z.enum(['studio', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6+']),
  kind: z.enum(['appartement', 'maison']),
  construction: z.enum(['neuf', 'existant']),
  northDeg: z.number().finite().gte(-360).lte(360).nullable(),
  ceilingHeight: z.number().finite().gte(1.8).lte(8),
  walls: z.array(WallSchema).min(1).max(BORNES.mursMax),
  rooms: z.array(RoomSchema).min(1).max(BORNES.piecesMax),
  openings: z.array(OpeningSchema).max(BORNES.ouverturesMax),
  fixtures: z.array(FixtureSchema).max(BORNES.equipementsMax),
}).strict().superRefine((p, ctx) => {
  // Cohérence référentielle : un identifiant cité doit exister. Le moteur ne
  // devine pas une pièce ou un mur manquant ; on refuse plutôt que d'aménager
  // un plan incohérent.
  const unique = (ids: string[], chemin: string) => {
    const vus = new Set<string>();
    for (const id of ids) {
      if (vus.has(id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [chemin], message: `identifiant en double : ${id}` });
      vus.add(id);
    }
    return vus;
  };
  const murs = unique(p.walls.map((w) => w.id), 'walls');
  const pieces = unique(p.rooms.map((r) => r.id), 'rooms');
  unique(p.openings.map((o) => o.id), 'openings');
  unique(p.fixtures.map((f) => f.id), 'fixtures');
  p.openings.forEach((o, i) => {
    if (!murs.has(o.wallId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['openings', i, 'wallId'], message: `mur inconnu : ${o.wallId}` });
    o.connects.forEach((c, k) => {
      if (c !== null && !pieces.has(c)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['openings', i, 'connects', k], message: `pièce inconnue : ${c}` });
    });
    if (o.swing?.into != null && !pieces.has(o.swing.into)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['openings', i, 'swing', 'into'], message: `pièce inconnue : ${o.swing.into}` });
  });
  p.fixtures.forEach((f, i) => {
    if (!pieces.has(f.roomId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fixtures', i, 'roomId'], message: `pièce inconnue : ${f.roomId}` });
  });
  p.walls.forEach((w, i) => {
    if (Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) < 0.05) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['walls', i], message: 'mur de longueur nulle (< 5 cm)' });
  });
});

export const BriefSchema = z.object({
  version: z.literal(1).default(1),
  target: z.enum(['famille', 'primo_accedant', 'investisseur_locatif', 'senior', 'couple', 'etudiant']),
  occupants: z.object({
    adults: z.number().int().gte(1).lte(BORNES.occupantsAdultesMax),
    children: z.number().int().gte(0).lte(BORNES.occupantsEnfantsMax),
  }).strict(),
  style: z.enum(['contemporain', 'scandinave', 'industriel', 'japandi', 'classique_chic', 'mediterraneen']),
  gamme: z.enum(['economique', 'standard', 'premium']),
  constraints: z.object({
    teletravail: z.boolean(),
    pmr: z.boolean(),
    // Facultatif pour l'appelant : absent = pas d'animal déclaré (aucune règle ne s'appuie dessus en 0.2.0).
    animaux: z.boolean().default(false),
  }).strict(),
  imposed: z.array(Id).max(BORNES.listeIdsMax).default([]),
  forbidden: z.array(Id).max(BORNES.listeIdsMax).default([]),
  sourceText: z.string().max(BORNES.texteMax).optional(),
}).strict();

/**
 * Corps de la requête. Exactement UNE source de plan est attendue :
 *  - `plan` : PlanInput (contrat du moteur) → aménagement ;
 *  - `description` : description typologique (« T3 de 62 m² ») → REFUS motivé, aucun plan n'est inventé ;
 *  - `roomPlan` : plan au format interne du Studio → REFUS motivé (la conversion vit dans le Studio).
 */
export const RequeteSchema = z.object({
  plan: z.unknown().optional(),
  description: z.string().trim().min(1).max(BORNES.descriptionMax).optional(),
  roomPlan: z.unknown().optional(),
  brief: z.unknown().optional(),
  seed: z.number().int().gte(0).lte(BORNES.graineMax).optional(),
  variants: z.number().int().gte(2).lte(3).optional(),
  // Rattachement facultatif (persistance : lot ultérieur, voir migration interior_projects).
  dossier_id: z.string().uuid().optional(),
}).strict();

export type Requete = z.infer<typeof RequeteSchema>;

export interface ErreurValidation { chemin: string; message: string }

export function erreursZod(e: z.ZodError, prefixe = ''): ErreurValidation[] {
  return e.issues.slice(0, 30).map((i) => ({
    chemin: [prefixe, ...i.path.map(String)].filter(Boolean).join('.') || '(racine)',
    message: i.message,
  }));
}

export function validerPlan(x: unknown): { ok: true; plan: PlanInput } | { ok: false; erreurs: ErreurValidation[] } {
  const r = PlanInputSchema.safeParse(x);
  return r.success ? { ok: true, plan: r.data as PlanInput } : { ok: false, erreurs: erreursZod(r.error, 'plan') };
}

export function validerBrief(x: unknown): { ok: true; brief: InteriorBrief } | { ok: false; erreurs: ErreurValidation[] } {
  const r = BriefSchema.safeParse(x);
  return r.success ? { ok: true, brief: r.data as InteriorBrief } : { ok: false, erreurs: erreursZod(r.error, 'brief') };
}
