// src/components/cartes/SurlignageParcelles.tsx
//
// Surlignage react-leaflet de la (des) parcelle(s) recherchée(s) /
// sélectionnée(s) : contour violet épais avec halo blanc, remplissage léger,
// dans un pane dédié AU-DESSUS des tuiles et des parcelles cliquables, sans
// jamais capter les clics ni les survols (les comportements existants de
// sélection restent intacts).
//
// Recadrage : uniquement quand `cleRecadrage` change (nouvelle parcelle
// cible), sur l'emprise de `featuresRecadrage` (par défaut : `features`).
// Un clic de sélection multiple ne fait donc jamais sauter la carte.
//
// Penser à mémoïser `features` (useMemo) : chaque nouvelle référence redessine
// le surlignage.

import type { Feature } from "geojson";
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import { creerSurlignageParcelles, type SurlignageParcelles as Surlignage } from "./couchesIgnLeaflet";

type Props = {
  features: ReadonlyArray<Feature>;
  cleRecadrage?: string | null;
  featuresRecadrage?: ReadonlyArray<Feature> | null;
};

export function SurlignageParcelles({ features, cleRecadrage = null, featuresRecadrage = null }: Props) {
  const map = useMap();
  const surlignageRef = useRef<Surlignage | null>(null);

  useEffect(() => {
    const s = creerSurlignageParcelles(map);
    surlignageRef.current = s;
    return () => {
      s.detruire();
      if (surlignageRef.current === s) surlignageRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    surlignageRef.current?.maj(
      features,
      cleRecadrage ? { cle: cleRecadrage, features: featuresRecadrage ?? features } : null,
    );
  }, [map, features, cleRecadrage, featuresRecadrage]);

  return null;
}

export default SurlignageParcelles;
