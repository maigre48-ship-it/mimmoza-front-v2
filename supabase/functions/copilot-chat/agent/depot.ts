// supabase/functions/copilot-chat/agent/depot.ts
// =============================================================
// Dépôt Supabase du moteur de mission : une méthode = une RPC ou une requête
// de la migration 20261030_agent_autonome.sql. Client service_role (getAdmin()
// de l'index, injecté). Aucune dépendance npm ici : le client est typé
// structurellement, ce qui garde `deno test` hors réseau.
// =============================================================

import type {
  ActionExterne, Briefing, DepotMission, ElementMemoire, EtatMission, GenreJournal,
  MissionRow, ResultatDebit, StatutMission,
} from './types.ts';

// deno-lint-ignore no-explicit-any
type Requete = any;
/** Sous-ensemble structurel de SupabaseClient. */
export interface ClientSupabaseMin {
  from(table: string): Requete;
  rpc(fn: string, args?: Record<string, unknown>): Requete;
  storage?: Requete;
}

/** Encodage base64 d'un binaire, par blocs (pas de dépassement de pile sur un gros PDF). */
export function versBase64(octets: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < octets.length; i += 0x8000) bin += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(bin);
}

const ENTREE_MAX_CARS = 8000;

function borneEntree(entree: unknown): unknown {
  if (entree == null) return null;
  try {
    const s = JSON.stringify(entree);
    if (s.length <= ENTREE_MAX_CARS) return entree;
    return { apercu: s.slice(0, ENTREE_MAX_CARS), tronque: true };
  } catch {
    return null;
  }
}

function erreur(contexte: string, e: { message?: string } | null | undefined): Error {
  return new Error(`${contexte} : ${e?.message ?? 'erreur inconnue'}`);
}

/** Lignes de test présentes en prod dans les tables plu_* (ex. Paris UG « Test ingestion ») : écartées. */
export function estLigneDeTest(r: Record<string, unknown>): boolean {
  const t = JSON.stringify(r).toLowerCase();
  // Toute variante « test Mimmoza » (« version test Mimmoza », « tests Mimmoza »…) : une donnée de test
  // ne doit jamais alimenter un vrai projet.
  return /test ingestion|plu_paris_test|tests? mimmoza|zone [a-z0-9]+ test\b/.test(t);
}

