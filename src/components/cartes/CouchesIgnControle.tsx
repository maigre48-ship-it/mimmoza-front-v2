// src/components/cartes/CouchesIgnControle.tsx
//
// Contrôle react-leaflet des couches IGN : à placer DANS un <MapContainer>, à
// la place de l'ancien <TileLayer> du Plan IGN.
//
//   <MapContainer …>
//     <CouchesIgnControle contexte="parcelle" />
//     …
//   </MapContainer>
//
// Il installe le fond (Satellite ou Plan), la couche Cadastre et le contrôle
// (bascule Satellite / Plan, case Cadastre, curseur d'opacité), mémorise le
// choix par utilisateur et se replie sur le Plan si l'ortho IGN ne répond pas.
// Implémentation commune avec les cartes Leaflet « direct » :
// installerCouchesIgn (couchesIgnLeaflet.ts).

import type { ControlPosition } from "leaflet";
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import type { ContexteCarte } from "@/lib/cartes/couchesIgn";
import { installerCouchesIgn } from "./couchesIgnLeaflet";

type Props = {
  /** « parcelle » : Satellite + Cadastre par défaut ; « thematique » : Plan. */
  contexte?: ContexteCarte;
  position?: ControlPosition;
  /** Appelé à chaque tuile du fond Plan en échec. */
  onErreurFond?: () => void;
};

export function CouchesIgnControle({ contexte = "parcelle", position = "topleft", onErreurFond }: Props) {
  const map = useMap();
  const onErreurFondRef = useRef(onErreurFond);
  useEffect(() => { onErreurFondRef.current = onErreurFond; }, [onErreurFond]);

  useEffect(() => {
    const couches = installerCouchesIgn(map, {
      contexte,
      position,
      onErreurFond: () => onErreurFondRef.current?.(),
    });
    return () => couches.detruire();
  }, [map, contexte, position]);

  return null;
}

export default CouchesIgnControle;
