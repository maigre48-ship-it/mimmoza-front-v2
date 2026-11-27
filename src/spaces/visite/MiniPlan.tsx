// src/spaces/visite/MiniPlan.tsx
// =============================================================================
// VIS-69 — Mini-plan vectoriel du logement (SVG, nord en haut) : pièces avec leur
// nom, emprise du bâtiment, points de vue cliquables, position du visiteur et cône
// de direction. Le cône est tourné à chaque image par la visionneuse (ref `cone`),
// sans rendu React. Sert aussi, sans interaction, dans la fiche imprimée.
// =============================================================================

import type { Ref } from "react";
import { cadreNiveau, cadreSvg, centroide, type PanoramaInteractif, type VisiteInteractive } from "../../lib/visiteInteractive/metadonnees";

const TEINTES: Record<string, string> = {
  sejour: "#efe6d6", cuisine: "#ece4d3", chambre: "#e3e9f1", "salle-de-bain": "#dcebee", "salle-d-eau": "#dcebee",
  entree: "#eeebe6", degagement: "#f1efeb", wc: "#e6eef0", rangement: "#efede9", bureau: "#e8e4ef",
  terrasse: "#e2ecda", balcon: "#e2ecda", loggia: "#e2ecda",
};

export interface MiniPlanProps {
  readonly visite: VisiteInteractive;
  readonly niveau: number;
  readonly courant: PanoramaInteractif;
  readonly cote?: number;
  readonly interactif?: boolean;
  readonly cone?: Ref<SVGGElement>;
  /** Cap initial du cône (fiche imprimée : cap au moment de la capture). */
  readonly cap?: number;
  readonly surPoint?: (id: string) => void;
}

export default function MiniPlan({ visite, niveau, courant, cote = 300, interactif = true, cone, cap = 0, surPoint }: MiniPlanProps) {
  const cadre = cadreNiveau(visite, niveau);
  const c = cadreSvg(cadre, cote);
  const pts = (poly: readonly (readonly [number, number])[]) => poly.map(([x, y]) => c.vers(x, y).map((v) => v.toFixed(1)).join(",")).join(" ");
  const pieces = visite.pieces.filter((p) => p.niveau === niveau);
  const panos = visite.panoramas.filter((p) => p.niveau === niveau);
  const ici = courant.niveau === niveau ? c.vers(courant.position_m[0], courant.position_m[1]) : null;
  const echelleTexte = Math.max(9, Math.min(12, cote / 28));
  return (
    <svg
      className="vi-plan-svg"
      viewBox={`0 0 ${c.largeur.toFixed(1)} ${c.hauteur.toFixed(1)}`}
      width={c.largeur}
      height={c.hauteur}
      role="img"
      aria-label={`Plan du logement, ${courant.niveau === niveau ? `vous êtes dans : ${courant.titre}` : "autre niveau"}`}
    >
      {visite.emprise_batiment_m.length >= 3 && (
        <polygon points={pts(visite.emprise_batiment_m)} fill={pieces.length ? "#fbfaf8" : "#f4f2ee"} stroke="#94a3b8" strokeWidth={pieces.length ? 1 : 2} />
      )}
      {pieces.map((p) => {
        const active = p.panoramas.includes(courant.id);
        return (
          <polygon
            key={p.id}
            points={pts(p.polygone_m)}
            fill={active ? "#dbeafe" : TEINTES[p.fonction] ?? "#f1efeb"}
            stroke="#475569"
            strokeWidth={active ? 2 : 1.2}
            strokeLinejoin="round"
          />
        );
      })}
      {pieces.filter((p) => p.surface_m2 >= 4).map((p) => {
        const [x, y] = c.vers(...centroide(p.polygone_m));
        // Nom sur deux lignes quand il déborde de la pièce (« Chambre / parentale »).
        const xs = p.polygone_m.map(([px, py]) => c.vers(px, py)[0]);
        const largeur = Math.max(...xs) - Math.min(...xs);
        const mots = p.titre.split(" ");
        const lignes = mots.length > 1 && p.titre.length * echelleTexte * 0.56 > largeur * 0.9
          ? [mots.slice(0, Math.ceil(mots.length / 2)).join(" "), mots.slice(Math.ceil(mots.length / 2)).join(" ")] : [p.titre];
        // Le nom ne recouvre pas le point de vue de la pièce : il passe sous le point.
        const point = panos.find((q) => p.panoramas.includes(q.id));
        const [, py] = point ? c.vers(point.position_m[0], point.position_m[1]) : [x, -1e9];
        const yNom = Math.abs(py - y) < 16 ? py + 18 : y;
        return (
          <text key={`t-${p.id}`} x={x} y={yNom - (lignes.length - 1) * echelleTexte * 0.55} className="vi-plan-texte" fontSize={echelleTexte} textAnchor="middle" dominantBaseline="middle">
            {lignes.map((l, i) => <tspan key={l} x={x} dy={i === 0 ? 0 : echelleTexte * 1.1}>{l}</tspan>)}
          </text>
        );
      })}
      {ici && (
        <g ref={cone} transform={`translate(${ici[0].toFixed(1)} ${ici[1].toFixed(1)}) rotate(${cap.toFixed(1)})`} aria-hidden="true">
          <path d="M0 0 L-17 -38 A42 42 0 0 1 17 -38 Z" fill="url(#vi-cone)" />
        </g>
      )}
      <defs>
        <linearGradient id="vi-cone" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#2563eb" stopOpacity="0.55" />
          <stop offset="1" stopColor="#2563eb" stopOpacity="0" />
        </linearGradient>
      </defs>
      {panos.map((p) => {
        const [x, y] = c.vers(p.position_m[0], p.position_m[1]);
        const estIci = p.id === courant.id;
        const contenu = (
          <>
            <circle cx={x} cy={y} r={estIci ? 7 : 5.5} fill={estIci ? "#1d4ed8" : "#ffffff"} stroke={estIci ? "#ffffff" : "#1e3a8a"} strokeWidth={2} />
            {estIci && <circle cx={x} cy={y} r={12} fill="none" stroke="#1d4ed8" strokeOpacity={0.35} strokeWidth={2} />}
          </>
        );
        if (!interactif || !surPoint || estIci) return <g key={p.id}>{contenu}</g>;
        return (
          <g key={p.id} className="vi-plan-point" role="button" tabIndex={0} aria-label={`Aller vers : ${p.titre}`}
            onClick={() => surPoint(p.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); surPoint(p.id); } }}>
            <title>{p.titre}</title>
            <circle cx={x} cy={y} r={14} fill="transparent" />
            {contenu}
          </g>
        );
      })}
    </svg>
  );
}
