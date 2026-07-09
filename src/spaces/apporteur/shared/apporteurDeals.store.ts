// src/spaces/apporteur/shared/apporteurDeals.store.ts
//
// Persistance Supabase des opportunités apporteur.
// ⚠️ Toutes les fonctions sont désormais asynchrones.
// L'ancien store localStorage est conservé le temps de la migration
// (voir migrateLegacyApporteurDeals ci-dessous), puis supprimable.

import { supabase } from "@/lib/supabaseClient";
import { userStorage } from "@/lib/storage/userScopedStorage";

const LEGACY_STORAGE_KEY = "mimmoza.apporteur.deals.v1";
const TABLE = "apporteur_deals";

export type ApporteurDealStatus =
  | "depose"
  | "en_etude"
  | "qualifie"
  | "transmis_promoteur"
  | "refuse";

export type ApporteurDealTypeBien = "terrain" | "maison" | "immeuble" | "autre";

export type ApporteurDeal = {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  source: "apporteur";
  apporteurName?: string;
  apporteurEmail?: string;
  apporteurPhone?: string;
  adresse: string;
  commune?: string;
  codePostal?: string;
  typeBien: ApporteurDealTypeBien;
  surfaceTerrainM2?: number;
  prixVendeur?: number;
  commentaire?: string;
  status: ApporteurDealStatus;
  transmisA?: string;
  transmisAt?: string;
  promoteurStudyId?: string;
  commissionPct?: number;
  commissionStatus?: "en_attente" | "validee" | "versee" | "annulee";
};

type _ApporteurDealOmitted = "id" | "userId" | "createdAt" | "updatedAt" | "source" | "status";
type _ApporteurDealBase = Omit<ApporteurDeal, _ApporteurDealOmitted>;
export type CreateApporteurDealInput = _ApporteurDealBase & {
  status?: ApporteurDealStatus;
};

/** Options de filtrage / tri pour la vue liste. */
export type ListApporteurDealsOptions = {
  search?: string;
  status?: ApporteurDealStatus[];
  typeBien?: ApporteurDealTypeBien[];
  prixMin?: number;
  prixMax?: number;
  surfaceMin?: number;
  surfaceMax?: number;
  sortBy?: "createdAt" | "prixVendeur" | "surfaceTerrainM2";
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

// ------------------------------------------------------------
// Mapping DB <-> domaine
// ------------------------------------------------------------

type DbRow = Record<string, unknown>;

function fromDb(row: DbRow): ApporteurDeal {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    source: "apporteur",
    apporteurName: (row.apporteur_name as string) ?? undefined,
    apporteurEmail: (row.apporteur_email as string) ?? undefined,
    apporteurPhone: (row.apporteur_phone as string) ?? undefined,
    adresse: row.adresse as string,
    commune: (row.commune as string) ?? undefined,
    codePostal: (row.code_postal as string) ?? undefined,
    typeBien: row.type_bien as ApporteurDealTypeBien,
    surfaceTerrainM2: (row.surface_terrain_m2 as number) ?? undefined,
    prixVendeur: (row.prix_vendeur as number) ?? undefined,
    commentaire: (row.commentaire as string) ?? undefined,
    status: row.status as ApporteurDealStatus,
    transmisA: (row.transmis_a as string) ?? undefined,
    transmisAt: (row.transmis_at as string) ?? undefined,
    promoteurStudyId: (row.promoteur_study_id as string) ?? undefined,
    commissionPct: (row.commission_pct as number) ?? undefined,
    commissionStatus: (row.commission_status as ApporteurDeal["commissionStatus"]) ?? undefined,
  };
}

