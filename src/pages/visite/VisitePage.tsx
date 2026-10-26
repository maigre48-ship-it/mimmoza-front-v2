// src/pages/visite/VisitePage.tsx
// =============================================================================
// Page PUBLIQUE de visite 360° : /visite/:visiteId (sans connexion).
// Lit <stockage public>/visites/<visiteId>/manifest.json (manifeste v1 du
// contrat), affiche le panorama de départ en plein écran, repères cliquables
// vers les panoramas voisins (fondu enchaîné), liste des pièces, boussole,
// mini-plan si fourni, plein écran, gyroscope sur téléphone, mentions légales.
// Démonstration sans rendu Unreal : /visite/demo ou ?demo=1 (public/visite-demo/).
// Lien direct vers une pièce : ?p=<panorama>.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  Compass, Info, List, Loader2, Map as IconePlan, Maximize2, Minimize2, RotateCw, Smartphone, X,
} from "lucide-react";
import {
  ID_DEMO, URL_SUPABASE_DEFAUT, dossierVisite, grouperPieces, identifiantValide, imagePlan, lireManifeste,
  messageHttp, positionSurPlan, urlFichier, type LienVisite, type ManifesteVisite, type PanoramaVisite,
} from "./manifeste";
import { Visionneuse, estMobile, webglDisponible } from "./visionneuse";
import "./visite.css";

type Etat =
  | { readonly type: "chargement" }
  | { readonly type: "erreur"; readonly message: string; readonly reessayable: boolean }
  | { readonly type: "pret"; readonly manifeste: ManifesteVisite; readonly dossier: string };

function urlSupabase(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_SUPABASE_URL || URL_SUPABASE_DEFAUT;
}

function baseApp(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.BASE_URL || "/";
}

export default function VisitePage() {
  const { visiteId: param } = useParams<{ visiteId: string }>();
  const [recherche] = useSearchParams();
  const visiteId = recherche.get("demo") === "1" ? ID_DEMO : param;
  const [etat, setEtat] = useState<Etat>({ type: "chargement" });
  const [essai, setEssai] = useState(0);

  // Refus immédiats (lien mal formé, navigateur sans 3D) : calculés au rendu, sans requête.
  const refus = useMemo(() => {
    if (!identifiantValide(visiteId)) return "Ce lien de visite n'est pas valide. Vérifiez l'adresse reçue.";
    if (!webglDisponible()) return "Votre navigateur n'affiche pas la 3D (WebGL désactivé). Essayez un navigateur récent.";
    return null;
  }, [visiteId]);

  useEffect(() => {
    if (refus || !visiteId) return;
    const ctrl = new AbortController();
    const dossier = dossierVisite(visiteId, urlSupabase(), baseApp());
    (async () => {
      let rep: Response;
      try {
        rep = await fetch(urlFichier(dossier, "manifest.json"), { signal: ctrl.signal, cache: "no-cache" });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setEtat({ type: "erreur", message: "Connexion impossible. Vérifiez votre réseau puis réessayez.", reessayable: true });
        return;
      }
      if (!rep.ok) {
        setEtat({ type: "erreur", message: messageHttp(rep.status), reessayable: rep.status >= 500 });
        return;
      }
      let brut: unknown;
      try {
        brut = await rep.json();
      } catch {
        setEtat({ type: "erreur", message: "Cette visite est illisible (fichier de description endommagé).", reessayable: false });
        return;
      }
      const lu = lireManifeste(brut);
      if (!lu.ok) {
        setEtat({ type: "erreur", message: `Cette visite est illisible : ${lu.erreur}.`, reessayable: false });
        return;
      }
      for (const a of lu.avertissements) console.warn("[visite 360]", a);
      setEtat({ type: "pret", manifeste: lu.manifeste, dossier });
    })();
    return () => ctrl.abort();
  }, [visiteId, essai, refus]);

  useEffect(() => {
    const precedent = document.title;
    document.title = etat.type === "pret" ? `${etat.manifeste.titre} — Visite 360° · Mimmoza` : "Visite 360° · Mimmoza";
    return () => { document.title = precedent; };
  }, [etat]);

  if (refus) return <EcranVisite etat={{ type: "erreur", message: refus, reessayable: false }} />;
  if (etat.type === "pret") return <VisiteImmersive manifeste={etat.manifeste} dossier={etat.dossier} />;
  return (
    <EcranVisite
      etat={etat}
      reessayer={() => {
        setEtat({ type: "chargement" });
        setEssai((n) => n + 1);
      }}
    />
  );
}