export function depotSupabase(db: ClientSupabaseMin): DepotMission {
  return {
    async prendreMissions(worker, bailS) {
      const { data, error } = await db.rpc('agent_mission_prendre', { p_worker: worker, p_lease_s: bailS });
      if (error) throw erreur('agent_mission_prendre', error);
      return (data ?? []) as MissionRow[];
    },

    async reserver(id) {
      const { data, error } = await db.rpc('agent_mission_reserver', { p_id: id });
      if (error) throw erreur('agent_mission_reserver', error);
      return (data ?? { ok: false, raison: 'reponse_vide' }) as { ok: boolean; raison?: string; jetons_reserves?: number };
    },

    async prolongerBail(id, worker, bailS) {
      const { data, error } = await db.rpc('agent_mission_prolonger_bail', { p_id: id, p_worker: worker, p_lease_s: bailS });
      if (error) { console.warn('[agent] prolonger_bail', error.message); return false; }
      return data === true;
    },

    async libererBail(id, worker) {
      const { error } = await db.from('agent_missions').update({ bail_jusqu_a: null })
        .eq('id', id).eq('worker', worker);
      if (error) console.warn('[agent] libérer bail', error.message);
    },

    async chargerMission(id) {
      const { data, error } = await db.from('agent_missions').select('*').eq('id', id).maybeSingle();
      if (error) throw erreur('lecture mission', error);
      return (data ?? null) as MissionRow | null;
    },

    async sauverEtat(id, etat) {
      // Seul le moteur écrit `etat` pendant qu'il tient le bail ; la RPC
      // agent_mission_repondre n'y écrit qu'en attente_utilisateur (mission
      // jamais prise dans cet état) : pas d'écrasement concurrent possible.
      const { error } = await db.from('agent_missions').update({ etat }).eq('id', id);
      if (error) throw erreur('sauvegarde état', error);
    },

    async mettreEnAttente(id, question, etat) {
      const { data, error } = await db.from('agent_missions')
        .update({ statut: 'attente_utilisateur', question_en_attente: question.slice(0, 4000), etat, bail_jusqu_a: null })
        .eq('id', id).eq('statut', 'en_cours').select('id');
      if (error) throw erreur('mise en attente', error);
      return Array.isArray(data) && data.length === 1;
    },

    async debiter(id, n, jetons, pireCasSuivant, etat) {
      const { data, error } = await db.rpc('agent_mission_debiter', {
        p_id: id, p_n: n,
        p_jetons: Math.max(0, Math.ceil(jetons)),
        p_pire_cas_suivant: Math.max(0, Math.ceil(pireCasSuivant)),
        p_etat: etat,
      });
      if (error) throw erreur('agent_mission_debiter', error);
      const r = (data ?? {}) as ResultatDebit;
      return {
        ...r, ok: r.ok === true, deja_debite: r.deja_debite === true,
        reste: Number(r.reste) || 0, peut_continuer: r.peut_continuer === true,
      };
    },

    async proactifEtat(userId) {
      const { data, error } = await db.rpc('agent_proactif_etat', { p_user_id: userId });
      if (error) throw erreur('agent_proactif_etat', error);
      const d = (data ?? {}) as Record<string, unknown>;
      return { actif: d.actif === true, learning_enabled: d.learning_enabled !== false, restant: Number(d.restant) || 0 };
    },

    async cloturer(id, statut: StatutMission, rapport, erreurTexte) {
      const { error } = await db.rpc('agent_mission_cloturer', {
        p_id: id, p_statut: statut, p_rapport: rapport, p_erreur: erreurTexte,
      });
      if (error) throw erreur('agent_mission_cloturer', error);
    },

    async regler(id) {
      const { data, error } = await db.rpc('agent_mission_regler', { p_id: id });
      if (error) throw erreur('agent_mission_regler', error);
      return (data ?? { ok: false, raison: 'reponse_vide' }) as { ok: boolean; deja_regle?: boolean; jetons_factures?: number; jetons_rembourses?: number; raison?: string };
    },

    async journal(missionId, genre: GenreJournal, outil, entree, resume, jetons) {
      // Le journal ne doit JAMAIS interrompre une mission : on trace et on continue.
      const { error } = await db.rpc('agent_mission_journaliser', {
        p_id: missionId, p_genre: genre, p_outil: outil, p_entree: borneEntree(entree),
        p_resume: (resume ?? '').slice(0, 1000), p_jetons: Math.max(0, Math.ceil(jetons || 0)),
      });
      if (error) console.warn('[agent] journal', error.message);
    },

    async creerActionBrouillon(a: ActionExterne) {
      // Statut forcé à « brouillon » par le déclencheur _agent_actions_proteger :
      // on ne le transmet même pas.
      const { data, error } = await db.from('agent_actions_externes').insert({
        user_id: a.user_id, mission_id: a.mission_id, projet_id: a.projet_id,
        canal: a.canal, destinataire: a.destinataire, objet: a.objet, corps: a.corps,
      }).select('id').single();
      if (error) throw erreur('création du brouillon', error);
      return String(data.id);
    },

    async memoriser(userId, missionId, e: ElementMemoire) {
      const { error } = await db.rpc('agent_memoire_ecrire', {
        p_user_id: userId, p_projet_id: e.projet_id, p_mission_id: missionId,
        p_genre: e.genre, p_cle: e.cle, p_contenu: e.contenu, p_source: e.source,
        p_confiance: e.confiance ?? 'estime', p_epingle: e.epingle,
      });
      if (error) throw erreur('agent_memoire_ecrire', error);
    },

    async lireMemoire(userId, projetId, limite) {
      const champs = 'id, genre, cle, contenu, source, confiance, epingle, projet_id, maj_le';
      // Épinglés (tous projets de l'utilisateur confondus, bornés) + récents du projet
      // courant (ou de la mémoire générale si aucun projet).
      const epingles = db.from('agent_memoire_projet').select(champs)
        .eq('user_id', userId).eq('epingle', true).order('maj_le', { ascending: false }).limit(20);
      let recents = db.from('agent_memoire_projet').select(champs)
        .eq('user_id', userId).order('maj_le', { ascending: false }).limit(limite);
      recents = projetId ? recents.eq('projet_id', projetId) : recents.is('projet_id', null);
      const [a, b] = await Promise.all([epingles, recents]);
      if (a.error) throw erreur('mémoire épinglée', a.error);
      if (b.error) throw erreur('mémoire récente', b.error);
      const epinglesFiltres = ((a.data ?? []) as ElementMemoire[])
        .filter((e) => e.projet_id == null || e.projet_id === projetId);
      return [...epinglesFiltres, ...((b.data ?? []) as ElementMemoire[])];
    },

    async creerBriefing(userId, missionId, b: Briefing) {
      const { error } = await db.from('agent_briefings').insert({
        user_id: userId, mission_id: missionId,
        titre: String(b.titre ?? 'Veille').slice(0, 300),
        resume: b.resume ? String(b.resume).slice(0, 4000) : null,
        elements: Array.isArray(b.elements) ? b.elements : [],
      });
      // 23505 : briefing déjà écrit pour cette mission (contrainte unique
      // agent_briefings(mission_id), demandée à l'agent BDD) → idempotent.
      if (error && error.code !== '23505') throw erreur('création du briefing', error);
    },

    async creerMission(row) {
      const { data, error } = await db.from('agent_missions').insert(row).select('id').single();
      if (error) throw erreur('création de la mission', error);
      return String(data.id);
    },

    async listerMissions(userId, limite) {
      const { data, error } = await db.from('agent_missions')
        .select('id, type, objectif, statut, devis, jetons_reserves, jetons_consommes, etapes_faites, etapes_max, question_en_attente, rapport, erreur, cree_le, termine_le')
        .eq('user_id', userId).order('cree_le', { ascending: false }).limit(limite);
      if (error) throw erreur('liste des missions', error);
      return (data ?? []) as MissionRow[];
    },

    async chargerMissionUtilisateur(userId, id) {
      const { data, error } = await db.from('agent_missions').select('*')
        .eq('id', id).eq('user_id', userId).maybeSingle();
      if (error) throw erreur('lecture mission', error);
      return (data ?? null) as MissionRow | null;
    },

    async reglesPluImportees(codeInsee, zone) {
      // Ordre de priorité : saisie manuelle > ruleset universel > rulesets par zone > extraction IA > synthèse.
      // Couverture constatée en prod le 30/10/2026 : Ascain (64065), deux jeux de test (Paris UG, Nantes UA).
      const z = zone.trim().toUpperCase();
      const lignes: Array<{ table: string; libelle: string | null; document: string | null; ruleset: unknown }> = [];
      const lire = async (table: string, champs: string, versLigne: (r: Record<string, unknown>) => { libelle: string | null; document: string | null; ruleset: unknown }) => {
        const { data, error } = await db.from(table).select(champs).eq('commune_insee', codeInsee).eq('zone_code', z).limit(3);
        if (error) { console.warn('[agent] règles importées', table, error.message); return; }
        for (const r of (data ?? []) as Record<string, unknown>[]) {
          if (estLigneDeTest(r)) continue;   // ex. « PLU test ingestion » Paris UG : jamais présenté comme règle
          lignes.push({ table, ...versLigne(r) });
        }
      };
      await lire('plu_manual_rulesets', 'plu_version_label, plu_source_url, plu_source_page_range, ruleset',
        (r) => ({ libelle: (r.plu_version_label as string) ?? null, document: [r.plu_source_url, r.plu_source_page_range].filter(Boolean).join(' ') || null, ruleset: r.ruleset }));
      await lire('plu_rulesets_universal', 'plu_version_label, zone_libelle, source_document, ruleset',
        (r) => ({ libelle: (r.plu_version_label as string) ?? null, document: (r.source_document as string) ?? null, ruleset: r.ruleset }));
      await lire('plu_zones_rulesets', 'document_id, ruleset',
        (r) => ({ libelle: null, document: (r.document_id as string) ?? null, ruleset: r.ruleset }));
      await lire('plu_rulesets_ai', 'source_pdf_storage_path, ruleset',
        (r) => ({ libelle: 'extraction IA', document: (r.source_pdf_storage_path as string) ?? null, ruleset: r.ruleset }));
      await lire('plu_regles_synthese', 'hauteur_max_m, emprise_sol_max, commentaire, raw_rules',
        (r) => ({ libelle: 'synthèse', document: (r.commentaire as string) ?? null, ruleset: { hauteur_max_m: r.hauteur_max_m, emprise_sol_max: r.emprise_sol_max } }));
      return lignes;
    },

    async enregistrerConception(missionId, userId, champs) {
      const { data: ex, error: e1 } = await db.from('agent_conceptions').select('id').eq('mission_id', missionId).eq('user_id', userId).maybeSingle();
      if (e1) throw erreur('lecture agent_conceptions', e1);
      if (ex?.id) {
        const { error } = await db.from('agent_conceptions').update(champs).eq('id', ex.id);
        if (error) throw erreur('mise à jour agent_conceptions', error);
        return String(ex.id);
      }
      const { data, error } = await db.from('agent_conceptions')
        .insert({ ...champs, user_id: userId, mission_id: missionId }).select('id').single();
      if (error) throw erreur('création agent_conceptions', error);
      return String(data.id);
    },

    async telechargerFichier(bucket, chemin, maxOctets) {
      if (!db.storage) return null;
      // Taille lue dans les MÉTADONNÉES avant tout téléchargement (un PDF de 200 Mo n'est jamais chargé).
      const i = chemin.lastIndexOf('/');
      const dossier = chemin.slice(0, i), nom = chemin.slice(i + 1);
      const liste = await db.storage.from(bucket).list(dossier, { search: nom, limit: 10 });
      if (liste.error) return null;
      const meta = ((liste.data ?? []) as Array<{ name: string; metadata?: { size?: number } }>).find((f) => f.name === nom);
      if (!meta) return null;
      const taille = Number(meta.metadata?.size);
      if (Number.isFinite(taille) && taille > maxOctets) return { trop_gros: true as const, octets: taille };
      const { data, error } = await db.storage.from(bucket).download(chemin);
      if (error || !data) return null;
      const octets = new Uint8Array(await (data as Blob).arrayBuffer());
      if (octets.length > maxOctets) return { trop_gros: true as const, octets: octets.length };
      return { base64: versBase64(octets), octets: octets.length };
    },

    async telechargerJson(bucket, chemin, maxOctets) {
      if (!db.storage) return null;
      const { data, error } = await db.storage.from(bucket).download(chemin);
      if (error || !data || (data as Blob).size > maxOctets) return null;
      try { return JSON.parse(await (data as Blob).text()); } catch { return null; }
    },

    async projetAccessible(userId, id) {
      // is_org_member() lit auth.uid(), vide en service_role : on refait le test.
      const { data, error } = await db.from('projects').select('id, organisation_id, created_by').eq('id', id).maybeSingle();
      if (error || !data?.id) return false;
      if (data.created_by === userId) return true;
      if (!data.organisation_id) return false;
      const m = await db.from('organisation_members').select('user_id')
        .eq('organisation_id', data.organisation_id).eq('user_id', userId).limit(1);
      return !m.error && Array.isArray(m.data) && m.data.length > 0;
    },
  };
}

export type { EtatMission };