function toDb(patch: Partial<ApporteurDeal>): DbRow {
  const out: DbRow = {};
  if (patch.apporteurName !== undefined) out.apporteur_name = patch.apporteurName;
  if (patch.apporteurEmail !== undefined) out.apporteur_email = patch.apporteurEmail;
  if (patch.apporteurPhone !== undefined) out.apporteur_phone = patch.apporteurPhone;
  if (patch.adresse !== undefined) out.adresse = patch.adresse;
  if (patch.commune !== undefined) out.commune = patch.commune;
  if (patch.codePostal !== undefined) out.code_postal = patch.codePostal;
  if (patch.typeBien !== undefined) out.type_bien = patch.typeBien;
  if (patch.surfaceTerrainM2 !== undefined) out.surface_terrain_m2 = patch.surfaceTerrainM2;
  if (patch.prixVendeur !== undefined) out.prix_vendeur = patch.prixVendeur;
  if (patch.commentaire !== undefined) out.commentaire = patch.commentaire;
  if (patch.status !== undefined) out.status = patch.status;
  if (patch.transmisA !== undefined) out.transmis_a = patch.transmisA;
  if (patch.transmisAt !== undefined) out.transmis_at = patch.transmisAt;
  if (patch.promoteurStudyId !== undefined) out.promoteur_study_id = patch.promoteurStudyId;
  if (patch.commissionPct !== undefined) out.commission_pct = patch.commissionPct;
  if (patch.commissionStatus !== undefined) out.commission_status = patch.commissionStatus;
  return out;
}

const SORT_COLUMN: Record<NonNullable<ListApporteurDealsOptions["sortBy"]>, string> = {
  createdAt: "created_at",
  prixVendeur: "prix_vendeur",
  surfaceTerrainM2: "surface_terrain_m2",
};

// ------------------------------------------------------------
// API publique
// ------------------------------------------------------------

export async function createApporteurDeal(
  input: CreateApporteurDealInput
): Promise<ApporteurDeal> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Utilisateur non authentifié");

  const payload = {
    ...toDb({ ...input, status: input.status ?? "depose" }),
    user_id: userId,
  };

  const { data, error } = await supabase
    .from(TABLE)
    .insert(payload)
    .select()
    .single();

  if (error) throw new Error(`Création de l'opportunité impossible : ${error.message}`);
  return fromDb(data);
}

export async function listApporteurDeals(
  options: ListApporteurDealsOptions = {}
): Promise<{ deals: ApporteurDeal[]; total: number }> {
  const {
    search,
    status,
    typeBien,
    prixMin,
    prixMax,
    surfaceMin,
    surfaceMax,
    sortBy = "createdAt",
    sortDir = "desc",
    limit = 50,
    offset = 0,
  } = options;

  let query = supabase.from(TABLE).select("*", { count: "exact" });

  if (search?.trim()) {
    const term = `%${search.trim()}%`;
    query = query.or(
      `adresse.ilike.${term},commune.ilike.${term},code_postal.ilike.${term}`
    );
  }
  if (status?.length) query = query.in("status", status);
  if (typeBien?.length) query = query.in("type_bien", typeBien);
  if (prixMin !== undefined) query = query.gte("prix_vendeur", prixMin);
  if (prixMax !== undefined) query = query.lte("prix_vendeur", prixMax);
  if (surfaceMin !== undefined) query = query.gte("surface_terrain_m2", surfaceMin);
  if (surfaceMax !== undefined) query = query.lte("surface_terrain_m2", surfaceMax);

  query = query
    .order(SORT_COLUMN[sortBy], { ascending: sortDir === "asc", nullsFirst: false })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) throw new Error(`Lecture des opportunités impossible : ${error.message}`);

  return { deals: (data ?? []).map(fromDb), total: count ?? 0 };
}

/**
 * Les deals déposés par l'utilisateur courant.
 * Nécessaire car la policy `select` expose aussi les deals 'depose' des
 * autres apporteurs (pool promoteur) : sans ce filtre, l'apporteur verrait
 * les dépôts de ses concurrents.
 */
export async function listMesApporteurDeals(): Promise<ApporteurDeal[]> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Utilisateur non authentifié");

  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("user_id", uid)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Lecture de vos opportunités impossible : ${error.message}`);
  return (data ?? []).map(fromDb);
}

/** Compteurs pour les cartes KPI du dashboard. */
export type ApporteurDealCounts = Record<ApporteurDealStatus, number> & { total: number };

export async function countApporteurDealsByStatus(): Promise<ApporteurDealCounts> {
  const { data, error } = await supabase.from(TABLE).select("status");
  if (error) throw new Error(`Comptage impossible : ${error.message}`);

  const base: Record<ApporteurDealStatus, number> = {
    depose: 0,
    en_etude: 0,
    qualifie: 0,
    transmis_promoteur: 0,
    refuse: 0,
  };
  for (const row of data ?? []) {
    const s = (row as DbRow).status as ApporteurDealStatus;
    if (s in base) base[s] += 1;
  }
  return { ...base, total: (data ?? []).length };
}

/** Récupère un deal par son id. Retourne null si introuvable ou non autorisé. */
export async function getApporteurDeal(id: string): Promise<ApporteurDeal | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Lecture de l'opportunité impossible : ${error.message}`);
  return data ? fromDb(data) : null;
}

