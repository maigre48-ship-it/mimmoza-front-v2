// src/spaces/promoteur/synthese/SyntheseStartPage.tsx
import React, { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { scanStorages, type ModuleFound } from "./storageDiscovery";
import { generateSynthese } from "./syntheseApi";
import type { SynthesePayload } from "./syntheseTypes";

type Props = {
  supabase: SupabaseClient;
  parcelId: string;
  communeInsee?: string | null;
};

function Badge({ found }: { found: ModuleFound }) {
  const label = found.status === "FOUND" ? "TROUVÉ" : found.status === "EMPTY" ? "VIDE" : "INCONNU";
  const cls =
    found.status === "FOUND"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : found.status === "EMPTY"
      ? "bg-red-50 text-red-800 border-red-200"
      : "bg-slate-50 text-slate-800 border-slate-200";

  return <span className={`text-xs px-2 py-1 rounded-full border ${cls}`}>{label}</span>;
}

function ModuleRow({ title, found }: { title: string; found: ModuleFound }) {
  return (
    <div className="flex items-start justify-between gap-4 p-4 rounded-xl border bg-white">
      <div className="min-w-0">
        <div className="font-semibold text-slate-900">{title}</div>
        <div className="text-sm text-slate-600 mt-1">
          {found.status === "FOUND" ? (
            <>
              <div>
                Clé trouvée : <span className="font-mono text-xs">{found.key}</span> ({found.source})
              </div>
              {typeof found.bytes === "number" && <div>Taille : {found.bytes} bytes</div>}
              {found.reason && <div className="text-amber-700 mt-1">{found.reason}</div>}
            </>
          ) : (
            <div>Clé trouvée : (aucune)</div>
          )}
        </div>
      </div>
      <div className="shrink-0">
        <Badge found={found} />
      </div>
    </div>
  );
}

function buildPayload(
  parcelId: string,
  communeInsee: string | null | undefined,
  discovered: ReturnType<typeof scanStorages>
): SynthesePayload {
  // IMPORTANT: permissif, tout est optionnel.
  return {
    parcel_id: parcelId,
    commune_insee: communeInsee ?? undefined,

    marche: discovered.market.status === "FOUND" ? (discovered.market.value ?? discovered.market.rawText) : undefined,
    risques: discovered.risques.status === "FOUND" ? (discovered.risques.value ?? discovered.risques.rawText) : undefined,
    bilan: discovered.bilan.status === "FOUND" ? (discovered.bilan.value ?? discovered.bilan.rawText) : undefined,
    implantation_2d:
      discovered.implantation.status === "FOUND"
        ? (discovered.implantation.value ?? discovered.implantation.rawText)
        : undefined,
    terrain_3d:
      discovered.terrain3d.status === "FOUND"
        ? (discovered.terrain3d.value ?? discovered.terrain3d.rawText)
        : undefined,
  } as any;
}

export const SyntheseStartPage: React.FC<Props> = ({ supabase, parcelId, communeInsee }) => {
  const discovered = useMemo(() => scanStorages(parcelId), [parcelId]);

  const [loading, setLoading] = useState(false);
  const [markdown, setMarkdown] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [showDebug, setShowDebug] = useState(false);

  const anyFound =
    discovered.market.status === "FOUND" ||
    discovered.risques.status === "FOUND" ||
    discovered.bilan.status === "FOUND" ||
    discovered.implantation.status === "FOUND" ||
    discovered.terrain3d.status === "FOUND";

  async function onGenerate() {
    setError("");
    setMarkdown("");
    setLoading(true);
    try {
      const payload = buildPayload(parcelId, communeInsee, discovered);

      const res = await generateSynthese({
        supabase,
        payload,
        options: {
          // garde tes defaults côté prompts si tu en as
        },
      });

      setMarkdown(res.markdown ?? "");

      // Cache "Synthèse only" (ne touche aucun module)
      try {
        sessionStorage.setItem(`promoteur:synthese:${parcelId}`, JSON.stringify(res));
      } catch {
        // ignore
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Synthèse Promoteur – point de départ</h1>
          <p className="text-slate-600 mt-1">
            Vue consolidée (lecture seule) des résultats déjà produits par les modules.
          </p>
        </div>

        <button
          onClick={onGenerate}
          disabled={loading || !anyFound}
          className={`px-4 py-2 rounded-xl font-semibold border ${
            loading || !anyFound
              ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
              : "bg-slate-900 text-white border-slate-900 hover:bg-slate-800"
          }`}
        >
          {loading ? "Génération..." : "Générer la synthèse"}
        </button>
      </div>

      {!anyFound && (
        <div className="mt-5 p-4 rounded-xl border bg-amber-50 text-amber-900">
          Aucune donnée modules trouvée. Ouvre d’abord Marché / Risques / Terrain 3D / Implantation 2D / Bilan pour qu’ils produisent leurs résultats,
          puis reviens ici. (Cette page n’écrit rien dans les modules.)
        </div>
      )}

      <div className="mt-6 grid gap-3">
        <ModuleRow title="Marché — DVF / prix / tension" found={discovered.market} />
        <ModuleRow title="Risques — PPR / radon / etc." found={discovered.risques} />
        <ModuleRow title="Bilan — Coûts / CA / marge" found={discovered.bilan} />
        <ModuleRow title="Implantation 2D — Surfaces / conformité PLU" found={discovered.implantation} />
        <ModuleRow title="Terrain 3D — Altitudes / pente / volumes" found={discovered.terrain3d} />
      </div>

      <div className="mt-6">
        <button onClick={() => setShowDebug((v) => !v)} className="text-sm text-slate-700 underline">
          {showDebug ? "Masquer" : "Afficher"} diagnostic storage (debug)
        </button>

        {showDebug && (
          <div className="mt-3 p-4 rounded-xl border bg-white">
            <div className="text-sm text-slate-700 mb-2">
              Candidats détectés (session/local). Utile pour identifier les vraies clés existantes sans rien modifier.
            </div>
            <div className="max-h-72 overflow-auto text-xs font-mono">
              {discovered.candidates.map((c, idx) => (
                <div key={idx} className="py-1 border-b last:border-b-0">
                  [{c.source}] {c.key} — {c.bytes} bytes — parsed:{String(c.parsed)} — parcel:{String(c.containsParcelId)} — hints:{c.hints.join(",")}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-6 p-4 rounded-xl border bg-red-50 text-red-900">
          Erreur : {error}
        </div>
      )}

      {markdown && (
        <div className="mt-6 p-5 rounded-xl border bg-white">
          <div className="text-sm text-slate-500 mb-2">Résultat synthèse</div>
          {/* Si ton markdown est déjà HTML (comme dans ton backend), OK. Sinon, remplace par un renderer markdown. */}
          <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: markdown }} />
        </div>
      )}
    </div>
  );
};
