// src/spaces/visite/VisiteInteractive.tsx
// =============================================================================
// VIS-69 — Visite interactive « bureau de vente » (panoramas Unreal pré-rendus).
//   * pastilles AU SOL pour avancer (repères flottants pour un changement de niveau) ;
//   * menu des pièces (Séjour, Chambre parentale, Salle de bain…), vues multiples par pièce ;
//   * mini-plan vectoriel : position du visiteur et cône de direction en temps réel ;
//   * bascule jour / nuit (second rendu Unreal, mêmes caméras) ;
//   * capture PNG légendée, partage par e-mail (mailto prérempli), impression d'une fiche ;
//   * plein écran, gyroscope et mise en page téléphone.
// Réutilise la visionneuse three.js existante (src/pages/visite/visionneuse.ts) sans la modifier.
// Données : visite-interactive.json (src/lib/visiteInteractive/metadonnees.ts).
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Camera, Info, Loader2, Mail, Map as IconePlan, Maximize2, Minimize2, Moon, Printer, Smartphone, Sun, X } from "lucide-react";
import { urlFichier, type ManifesteVisite } from "../../pages/visite/manifeste";
import { Visionneuse, estMobile } from "../../pages/visite/visionneuse";
import {
  aplatissementSol, echelleSol, entreeDuPanorama, imagesPour, libelleNiveau, lienMailto, lienPublic,
  nomCapture, type Ambiance, type Hotspot, type PanoramaInteractif, type VisiteInteractive as Visite,
} from "../../lib/visiteInteractive/metadonnees";
import { composerCapture, telecharger } from "../../lib/visiteInteractive/capture";
import MiniPlan from "./MiniPlan";
import "./visiteInteractive.css";

export interface VisiteInteractiveProps {
  readonly visite: Visite;
  readonly manifeste: ManifesteVisite;
  readonly dossier: string;
  readonly visiteId: string;
}

interface Fiche {
  readonly image: string;
  readonly panorama: PanoramaInteractif;
  readonly ambiance: Ambiance;
  readonly cap: number;
}

const INCLINAISON_INTERIEUR = -8;

/** VIS-71 (27/11/2026) — rendu de nuit cassé : aucune bascule jour / nuit dans la visite (repasser à true une fois réparé). */
const VISITE_NUIT_PROPOSEE: boolean = false;

