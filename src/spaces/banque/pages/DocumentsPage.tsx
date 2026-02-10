// pages/DocumentsPage.tsx

import React, { useMemo } from 'react';
import { useDossierCommittee } from '../context/DossierCommitteeContext';
import type { RequiredDoc } from '../types/committee-workflow';

// ─── Sub-components ──────────────────────────

function CompletenessBar({ value }: { value: number }) {
  const color = value >= 80 ? '#10b981' : value >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500 ease-out"
        style={{ width: `${Math.min(value, 100)}%`, backgroundColor: color }}
      />
    </div>
  );
}

interface DocRowProps {
  doc: RequiredDoc;
  isReceived: boolean;
  receivedAt: string | null;
  onReceive: () => void;
  onRemove: () => void;
}

function DocRow({ doc, isReceived, receivedAt, onReceive, onRemove }: DocRowProps) {
  return (
    <div
      className={`flex items-center justify-between px-4 py-3 rounded-lg border transition-all duration-200 ${
        isReceived
          ? 'bg-green-50 border-green-200'
          : 'bg-red-50 border-red-200'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className={`text-lg ${isReceived ? 'text-green-600' : 'text-gray-400'}`}>
          {isReceived ? '✓' : '○'}
        </span>
        <div>
          <div className="text-sm font-semibold text-gray-900">{doc.label}</div>
          {isReceived && receivedAt && (
            <div className="text-xs text-gray-500 mt-0.5">Reçu le {receivedAt}</div>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        {!isReceived ? (
          <button
            onClick={onReceive}
            className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-semibold 
                       hover:bg-emerald-700 transition-colors"
          >
            Marquer reçu
          </button>
        ) : (
          <button
            onClick={onRemove}
            className="px-3 py-1.5 rounded-md border border-red-300 text-red-600 text-xs font-semibold 
                       bg-white hover:bg-red-50 transition-colors"
          >
            Supprimer
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────

export default function DocumentsPage() {
  const { dossier, requiredDocs, completeness, patchDoc } = useDossierCommittee();

  // Index received docs for O(1) lookup
  const receivedMap = useMemo(() => {
    const map: Record<string, { status: string; receivedAt: string | null }> = {};
    dossier.documents.forEach((d) => {
      map[d.docId] = { status: d.status, receivedAt: d.receivedAt };
    });
    return map;
  }, [dossier.documents]);

  // Group by category
  const categories = useMemo(() => {
    const cats: Record<string, RequiredDoc[]> = {};
    requiredDocs.forEach((rd) => {
      (cats[rd.category] ??= []).push(rd);
    });
    return cats;
  }, [requiredDocs]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Documents du dossier</h2>
          <p className="text-sm text-gray-500 mt-1">
            {requiredDocs.length} documents requis • Type :{' '}
            <span className="font-semibold">{dossier.projectType}</span>
          </p>
        </div>
        <div className="text-right">
          <div
            className="text-3xl font-extrabold"
            style={{
              color: completeness >= 80 ? '#059669' : completeness >= 50 ? '#d97706' : '#dc2626',
            }}
          >
            {completeness}%
          </div>
          <div className="w-36 mt-1">
            <CompletenessBar value={completeness} />
          </div>
        </div>
      </div>

      {/* Category groups */}
      {Object.entries(categories).map(([category, docs]) => {
        const catReceived = docs.filter((d) => receivedMap[d.id]?.status === 'received').length;
        return (
          <div key={category} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wider">
                {category}
              </h3>
              <span
                className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                  catReceived === docs.length
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {catReceived}/{docs.length}
              </span>
            </div>
            <div className="space-y-2">
              {docs.map((doc) => {
                const received = receivedMap[doc.id];
                const isReceived = received?.status === 'received';
                return (
                  <DocRow
                    key={doc.id}
                    doc={doc}
                    isReceived={isReceived}
                    receivedAt={isReceived ? received.receivedAt : null}
                    onReceive={() => patchDoc(doc.id, 'receive')}
                    onRemove={() => patchDoc(doc.id, 'remove')}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}