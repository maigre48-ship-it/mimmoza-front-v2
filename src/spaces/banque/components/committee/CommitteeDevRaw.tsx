// src/spaces/banque/components/committee/CommitteeDevRaw.tsx
import React from "react";

export default function CommitteeDevRaw({
  operation,
}: {
  operation: any;
}) {
  if (!import.meta.env.DEV) return null;

  return (
    <details className="mt-3">
      <summary className="text-[10px] font-medium text-gray-400 cursor-pointer hover:text-gray-600">
        🔧 Données brutes comité (DEV)
      </summary>
      <div className="mt-2 space-y-2">
        <div>
          <p className="text-[10px] font-bold text-gray-400">committee</p>
          <pre className="text-[10px] text-gray-500 bg-gray-50 rounded p-2 overflow-x-auto max-h-[200px]">
            {JSON.stringify((operation as any)?.committee ?? null, null, 2)}
          </pre>
        </div>
        <div>
          <p className="text-[10px] font-bold text-gray-400">risks</p>
          <pre className="text-[10px] text-gray-500 bg-gray-50 rounded p-2 overflow-x-auto max-h-[200px]">
            {JSON.stringify(operation?.risks ?? null, null, 2)}
          </pre>
        </div>
        <div>
          <p className="text-[10px] font-bold text-gray-400">market</p>
          <pre className="text-[10px] text-gray-500 bg-gray-50 rounded p-2 overflow-x-auto max-h-[200px]">
            {JSON.stringify(operation?.market ?? null, null, 2)}
          </pre>
        </div>
        <div>
          <p className="text-[10px] font-bold text-gray-400">marketStudy</p>
          <pre className="text-[10px] text-gray-500 bg-gray-50 rounded p-2 overflow-x-auto max-h-[200px]">
            {JSON.stringify((operation as any)?.marketStudy ?? null, null, 2)}
          </pre>
        </div>
      </div>
    </details>
  );
}