import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({
  path: "C:/Users/maigr/OneDrive/Bureau/supabase-backend/.env",
});

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("❌ SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant dans C:/Users/maigr/OneDrive/Bureau/supabase-backend/.env");
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

type GeoCommune = {
  nom: string;
  code: string;
  population?: number;
};

type EpciRow = {
  code: string;
  nom: string;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} — ${url}`);
  }

  return res.json() as Promise<T>;
}

async function main() {
  console.log("📦 Récupération des EPCI depuis geo.api.gouv.fr...");

  const epcis = await fetchJson<EpciRow[]>(
    "https://geo.api.gouv.fr/epcis?fields=code,nom&format=json"
  );

  console.log(`➡️ ${epcis.length} EPCI trouvés`);

  let totalCommunes = 0;

  for (const epci of epcis) {
    try {
      console.log(`\n🏛️ ${epci.nom} (${epci.code})`);

      const communes = await fetchJson<GeoCommune[]>(
        `https://geo.api.gouv.fr/epcis/${epci.code}/communes?fields=nom,code,population&format=json`
      );

      const rows = communes.map((commune) => ({
        code_insee: commune.code,
        nom_commune: commune.nom,
        code_epci: epci.code,
        nom_epci: epci.nom,
        population: commune.population ?? null,
      }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from("epci_communes")
          .upsert(rows, {
            onConflict: "code_insee,code_epci",
          });

        if (error) {
          console.error("❌ Supabase error:", error.message);
        } else {
          totalCommunes += rows.length;
          console.log(`✅ ${rows.length} communes importées`);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 80));
    } catch (err) {
      console.error(`❌ Erreur EPCI ${epci.code}:`, err);
    }
  }

  console.log(`\n🎯 Import terminé — ${totalCommunes} lignes commune/EPCI traitées`);
}

main();