export async function updateApporteurDeal(
  id: string,
  patch: Partial<Omit<ApporteurDeal, "id" | "createdAt" | "source">>
): Promise<ApporteurDeal | null> {
  const payload = toDb(patch);
  if (Object.keys(payload).length === 0) return getApporteurDeal(id);

  const { data, error } = await supabase
    .from(TABLE)
    .update(payload)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) throw new Error(`Mise à jour impossible : ${error.message}`);
  return data ? fromDb(data) : null;
}

/** Transmet un deal à un promoteur. Passe le statut et horodate en une seule écriture. */
export async function transmettreApporteurDeal(
  id: string,
  promoteurUserId: string,
  promoteurStudyId?: string
): Promise<ApporteurDeal | null> {
  return updateApporteurDeal(id, {
    status: "transmis_promoteur",
    transmisA: promoteurUserId,
    transmisAt: new Date().toISOString(),
    promoteurStudyId,
  });
}

export async function deleteApporteurDeal(id: string): Promise<boolean> {
  const { error, count } = await supabase
    .from(TABLE)
    .delete({ count: "exact" })
    .eq("id", id);

  if (error) throw new Error(`Suppression impossible : ${error.message}`);
  return (count ?? 0) > 0;
}

// ------------------------------------------------------------
// Vue promoteur : le pool
//
// La lecture passe par v_apporteur_deals_pool, qui masque les champs
// sensibles en base tant que le deal n'est pas débloqué. Le front ne
// décide de rien : Postgres renvoie null.
// ------------------------------------------------------------

const POOL_VIEW = "v_apporteur_deals_pool";

export type PoolDeal = {
  id: string;
  createdAt: string;
  status: ApporteurDealStatus;
  typeBien: ApporteurDealTypeBien;
  surfaceTerrainM2?: number;
  prixVendeur?: number;
  coutDeblocage: number;
  estDebloque: boolean;
  reserveParAutre: boolean;
  reserveJusquA?: string;
  departement?: string;
  promoteurStudyId?: string;
  // Null tant que non débloqué.
  adresse?: string;
  commune?: string;
  codePostal?: string;
  commentaire?: string;
  apporteurName?: string;
  apporteurEmail?: string;
  apporteurPhone?: string;
};

function fromPoolRow(row: DbRow): PoolDeal {
  return {
    id: row.id as string,
    createdAt: row.created_at as string,
    status: row.status as ApporteurDealStatus,
    typeBien: row.type_bien as ApporteurDealTypeBien,
    surfaceTerrainM2: (row.surface_terrain_m2 as number) ?? undefined,
    prixVendeur: (row.prix_vendeur as number) ?? undefined,
    coutDeblocage: row.cout_deblocage as number,
    estDebloque: Boolean(row.est_debloque),
    reserveParAutre: Boolean(row.reserve_par_autre),
    reserveJusquA: (row.reserve_jusqu_a as string) ?? undefined,
    departement: (row.departement as string) ?? undefined,
    promoteurStudyId: (row.promoteur_study_id as string) ?? undefined,
    adresse: (row.adresse as string) ?? undefined,
    commune: (row.commune as string) ?? undefined,
    codePostal: (row.code_postal as string) ?? undefined,
    commentaire: (row.commentaire as string) ?? undefined,
    apporteurName: (row.apporteur_name as string) ?? undefined,
    apporteurEmail: (row.apporteur_email as string) ?? undefined,
    apporteurPhone: (row.apporteur_phone as string) ?? undefined,
  };
}