function EcranVisite({ etat, reessayer }: { etat: Exclude<Etat, { type: "pret" }>; reessayer?: () => void }) {
  return (
    <div className="v360-racine v360-ecran">
      {etat.type === "chargement" ? (
        <div className="v360-message" role="status" aria-live="polite">
          <Loader2 className="v360-tourne" aria-hidden="true" />
          <p>Chargement de la visite…</p>
        </div>
      ) : (
        <div className="v360-message" role="alert">
          <Compass aria-hidden="true" />
          <h1>Visite indisponible</h1>
          <p>{etat.message}</p>
          {etat.reessayable && reessayer && (
            <button type="button" className="v360-bouton-texte" onClick={reessayer}>
              <RotateCw aria-hidden="true" /> Réessayer
            </button>
          )}
        </div>
      )}
      <p className="v360-mentions">Images de synthèse non contractuelles</p>
    </div>
  );
}

// ───────────────────────── Visite ─────────────────────────

function VisiteImmersive({ manifeste, dossier }: { manifeste: ManifesteVisite; dossier: string }) {
  const [recherche, setRecherche] = useSearchParams();
  const racine = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const visionneuse = useRef<Visionneuse | null>(null);
  const reperes = useRef(new Map<string, HTMLButtonElement>());
  const aiguille = useRef<HTMLDivElement>(null);
  const cone = useRef<HTMLDivElement>(null);
  const occupe = useRef(false);
  const parId = useMemo(() => new Map(manifeste.panoramas.map((p) => [p.id, p])), [manifeste]);
  const depart = parId.get(recherche.get("p") ?? "") ?? parId.get(manifeste.depart) ?? manifeste.panoramas[0];
  const [courant, setCourant] = useState<PanoramaVisite>(depart);
  const courantRef = useRef(courant);
  const [pret, setPret] = useState(false);
  const [nette, setNette] = useState(false);
  const [erreurImage, setErreurImage] = useState<string | null>(null);
  const [panneau, setPanneau] = useState<"pieces" | "plan" | "infos" | null>(null);
  const [pleinEcran, setPleinEcran] = useState(false);
  const [gyro, setGyro] = useState(false);
  const mobile = useMemo(() => estMobile(), []);
  const gyroPossible = mobile && typeof window !== "undefined" && "DeviceOrientationEvent" in window;
  const pleinEcranPossible = typeof document !== "undefined" &&
    !!(document.fullscreenEnabled || (document as unknown as { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled);
  const mouvementReduit = useMemo(() => typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false), []);
  const groupes = useMemo(() => grouperPieces(manifeste.panoramas), [manifeste]);

  const url = useCallback((nom: string) => urlFichier(dossier, nom), [dossier]);

  // Repères, boussole et cône du plan : repositionnés à chaque image, sans rendu React.
  const suivre = useCallback(() => {
    const v = visionneuse.current;
    if (!v) return;
    const p = courantRef.current;
    for (const l of p.liens) {
      const el = reperes.current.get(l.vers);
      if (!el) continue;
      const pr = v.projeter(l.cap_deg, l.inclinaison_deg);
      el.style.transform = `translate(${pr.x.toFixed(1)}px, ${pr.y.toFixed(1)}px) translate(-50%, -50%)`;
      el.style.visibility = pr.visible ? "visible" : "hidden";
    }
    const { cap } = v.orientation;
    if (aiguille.current) aiguille.current.style.transform = `rotate(${(-cap).toFixed(1)}deg)`;
    if (cone.current) cone.current.style.transform = `translate(-50%, -50%) rotate(${cap.toFixed(1)}deg)`;
  }, []);

  // Création de la visionneuse et premier panorama (aperçu, puis pleine résolution).
  useEffect(() => {
    if (!scene.current) return;
    const v = new Visionneuse(scene.current);
    visionneuse.current = v;
    v.surImage = suivre;
    v.surInteraction = () => {
      v.desactiverGyroscope();
      setGyro(false);
    };
    const ctrl = new AbortController();
    const p = courantRef.current;
    v.regarder(p.cap_initial_deg, 0, v.champConseille());
    (async () => {
      try {
        await v.afficher(url(p.apercu ?? p.image), { signal: ctrl.signal });
        setPret(true);
        if (p.apercu) await v.affiner(url(p.image), ctrl.signal);
        setNette(true);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setErreurImage("Le panorama n'a pas pu être chargé. Vérifiez votre connexion.");
      }
    })();
    return () => {
      ctrl.abort();
      v.detruire();
      visionneuse.current = null;
    };
  }, [url, suivre]);

  // Préchargement des aperçus voisins : le déplacement suivant démarre sans attente.
  useEffect(() => {
    for (const l of courant.liens) {
      const q = parId.get(l.vers);
      if (q) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = url(q.apercu ?? q.image);
      }
    }
  }, [courant, parId, url]);

  const aller = useCallback(async (id: string, lien?: LienVisite) => {
    const v = visionneuse.current;
    const cible = parId.get(id);
    if (!v || !cible || occupe.current || cible.id === courantRef.current.id) return;
    occupe.current = true;
    setPanneau((x) => (x === "pieces" || x === "plan") && mobile ? null : x);
    try {
      if (lien && !mouvementReduit) await v.tourner(lien.cap_deg, lien.inclinaison_deg);
      // Par un repère : on garde le cap de la marche (comme en vrai) ; par la liste : cap initial de la pièce.
      const cap = lien ? lien.cap_deg : cible.cap_initial_deg;
      if (!lien) v.regarder(cap, 0, v.champConseille());
      setNette(false);
      await v.afficher(url(cible.apercu ?? cible.image), { fondu: !mouvementReduit });
      courantRef.current = cible;
      setCourant(cible);
      if (lien) {
        v.regarder(cap, 0);
        v.relacher(v.champConseille());
      }
      const suite = new URLSearchParams(recherche);
      suite.set("p", cible.id);
      setRecherche(suite, { replace: true });
      setErreurImage(null);
      if (cible.apercu) await v.affiner(url(cible.image));
      setNette(true);
    } catch {
      setErreurImage("Ce panorama n'a pas pu être chargé. Réessayez.");
    } finally {
      occupe.current = false;
    }
  }, [parId, url, recherche, setRecherche, mobile, mouvementReduit]);

  // Plein écran.
  useEffect(() => {
    const maj = () => setPleinEcran(!!(document.fullscreenElement || (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement));
    document.addEventListener("fullscreenchange", maj);
    document.addEventListener("webkitfullscreenchange", maj);
    return () => {
      document.removeEventListener("fullscreenchange", maj);
      document.removeEventListener("webkitfullscreenchange", maj);
    };
  }, []);
  const basculerPleinEcran = async () => {
    const el = racine.current as (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> }) | null;
    const doc = document as Document & { webkitExitFullscreen?: () => Promise<void> };
    try {
      if (pleinEcran) await (document.exitFullscreen ? document.exitFullscreen() : doc.webkitExitFullscreen?.());
      else await (el?.requestFullscreen ? el.requestFullscreen() : el?.webkitRequestFullscreen?.());
    } catch {
      /* refusé par le navigateur : rien à faire */
    }
  };

  const basculerGyro = async () => {
    const v = visionneuse.current;
    if (!v) return;
    if (gyro) {
      v.desactiverGyroscope();
      setGyro(false);
      return;
    }
    const ok = await v.activerGyroscope();
    setGyro(ok);
    if (!ok) setErreurImage("Le mouvement du téléphone n'est pas autorisé : faites glisser votre doigt pour regarder autour.");
  };

  const clavier = (e: KeyboardEvent) => {
    const v = visionneuse.current;
    if (!v) return;
    const pas: Record<string, [number, number]> = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] };
    if (pas[e.key]) {
      e.preventDefault();
      v.pivoter(pas[e.key][0], pas[e.key][1]);
    } else if (e.key === "+" || e.key === "=") v.zoomer(-5);
    else if (e.key === "-") v.zoomer(5);
    else if (e.key === "Escape") setPanneau(null);
  };

  const plan = manifeste.plan;
  const titrePieces = manifeste.panoramas.length > 1 ? `${manifeste.panoramas.length} vues` : "1 vue";

  return (
    <div ref={racine} className="v360-racine" onKeyDown={clavier}>
      <div
        ref={scene}
        className="v360-scene"
        tabIndex={0}
        role="application"
        aria-label={`Panorama : ${courant.titre}. Glissez ou utilisez les flèches pour regarder autour.`}
      />

      {/* Repères vers les panoramas voisins */}
      <div className="v360-reperes" aria-label="Se déplacer">
        {pret && courant.liens.map((l) => (
          <button
            key={`${courant.id}-${l.vers}`}
            ref={(el) => { if (el) reperes.current.set(l.vers, el); else reperes.current.delete(l.vers); }}
            type="button"
            className="v360-repere"
            style={{ visibility: "hidden" }}
            onClick={() => void aller(l.vers, l)}
            aria-label={`Aller vers : ${l.libelle}`}
          >
            <span className="v360-repere-pastille" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <span className="v360-repere-libelle">{l.libelle}</span>
          </button>
        ))}
      </div>

      {/* En-tête */}
      <header className="v360-entete">
        <div className="v360-titre">
          <span className="v360-surtitre">Visite 360°</span>
          <h1>{manifeste.titre}</h1>
          <p className="v360-piece" aria-live="polite">
            {courant.titre}
            {!nette && pret && <Loader2 className="v360-tourne v360-mini" aria-label="Amélioration de la netteté" />}
          </p>
        </div>
        <nav className="v360-actions" aria-label="Commandes de la visite">
          <button type="button" className={`v360-bouton ${panneau === "pieces" ? "actif" : ""}`} onClick={() => setPanneau(panneau === "pieces" ? null : "pieces")} aria-expanded={panneau === "pieces"} title="Liste des pièces">
            <List aria-hidden="true" /><span className="v360-cache-mobile">Pièces</span>
          </button>
          {plan && (
            <button type="button" className={`v360-bouton ${panneau === "plan" ? "actif" : ""}`} onClick={() => setPanneau(panneau === "plan" ? null : "plan")} aria-expanded={panneau === "plan"} title="Plan">
              <IconePlan aria-hidden="true" /><span className="v360-cache-mobile">Plan</span>
            </button>
          )}
          {gyroPossible && (
            <button type="button" className={`v360-bouton ${gyro ? "actif" : ""}`} onClick={() => void basculerGyro()} aria-pressed={gyro} title="Regarder en bougeant le téléphone">
              <Smartphone aria-hidden="true" />
            </button>
          )}
          {pleinEcranPossible && (
            <button type="button" className="v360-bouton" onClick={() => void basculerPleinEcran()} title={pleinEcran ? "Quitter le plein écran" : "Plein écran"} aria-label={pleinEcran ? "Quitter le plein écran" : "Plein écran"}>
              {pleinEcran ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            </button>
          )}
        </nav>
      </header>

      {/* Panneaux */}
      {panneau === "pieces" && (
        <aside className="v360-panneau" aria-label="Pièces de la visite">
          <div className="v360-panneau-tete">
            <h2>Pièces <small>{titrePieces}</small></h2>
            <button type="button" className="v360-fermer" onClick={() => setPanneau(null)} aria-label="Fermer"><X aria-hidden="true" /></button>
          </div>
          {groupes.map((g) => (
            <section key={g.titre}>
              {groupes.length > 1 && <h3>{g.titre}</h3>}
              <ul>
                {g.panoramas.map((p) => (
                  <li key={p.id}>
                    <button type="button" className={`v360-piece-item ${p.id === courant.id ? "actif" : ""}`} onClick={() => void aller(p.id)} aria-current={p.id === courant.id ? "true" : undefined}>
                      {p.titre}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </aside>
      )}
      {panneau === "plan" && plan && (
        <aside className="v360-panneau v360-panneau-plan" aria-label="Plan">
          <div className="v360-panneau-tete">
            <h2>Plan{plan.niveaux.length > 1 ? <small>{courant.niveau === 0 ? "Rez-de-chaussée" : `Niveau ${courant.niveau}`}</small> : null}</h2>
            <button type="button" className="v360-fermer" onClick={() => setPanneau(null)} aria-label="Fermer"><X aria-hidden="true" /></button>
          </div>
          <div className="v360-plan">
            <img src={url(imagePlan(plan, courant.niveau))} alt={`Plan du niveau ${courant.niveau}`} draggable={false} />
            {plan.emprise_m && manifeste.panoramas.filter((p) => p.niveau === courant.niveau).map((p) => {
              const pos = positionSurPlan(p.position_m, plan.emprise_m!);
              if (pos.x < 0 || pos.x > 1 || pos.y < 0 || pos.y > 1) return null;
              const ici = p.id === courant.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`v360-plan-point ${ici ? "ici" : ""}`}
                  style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }}
                  onClick={() => void aller(p.id)}
                  aria-label={ici ? `Vous êtes ici : ${p.titre}` : `Aller vers : ${p.titre}`}
                  title={p.titre}
                >
                  {ici && <div ref={cone} className="v360-cone" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </aside>
      )}
      {panneau === "infos" && (
        <aside className="v360-panneau v360-panneau-infos" aria-label="Informations">
          <div className="v360-panneau-tete">
            <h2>À propos des images</h2>
            <button type="button" className="v360-fermer" onClick={() => setPanneau(null)} aria-label="Fermer"><X aria-hidden="true" /></button>
          </div>
          {manifeste.mentions.map((m) => <p key={m}>{m}.</p>)}
          {manifeste.elements_omis.length > 0 && (
            <>
              <h3>Éléments non représentés</h3>
              <p className="v360-note">Faute de modèle photoréaliste certifié, ces éléments ont été retirés des images plutôt que montrés en qualité dégradée :</p>
              <ul className="v360-omis">
                {manifeste.elements_omis.map((e) => (
                  <li key={`${e.categorie}-${e.raison}`}><strong>{e.categorie}</strong>{e.raison ? ` — ${e.raison}` : ""}</li>
                ))}
              </ul>
            </>
          )}
          <p className="v360-note">Glissez pour regarder autour, cliquez un repère pour avancer. Molette ou pincement : zoom.</p>
        </aside>
      )}

      {/* Boussole : le centre de chaque panorama regarde le nord du plan */}
      <button type="button" className="v360-boussole" onClick={() => visionneuse.current?.regarder(0, 0)} title="Regarder vers le nord" aria-label="Boussole : regarder vers le nord">
        <div ref={aiguille} className="v360-aiguille" aria-hidden="true">
          <span className="v360-nord">N</span>
          <svg viewBox="0 0 40 40" width="40" height="40"><path d="M20 5 L25 20 L20 17 L15 20 Z" fill="#e8553d" /><path d="M20 35 L25 20 L20 23 L15 20 Z" fill="currentColor" opacity=".55" /></svg>
        </div>
      </button>

      <footer className="v360-pied">
        <span className="v360-mentions-courtes">{manifeste.mentions[0]}</span>
        <button type="button" className="v360-lien-infos" onClick={() => setPanneau(panneau === "infos" ? null : "infos")} aria-expanded={panneau === "infos"}>
          <Info aria-hidden="true" />
          {manifeste.elements_omis.length > 0 ? `${manifeste.elements_omis.length} élément(s) non représenté(s)` : "Informations"}
        </button>
      </footer>

      {!pret && !erreurImage && (
        <div className="v360-voile" role="status" aria-live="polite">
          <Loader2 className="v360-tourne" aria-hidden="true" />
          <p>Chargement du panorama…</p>
        </div>
      )}
      {erreurImage && (
        <div className="v360-alerte" role="alert">
          <span>{erreurImage}</span>
          <button type="button" className="v360-fermer" onClick={() => setErreurImage(null)} aria-label="Fermer"><X aria-hidden="true" /></button>
        </div>
      )}
    </div>
  );
}
