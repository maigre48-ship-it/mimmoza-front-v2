// supabase/functions/agent-action-envoyer-v1/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// Appelée par le front après « Valider et envoyer » (RPC agent_action_valider
// d'abord). Entrée : { action_id }. Authentification : JWT de l'utilisateur,
// vérifié ici (verify_jwt = false, comme les fonctions agent-commercial-*).
// Toute la logique est dans logique.ts (testée sans réseau).
//
// ⚠️ Boîte mail de l'utilisateur : AUCUNE n'existe aujourd'hui.
// L'intégration agent-commercial-* (table commercial_integrations) est la boîte
// GMAIL DE MIMMOZA : une seule ligne par fournisseur (upsert onConflict
// 'provider'), sans user_id, réservée aux administrateurs, expédiant en
// commercial@mimmoza.fr. S'en servir enverrait les courriers d'un client au nom
// de Mimmoza : exclu. send-mails (Resend) est lui aussi réservé aux
// administrateurs (fermé le 22/10/2026 pour ne plus être un relais ouvert).
// → boiteMail() renvoie null : réponse { ok:false, raison:'boite_non_connectee',
//   repli:{ a, objet, corps, mailto } } et le front propose copier / mailto.
// Le jour où une connexion Gmail PAR UTILISATEUR existera (même OAuth que
// agent-commercial-oauth-*, scope gmail.send, jetons stockés par user_id), il
// suffira d'implémenter boiteMail() : l'envoi (envoyerViaGmail) est prêt et testé.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { genererCourrierPdf } from './pdf.ts';
import {
  BUCKET_COURRIERS,
  envoyerViaGmail,
  traiterEnvoi,
  type ActionExterne,
  type DepotActions,
} from './logique.ts';

function premiereCle(brut: string | undefined): string | null {
  if (!brut) return null;
  try {
    const v = JSON.parse(brut);
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') for (const x of Object.values(v)) if (typeof x === 'string' && x) return x;
  } catch { return brut; }
  return null;
}

function cleService(): string {
  return premiereCle(Deno.env.get('SUPABASE_SECRET_KEYS')) ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '';
}

function depotSupabase(db: SupabaseClient): DepotActions {
  const COLONNES = 'id, user_id, canal, destinataire, objet, corps, pieces, statut, erreur';
  return {
    async utilisateurDepuisJwt(jwt) {
      const { data, error } = await db.auth.getUser(jwt);
      return error || !data?.user ? null : data.user.id;
    },
    async lireAction(id, userId) {
      const r = await db.from('agent_actions_externes').select(COLONNES).eq('id', id).eq('user_id', userId).maybeSingle();
      if (r.error) throw new Error(r.error.message);
      return (r.data as ActionExterne | null) ?? null;
    },
    async poserVerrou(id, ancien, nouveau) {
      let q = db.from('agent_actions_externes').update({ erreur: nouveau }).eq('id', id).eq('statut', 'valide');
      q = ancien === null ? q.is('erreur', null) : q.eq('erreur', ancien);
      const r = await q.select('id');
      if (r.error) throw new Error(r.error.message);
      return (r.data ?? []).length === 1;
    },
    async libererVerrou(id, verrou) {
      await db.from('agent_actions_externes').update({ erreur: null }).eq('id', id).eq('statut', 'valide').eq('erreur', verrou);
    },
    async marquerIncertain(id, verrou, marqueur) {
      const r = await db.from('agent_actions_externes').update({ erreur: marqueur.slice(0, 2000) })
        .eq('id', id).eq('statut', 'valide').eq('erreur', verrou);
      if (r.error) console.error('[agent-action-envoyer-v1] marqueur « résultat inconnu » non écrit', id, r.error.message);
    },
    async marquerEnvoye(id) {
      // envoye_le et erreur=null sont posés par le déclencheur _agent_actions_proteger.
      const r = await db.from('agent_actions_externes').update({ statut: 'envoye' }).eq('id', id).eq('statut', 'valide').select('id');
      if (r.error) throw new Error(r.error.message);
      return (r.data ?? []).length === 1;
    },
    async marquerEchec(id, erreur) {
      await db.from('agent_actions_externes').update({ statut: 'echec', erreur: erreur.slice(0, 2000) }).eq('id', id).eq('statut', 'valide');
    },
    async nomExpediteur(userId) {
      const r = await db.from('users_profiles').select('full_name').eq('id', userId).maybeSingle();
      return r.error ? null : ((r.data as { full_name?: string } | null)?.full_name ?? null);
    },
    boiteMail(_userId) {
      return Promise.resolve(null); // voir l'en-tête : pas de boîte par utilisateur à ce jour.
    },
    async deposerPdf(chemin, octets) {
      const r = await db.storage.from(BUCKET_COURRIERS).upload(chemin, octets, { contentType: 'application/pdf', upsert: true });
      if (r.error) throw new Error(`Dépôt du PDF impossible : ${r.error.message}`);
    },
    async urlSignee(chemin, secondes) {
      const r = await db.storage.from(BUCKET_COURRIERS).createSignedUrl(chemin, secondes);
      return r.error ? null : r.data?.signedUrl ?? null;
    },
  };
}

let _db: SupabaseClient | null = null;

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    const url = Deno.env.get('SUPABASE_URL'), cle = cleService();
    if (!url || !cle) throw new Error('Configuration Supabase serveur manquante.');
    _db ??= createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } });
    return await traiterEnvoi(req, {
      depot: depotSupabase(_db),
      envoyerEmail: (boite, m) => envoyerViaGmail(boite, m),
      genererPdf: genererCourrierPdf,
    });
  } catch (e) {
    console.error('[agent-action-envoyer-v1]', e);
    return new Response(JSON.stringify({ ok: false, raison: 'erreur_serveur' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});
