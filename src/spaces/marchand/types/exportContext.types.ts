// src/spaces/marchand/types/exportContext.types.ts

import type { MarchandSnapshotV1 } from "../shared/marchandSnapshot.store";

export interface ExportContextV1 {
  version: "v1";
  generatedAt: string;
  space: "marchand";
  snapshot: MarchandSnapshotV1;
  dueDiligence?: {
    report: any;
    computed?: any;
  };
  rentabilite?: {
    kpis?: Record<string, any>;
    scenarios?: any;
  };
  notes?: {
    warnings?: string[];
  };
}