/** Le pool des deals visibles par le promoteur courant. */
export async function listDealsOuverts(): Promise<PoolDeal[]> {
  const { data, error } = await supabase
    .from(POOL_VIEW)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Lecture du pool impossible : ${error.message}`);
  return (data ?? []).map(fromPoolRow);
}

/** Un deal du pool par son id. Champs sensibles masqués si non débloqué. */
export async function getPoolDeal(id: string): Promise<PoolDeal | null> {
  const { data, error } = await supabase
    .from(POOL_VIEW)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Lecture de l'opportunité impossible : ${error.message}`);
  return data ? fromPoolRow(data) : null;
}

export type DeblocageResult = {
  ok: true;
  dejaDebloque: boolean;
  cout: number;
  soldeRestant?: number;
  reserveJusquA?: string;
};

export type DeblocageErreur =
  | "NOT_AUTHENTICATED"
  | "DEAL_NOT_FOUND"
  | "DEAL_RESERVE"
  | "PROPRE_DEAL"
  | "NO_ACCOUNT"
  | "INSUFFICIENT_CREDITS"
  | "UNKNOWN";

export class DeblocageError extends Error {
  readonly code: DeblocageErreur;

  constructor(code: DeblocageErreur, message: string) {
    super(message);
    this.name = "DeblocageError";
    this.code = code;
  }
}

const DEBLOCAGE_MESSAGES: Record<DeblocageErreur, string> = {
  NOT_AUTHENTICATED:    "Vous devez être connecté.",
  DEAL_NOT_FOUND:       "Cette opportunité n'existe plus.",
  DEAL_RESERVE:         "Cette opportunité est réservée par un autre promoteur.",
  PROPRE_DEAL:          "Vous ne pouvez pas débloquer votre propre dépôt.",
  NO_ACCOUNT:           "Aucun compte de crédits associé.",
  INSUFFICIENT_CREDITS: "Crédits insuffisants pour débloquer cette opportunité.",
  UNKNOWN:              "Le déblocage a échoué.",
};

/**
 * Débloque un deal : débit atomique + réservation exclusive 30 jours.
 * Idempotent — un second appel ne débite rien et renvoie cout = 0.
 */
export async function debloquerDeal(dealId: string): Promise<DeblocageResult> {
  const { data, error } = await supabase.rpc("debloquer_apporteur_deal", {
    p_deal_id: dealId,
  });

  if (error) {
    const raw = error.message ?? "";
    const code = (Object.keys(DEBLOCAGE_MESSAGES) as DeblocageErreur[])
      .find((k) => raw.includes(k)) ?? "UNKNOWN";
    throw new DeblocageError(code, DEBLOCAGE_MESSAGES[code]);
  }

  const r = data as Record<string, unknown>;
  return {
    ok: true,
    dejaDebloque: Boolean(r.deja_debloque),
    cout: Number(r.cout ?? 0),
    soldeRestant: r.solde_restant != null ? Number(r.solde_restant) : undefined,
    reserveJusquA: (r.reserve_jusqu_a as string) ?? undefined,
  };
}

/** Refus par le promoteur : le deal sort du pool. */
export async function refuserDeal(id: string): Promise<ApporteurDeal | null> {
  return updateApporteurDeal(id, { status: "refuse" });
}

// ------------------------------------------------------------
// Migration one-shot des deals localStorage vers la base.
// À appeler une fois au montage du space apporteur.
// Supprimable une fois tous les utilisateurs migrés.
// ------------------------------------------------------------

export async function migrateLegacyApporteurDeals(): Promise<number> {
  let legacy: unknown;
  try {
    const raw = userStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return 0;
    legacy = JSON.parse(raw);
  } catch {
    return 0;
  }
  if (!Array.isArray(legacy) || legacy.length === 0) return 0;

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return 0;

  const rows = (legacy as ApporteurDeal[])
    // Les deals legacy n'ont pas de destinataire : tout statut autre que
    // 'depose'/'refuse' violerait apporteur_deals_prise_en_charge_coherente.
    // On les remet dans le pool.
    .map((d) => (d.status === "refuse" ? d : { ...d, status: "depose" as const }))
    .map((d) => ({ ...toDb(d), user_id: userId, created_at: d.createdAt }));

  const { error } = await supabase.from(TABLE).insert(rows);
  if (error) {
    console.error("[apporteurDeals.store] Migration legacy échouée", error.message);
    return 0;
  }

  userStorage.removeItem(LEGACY_STORAGE_KEY);
  return rows.length;
}