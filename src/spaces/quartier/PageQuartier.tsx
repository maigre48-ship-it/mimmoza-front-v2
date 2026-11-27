// src/spaces/quartier/PageQuartier.tsx
// =============================================================================
// VIS-70 (27/11/2026) — page « Quartier / Plan masse » de l'outil de vente : /mimmozia/quartier?conversation=…[&lat=&lon=][&vue=]
// Ouverte par la carte « Le quartier » du chat (outil quartier_atouts), par le bouton de l'Espace 3D
// (BoutonPageQuartier) ou par un lien direct. Le projet est la parcelle de la dernière préparation Studio de la
// conversation (contour + centroïde) ; ?lat&lon prime s'il est fourni.
// Données : src/lib/quartier/chargerQuartier.ts (BPE, GTFS, gares, OSM, SIRENE) ; livrables : studio_jobs de la
// conversation lus comme le dossier client (VIS-60, lecture seule) → menu Plan masse · Situation · Extérieur · Plans ·
// Intérieur · Galerie, visite /visite/<id> (VIS-69), grille de vente (VIS-67, simple lien).
// =============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { chargerAtoutsQuartier, lireAtoutsSession, lireProjetConversation } from '../../lib/quartier/chargerQuartier.ts';
import type { AtoutsQuartier, ProjetQuartier } from '../../lib/quartier/atoutsQuartier.ts';
import { CATEGORIES_QUARTIER, type CategorieQuartier } from '../../lib/quartier/categoriesQuartier.ts';
import { construireMenuVente, vueDepuisAdresse, type VueVente } from '../../lib/quartier/navigationVente.ts';
import { collecterLivrables, type ManifesteDossier } from '../../lib/studio/dossierClient/dossierClientLogique.ts';
import { lireTravauxDossier } from '../../lib/studio/dossierClient/preparerDossierClient.ts';
import { VueQuartier } from './VueQuartier';

const VALIDITE_URL_S = 3600;

export default function PageQuartier() {
  const [params, setParams] = useSearchParams();
  const conversationId = params.get('conversation');
  const latP = Number(params.get('lat')), lonP = Number(params.get('lon'));
  const pointAdresse = Number.isFinite(latP) && Number.isFinite(lonP) && params.get('lat') !== null && params.get('lon') !== null ? { lat: latP, lon: lonP } : null;
  const vue = vueDepuisAdresse(params.get('vue'));
  const categorieP = params.get('categorie');
  const categorieInitiale = (CATEGORIES_QUARTIER as readonly string[]).includes(categorieP ?? '') ? categorieP as CategorieQuartier : null;

  const [projet, setProjet] = useState<ProjetQuartier | null>(null);
  const [atouts, setAtouts] = useState<AtoutsQuartier | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [manifeste, setManifeste] = useState<ManifesteDossier | null>(null);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [urlFilm, setUrlFilm] = useState<string | null>(null);

  // 1. Le projet.
  useEffect(() => {
    let annule = false;
    (async () => {
      const deConversation = conversationId ? await lireProjetConversation(conversationId).catch(() => null) : null;
      const p: ProjetQuartier | null = pointAdresse
        ? { ...(deConversation ?? {}), lat: pointAdresse.lat, lon: pointAdresse.lon, precision: deConversation ? deConversation.precision : 'point' }
        : deConversation;
      if (annule) return;
      if (!p) { setErreur('Projet introuvable : ouvrez cette page depuis le chat ou l’Espace 3D d’un projet localisé.'); setChargement(false); return; }
      setProjet(p);
    })();
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, latP, lonP]);

  // 2. Les atouts (session d'abord : mêmes chiffres que la carte du chat, puis rafraîchissement).
  const charger = useCallback(async (p: ProjetQuartier, forcer = false) => {
    const enCache = forcer ? null : lireAtoutsSession(p);
    if (enCache) { setAtouts(enCache); setChargement(false); return; }
    setChargement(true);
    try { setAtouts(await chargerAtoutsQuartier(p)); setErreur(null); }
    catch (e) { setErreur(`Données du quartier illisibles pour le moment (${e instanceof Error ? e.message : String(e)}).`); }
    finally { setChargement(false); }
  }, []);
  useEffect(() => {
    if (!projet) return;
    let annule = false;
    void (async () => { await Promise.resolve(); if (!annule) await charger(projet); })();
    return () => { annule = true; };
  }, [projet, charger]);

  // 3. Les livrables (rendus, film, visite, plans) et leurs liens signés.
  useEffect(() => {
    if (!conversationId) return;
    let annule = false;
    (async () => {
      try {
        const m = collecterLivrables(await lireTravauxDossier(conversationId));
        if (annule) return;
        setManifeste(m);
        const chemins = [...new Set([...m.images.map((i) => i.cheminApercu ?? i.chemin), ...m.plans.map((x) => x.chemin)])];
        if (chemins.length) {
          const { data } = await supabase.storage.from('studio-rendus').createSignedUrls(chemins, VALIDITE_URL_S);
          if (!annule && data) setUrls(new Map(data.flatMap((d) => (d.signedUrl && d.path ? [[d.path, d.signedUrl] as [string, string]] : []))));
        }
        if (m.film) {
          const { data } = await supabase.storage.from(m.film.fichier.bucket).createSignedUrl(m.film.fichier.chemin, VALIDITE_URL_S);
          if (!annule) setUrlFilm(data?.signedUrl ?? null);
        }
      } catch { /* livrables illisibles : le menu les montre « À venir », la situation reste disponible */ }
    })();
    return () => { annule = true; };
  }, [conversationId]);

  const menu = useMemo(() => construireMenuVente(manifeste, { conversationId, origine: typeof window !== 'undefined' ? window.location.origin : '' }), [manifeste, conversationId]);
  const changerVue = useCallback((v: VueVente) => {
    const q = new URLSearchParams(params);
    if (v === 'situation') q.delete('vue'); else q.set('vue', v);
    setParams(q, { replace: true });
  }, [params, setParams]);

  useEffect(() => { document.title = `Quartier — ${projet?.libelle ?? 'Mimmoza'}`; }, [projet]);

  return (
    <VueQuartier
      titre={projet?.libelle ?? 'Votre projet'} adresse={projet?.adresse ?? (projet?.communeInsee ? `Commune ${projet.communeInsee}` : null)}
      atouts={atouts} chargement={chargement} erreur={erreur} menu={menu} vue={vue} onVue={changerVue} urls={urls} urlFilm={urlFilm}
      onActualiser={projet ? () => void charger(projet, true) : undefined} categorieInitiale={categorieInitiale}
    />
  );
}
