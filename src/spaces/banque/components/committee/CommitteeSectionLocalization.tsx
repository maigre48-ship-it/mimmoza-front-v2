// src/spaces/banque/components/committee/CommitteeSectionLocalization.tsx
import React from "react";

export default function CommitteeSectionLocalization({
  operation,
}: {
  operation: any;
}) {
  // Robust getters — try multiple paths
  const lat =
    operation?.project?.lat ??
    operation?.location?.lat ??
    (operation as any)?.lat ??
    null;

  const lng =
    operation?.project?.lng ??
    operation?.location?.lng ??
    (operation as any)?.lng ??
    null;

  const address =
    operation?.project?.address ??
    operation?.location?.address ??
    (operation as any)?.address ??
    null;

  const communeInsee =
    operation?.project?.communeInsee ??
    operation?.location?.communeInsee ??
    operation?.market?.commune?.codeInsee ??
    (operation as any)?.communeInsee ??
    null;

  const communeNom =
    operation?.market?.commune?.nom ??
    operation?.project?.commune ??
    operation?.location?.commune ??
    null;

  const hasAnyData = lat != null || lng != null || address || communeInsee || communeNom;

  const items: { label: string; value: string }[] = [];
  if (address) items.push({ label: "Adresse", value: address });
  if (communeNom) items.push({ label: "Commune", value: communeNom });
  if (communeInsee) items.push({ label: "Code INSEE", value: String(communeInsee) });
  if (lat != null) items.push({ label: "Latitude", value: String(lat) });
  if (lng != null) items.push({ label: "Longitude", value: String(lng) });

  return (
    <details className="group">
      <summary className="flex items-center justify-between cursor-pointer py-2 px-3 rounded-lg hover:bg-gray-50 transition-colors">
        <span className="text-sm font-semibold text-gray-900">📍 Localisation</span>
        <span className="text-xs text-gray-400 group-open:rotate-90 transition-transform">▶</span>
      </summary>

      <div className="mt-2 pl-1">
        {!hasAnyData ? (
          <p className="text-sm text-gray-400 italic">Non disponible</p>
        ) : (
          <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
            {items.map((it, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-gray-500">{it.label}</span>
                <span className="text-gray-800 font-medium text-right max-w-[60%] truncate">{it.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}