export default function VisiteInteractive({ visite, manifeste, dossier, visiteId }: VisiteInteractiveProps) {
  const [recherche, setRecherche] = useSearchParams();
  const racine = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const visionneuse = useRef<Visionneuse | null>(null);
  const boutons = useRef(new Map<string, HTMLButtonElement>());
  const cone = useRef<SVGGElement>(null);
  const occupe = useRef(false);
  const demandeCapture = useRef<((dataUrl: string) => void) | null>(null);
  const parId = useMemo(() => new Map(visite.panoramas.map((p) => [p.id, p])), [visite]);
  const depart = parId.get(recherche.get("p") ?? "") ?? parId.get(visite.departConseille) ?? visite.panoramas[0];
  const [courant, setCourant] = useState<PanoramaInteractif>(depart);
  const courantRef = useRef(courant);
  // VIS-71 : la bascule « jour et nuit » n'est PAS proposée tant que le rendu de nuit est cassé (VISITE_NUIT_PROPOSEE).
  const nuitPossible = VISITE_NUIT_PROPOSEE && visite.ambiances.includes("nuit");
  const [ambiance, setAmbiance] = useState<Ambiance>(recherche.get("ambiance") === "nuit" && nuitPossible ? "nuit" : "jour");
  const ambianceRef = useRef(ambiance);
  const [pret, setPret] = useState(false);
  const [nette, setNette] = useState(false);
  const [niveauPlan, setNiveauPlan] = useState(depart.niveau);
  const [planOuvert, setPlanOuvert] = useState(() => !estMobile());
  const [infos, setInfos] = useState(false);
  const [pleinEcran, setPleinEcran] = useState(false);
  const [gyro, setGyro] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fiche, setFiche] = useState<Fiche | null>(null);
  const mobile = useMemo(() => estMobile(), []);
  const mouvementReduit = useMemo(() => typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false), []);
  const pleinEcranPossible = typeof document !== "undefined" &&
    !!(document.fullscreenEnabled || (document as unknown as { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled);
  const gyroPossible = mobile && typeof window !== "undefined" && "DeviceOrientationEvent" in window;
  const niveaux = useMemo(() => [...new Set(visite.panoramas.map((p) => p.niveau))].sort((a, b) => a - b), [visite]);
  const entree = entreeDuPanorama(visite, courant.id);
  const nuitIci = !!courant.images.nuit;

  const url = useCallback((nom: string) => urlFichier(dossier, nom), [dossier]);
  const imagesDe = useCallback((p: PanoramaInteractif, a: Ambiance) => imagesPour(p, a).images, []);

  // Pastilles, cône du plan et capture : à chaque image, sans rendu React.
  const suivre = useCallback(() => {
    const v = visionneuse.current;
    if (!v) return;
    const p = courantRef.current;
    for (const h of p.hotspots) {
      const el = boutons.current.get(h.vers);
      if (!el) continue;
      const pr = v.projeter(h.cap_deg, h.inclinaison_deg);
      el.style.transform = `translate(${pr.x.toFixed(1)}px, ${pr.y.toFixed(1)}px)`;
      el.style.visibility = pr.visible ? "visible" : "hidden";
    }
    const { cap } = v.orientation;
    const g = cone.current;
    if (g) {
      const t = g.getAttribute("transform") ?? "";
      g.setAttribute("transform", t.replace(/rotate\([^)]*\)/, `rotate(${cap.toFixed(1)})`));
    }
    const cb = demandeCapture.current;
    if (cb) {
      demandeCapture.current = null;
      try {
        cb(v.canvas.toDataURL("image/png"));
      } catch {
        setMessage("La capture n'a pas pu être réalisée sur ce navigateur.");
      }
    }
  }, []);

  // Visionneuse et premier panorama (aperçu puis pleine définition).
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
    const im = imagesDe(p, ambianceRef.current);
    v.regarder(p.cap_initial_deg, p.lieu === "interieur" ? INCLINAISON_INTERIEUR : 0, v.champConseille());
    (async () => {
      try {
        await v.afficher(url(im.apercu ?? im.image), { signal: ctrl.signal });
        setPret(true);
        if (im.apercu) await v.affiner(url(im.image), ctrl.signal);
        setNette(true);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setMessage("Le panorama n'a pas pu être chargé. Vérifiez votre connexion.");
      }
    })();
    return () => {
      ctrl.abort();
      v.detruire();
      visionneuse.current = null;
    };
  }, [url, suivre, imagesDe]);

  // Préchargement des voisins dans l'ambiance courante.
  useEffect(() => {
    for (const h of courant.hotspots) {
      const q = parId.get(h.vers);
      if (!q) continue;
      const im = imagesDe(q, ambiance);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = url(im.apercu ?? im.image);
    }
  }, [courant, ambiance, parId, url, imagesDe]);

  const majAdresse = useCallback((p: PanoramaInteractif, a: Ambiance) => {
    const suite = new URLSearchParams(recherche);
    suite.set("p", p.id);
    if (a === "nuit") suite.set("ambiance", "nuit");
    else suite.delete("ambiance");
    setRecherche(suite, { replace: true });
  }, [recherche, setRecherche]);

  const aller = useCallback(async (id: string, h?: Hotspot) => {
    const v = visionneuse.current;
    const cible = parId.get(id);
    if (!v || !cible || occupe.current || cible.id === courantRef.current.id) return;
    occupe.current = true;
    try {
      if (h && !mouvementReduit) await v.tourner(h.cap_deg, h.inclinaison_deg);
      const cap = h ? h.cap_deg : cible.cap_initial_deg;
      const incl = cible.lieu === "interieur" ? INCLINAISON_INTERIEUR : 0;
      if (!h) v.regarder(cap, incl, v.champConseille());
      setNette(false);
      const im = imagesDe(cible, ambianceRef.current);
      await v.afficher(url(im.apercu ?? im.image), { fondu: !mouvementReduit });
      courantRef.current = cible;
      setCourant(cible);
      setNiveauPlan(cible.niveau);
      if (h) {
        v.regarder(cap, incl);
        v.relacher(v.champConseille());
      }
      majAdresse(cible, ambianceRef.current);
      if (im.apercu) await v.affiner(url(im.image));
      setNette(true);
    } catch {
      setMessage("Ce panorama n'a pas pu être chargé. Réessayez.");
    } finally {
      occupe.current = false;
    }
  }, [parId, url, imagesDe, majAdresse, mouvementReduit]);

  const changerAmbiance = useCallback(async (a: Ambiance) => {
    const v = visionneuse.current;
    if (!v || a === ambianceRef.current || occupe.current) return;
    occupe.current = true;
    ambianceRef.current = a;
    setAmbiance(a);
    try {
      const p = courantRef.current;
      const im = imagesDe(p, a);
      setNette(false);
      await v.afficher(url(im.apercu ?? im.image), { fondu: !mouvementReduit });
      majAdresse(p, a);
      if (im.apercu) await v.affiner(url(im.image));
      setNette(true);
      if (a === "nuit" && !p.images.nuit) setMessage("Cette vue n'a pas encore de rendu de nuit : elle reste en ambiance jour.");
    } catch {
      setMessage("L'ambiance n'a pas pu être chargée. Réessayez.");
    } finally {
      occupe.current = false;
    }
  }, [url, imagesDe, majAdresse, mouvementReduit]);

  /** Image de la vue courante (data URL PNG), lue juste après le prochain rendu. */
  const lireVue = useCallback(() => new Promise<string>((ok, ko) => {
    if (!visionneuse.current) return ko(new Error("visionneuse absente"));
    demandeCapture.current = ok;
    window.setTimeout(() => ko(new Error("délai")), 2000);
  }), []);

  const capturer = async () => {
    try {
      const png = await composerCapture(await lireVue(), {
        titre: visite.titre, piece: courant.titre, ambiance: imagesPour(courant, ambiance).ambiance, mention: visite.mentions[0] ?? "Images de synthèse non contractuelles",
      });
      telecharger(png, nomCapture(visite.titre, courant.titre, imagesPour(courant, ambiance).ambiance));
      setMessage("Capture enregistrée dans vos téléchargements.");
    } catch {
      setMessage("La capture n'a pas pu être réalisée.");
    }
  };

  const lien = lienPublic(typeof window !== "undefined" ? window.location.origin : "https://mimmoza.fr", visiteId, courant.id, ambiance);

  const imprimer = async () => {
    try {
      const image = await lireVue();
      setFiche({ image, panorama: courant, ambiance: imagesPour(courant, ambiance).ambiance, cap: visionneuse.current?.orientation.cap ?? 0 });
    } catch {
      setMessage("L'impression n'a pas pu être préparée.");
    }
  };
  useEffect(() => {
    if (!fiche) return;
    const fin = () => setFiche(null);
    window.addEventListener("afterprint", fin, { once: true });
    const t = window.setTimeout(() => window.print(), 120);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("afterprint", fin);
    };
  }, [fiche]);

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
      /* refusé par le navigateur */
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
    if (!ok) setMessage("Le mouvement du téléphone n'est pas autorisé : faites glisser votre doigt pour regarder autour.");
  };

  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(() => setMessage(null), 4200);
    return () => window.clearTimeout(t);
  }, [message]);

  const clavier = (e: KeyboardEvent) => {
    const v = visionneuse.current;
    if (!v) return;
    const pas: Record<string, [number, number]> = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] };
    if (pas[e.key]) {
      e.preventDefault();
      v.pivoter(pas[e.key][0], pas[e.key][1]);
    } else if (e.key === "+" || e.key === "=") v.zoomer(-5);
    else if (e.key === "-") v.zoomer(5);
    else if (e.key === "Escape") setInfos(false);
  };

  const vues = entree && entree.panoramas.length > 1 ? entree.panoramas : [];

  return (
    <div ref={racine} className={`vi-racine ${ambiance === "nuit" ? "vi-nuit" : ""} ${fiche ? "vi-impression-en-cours" : ""}`} onKeyDown={clavier}>
      <div
        ref={scene}
        className="vi-scene"
        tabIndex={0}
        role="application"
        aria-label={`Vue 360° : ${courant.titre}. Glissez ou utilisez les flèches pour regarder autour.`}
      />

      {/* Pastilles au sol et repères */}
      <div className="vi-hotspots" aria-label="Se déplacer">
        {pret && courant.hotspots.map((h) => (
          <button
            key={`${courant.id}-${h.vers}`}
            ref={(el) => { if (el) boutons.current.set(h.vers, el); else boutons.current.delete(h.vers); }}
            type="button"
            className={`vi-hotspot ${h.mode === "sol" ? "vi-hotspot-sol" : "vi-hotspot-repere"}`}
            style={{ visibility: "hidden" }}
            onClick={() => void aller(h.vers, h)}
            aria-label={`Aller vers : ${h.libelle}`}
          >
            {h.mode === "sol" ? (
              <span className="vi-sol" aria-hidden="true" style={{ transform: `translate(-50%, -50%) scale(${echelleSol(h.distance_m).toFixed(2)}, ${(echelleSol(h.distance_m) * aplatissementSol(h.inclinaison_deg)).toFixed(2)})` }}>
                <span className="vi-sol-anneau" />
                <span className="vi-sol-coeur" />
              </span>
            ) : (
              <span className="vi-repere" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
            )}
            <span className="vi-hotspot-libelle">{h.libelle}</span>
          </button>
        ))}
      </div>

      {/* En-tête : titre et pièce */}
      <header className="vi-entete">
        <div className="vi-titre">
          <span className="vi-surtitre">Visite privée · 360°</span>
          <h1>{visite.titre}</h1>
          <p className="vi-piece" aria-live="polite">
            {courant.titre}
            <span className="vi-niveau">{libelleNiveau(courant.niveau)}</span>
            {!nette && pret && <Loader2 className="vi-tourne vi-mini" aria-label="Amélioration de la netteté" />}
          </p>
        </div>

        {/* Commandes : un bouton par action */}
        <nav className="vi-actions" aria-label="Commandes de la visite">
          {nuitPossible && (
            <div className="vi-bascule" role="group" aria-label="Ambiance">
              <button type="button" className={`vi-bouton ${ambiance === "jour" ? "actif" : ""}`} aria-pressed={ambiance === "jour"} onClick={() => void changerAmbiance("jour")} title="Ambiance jour">
                <Sun aria-hidden="true" /><span className="vi-libelle">Jour</span>
              </button>
              <button type="button" className={`vi-bouton ${ambiance === "nuit" ? "actif" : ""}`} aria-pressed={ambiance === "nuit"} onClick={() => void changerAmbiance("nuit")}
                title={nuitIci ? "Ambiance nuit, lumières allumées" : "Ambiance nuit (pas encore rendue pour cette vue)"}>
                <Moon aria-hidden="true" /><span className="vi-libelle">Nuit</span>
              </button>
            </div>
          )}
          <button type="button" className="vi-bouton" onClick={() => void capturer()} title="Enregistrer une capture (PNG)">
            <Camera aria-hidden="true" /><span className="vi-libelle">Capture</span>
          </button>
          <a className="vi-bouton" href={lienMailto(visite.titre, courant.titre, lien)} title="Envoyer la visite par e-mail">
            <Mail aria-hidden="true" /><span className="vi-libelle">E-mail</span>
          </a>
          <button type="button" className="vi-bouton" onClick={() => void imprimer()} title="Imprimer une fiche (vue et plan)">
            <Printer aria-hidden="true" /><span className="vi-libelle">Imprimer</span>
          </button>
          <button type="button" className={`vi-bouton ${planOuvert ? "actif" : ""}`} aria-pressed={planOuvert} onClick={() => setPlanOuvert((x) => !x)} title={planOuvert ? "Masquer le plan" : "Afficher le plan"}>
            <IconePlan aria-hidden="true" /><span className="vi-libelle">Plan</span>
          </button>
          {gyroPossible && (
            <button type="button" className={`vi-bouton ${gyro ? "actif" : ""}`} aria-pressed={gyro} onClick={() => void basculerGyro()} title="Regarder en bougeant le téléphone">
              <Smartphone aria-hidden="true" /><span className="vi-libelle">Gyroscope</span>
            </button>
          )}
          {pleinEcranPossible && (
            <button type="button" className={`vi-bouton ${pleinEcran ? "actif" : ""}`} aria-pressed={pleinEcran} onClick={() => void basculerPleinEcran()} title={pleinEcran ? "Quitter le plein écran" : "Plein écran"}>
              {pleinEcran ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}<span className="vi-libelle">Plein écran</span>
            </button>
          )}
        </nav>
      </header>

      {/* Mini-plan */}
      {planOuvert && (
        <aside className="vi-plan" aria-label="Plan du logement">
          <div className="vi-plan-tete">
            <h2>Plan</h2>
            {niveaux.length > 1 && (
              <div className="vi-niveaux" role="group" aria-label="Niveau affiché">
                {niveaux.map((n) => (
                  <button key={n} type="button" className={`vi-puce ${n === niveauPlan ? "actif" : ""}`} aria-pressed={n === niveauPlan} onClick={() => setNiveauPlan(n)}>
                    {n === 0 ? "Extérieur" : libelleNiveau(n)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="vi-plan-corps">
            <MiniPlan key={`${niveauPlan}-${courant.id}`} visite={visite} niveau={niveauPlan} courant={courant} cote={mobile ? 220 : 280}
              cone={cone} cap={visionneuse.current?.orientation.cap ?? courant.cap_initial_deg} surPoint={(id) => void aller(id)} />
          </div>
          <p className="vi-plan-legende"><span className="vi-point-ici" aria-hidden="true" /> Vous êtes ici · le cône indique la direction du regard</p>
        </aside>
      )}

      {/* Menu des pièces */}
      <nav className="vi-menu" aria-label="Pièces">
        <ul>
          {visite.menu.map((m) => {
            const ici = m.panoramas.includes(courant.id);
            return (
              <li key={`${m.piece ?? "ext"}-${m.titre}`}>
                <button type="button" className={`vi-piece-bouton ${ici ? "actif" : ""}`} aria-current={ici ? "true" : undefined} onClick={() => void aller(m.panoramas[0])}>
                  {m.titre}
                </button>
              </li>
            );
          })}
        </ul>
        {vues.length > 0 && (
          <div className="vi-vues" role="group" aria-label={`Points de vue : ${entree?.titre ?? ""}`}>
            {vues.map((id, i) => (
              <button key={id} type="button" className={`vi-puce ${id === courant.id ? "actif" : ""}`} aria-pressed={id === courant.id} onClick={() => void aller(id)}>
                {parId.get(id)?.titre !== entree?.titre ? parId.get(id)?.titre : `Vue ${i + 1}`}
              </button>
            ))}
          </div>
        )}
      </nav>

      <footer className="vi-pied">
        <span>{visite.mentions[0]}</span>
        <button type="button" className={`vi-lien ${infos ? "actif" : ""}`} onClick={() => setInfos((x) => !x)} aria-expanded={infos}>
          <Info aria-hidden="true" /> Informations
        </button>
      </footer>

      {infos && (
        <aside className="vi-infos" aria-label="Informations">
          <div className="vi-infos-tete">
            <h2>À propos de cette visite</h2>
            <button type="button" className="vi-fermer" onClick={() => setInfos(false)} aria-label="Fermer"><X aria-hidden="true" /></button>
          </div>
          {visite.mentions.map((m) => <p key={m}>{m}.</p>)}
          <p>Glissez pour regarder autour, cliquez une pastille au sol pour avancer, choisissez une pièce dans le menu ou sur le plan. Molette ou pincement : zoom.</p>
          {manifeste.elements_omis.length > 0 && (
            <>
              <h3>Éléments non représentés</h3>
              <ul>
                {manifeste.elements_omis.map((e) => <li key={`${e.categorie}-${e.raison}`}><strong>{e.categorie}</strong>{e.raison ? ` — ${e.raison}` : ""}</li>)}
              </ul>
            </>
          )}
        </aside>
      )}

      {!pret && !message && (
        <div className="vi-voile" role="status" aria-live="polite">
          <Loader2 className="vi-tourne" aria-hidden="true" />
          <p>Chargement de la visite…</p>
        </div>
      )}
      {message && (
        <div className="vi-message" role="status" aria-live="polite">
          <span>{message}</span>
          <button type="button" className="vi-fermer" onClick={() => setMessage(null)} aria-label="Fermer"><X aria-hidden="true" /></button>
        </div>
      )}

      {/* Fiche imprimée : seule visible à l'impression */}
      {fiche && (
        <section className="vi-fiche" aria-hidden="true">
          <header>
            <span className="vi-surtitre">Visite 360° · fiche</span>
            <h1>{visite.titre}</h1>
            <p>{fiche.panorama.titre} · {libelleNiveau(fiche.panorama.niveau)} · {fiche.ambiance === "nuit" ? "ambiance nuit" : "ambiance jour"}</p>
          </header>
          <img src={fiche.image} alt="" />
          <div className="vi-fiche-bas">
            <div className="vi-fiche-plan">
              <MiniPlan visite={visite} niveau={fiche.panorama.niveau} courant={fiche.panorama} cote={300} interactif={false} cap={fiche.cap} />
            </div>
            <div className="vi-fiche-texte">
              <h2>Pièces de la visite</h2>
              <ul>
                {visite.pieces.filter((p) => p.niveau === fiche.panorama.niveau && p.surface_m2 >= 1).map((p) => (
                  <li key={p.id}>{p.titre}{p.surface_m2 ? ` — ${p.surface_m2.toLocaleString("fr-FR")} m² (plan)` : ""}</li>
                ))}
              </ul>
              <p className="vi-fiche-lien">Visite en ligne : {lien}</p>
              <p className="vi-fiche-mention">{visite.mentions[0]}. Surfaces indicatives issues du plan d'étude.</p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

