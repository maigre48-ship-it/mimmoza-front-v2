// src/spaces/promoteur/terrain3d/blender/useLocalBlenderRender.ts

import { useCallback, useState } from "react";
import { requestLocalRender } from "./requestLocalRender";
import type {
  LocalBlenderRenderResponse,
  LocalBlenderRenderStatus,
} from "./localRender.types";

export function useLocalBlenderRender() {
  const [status, setStatus] = useState<LocalBlenderRenderStatus>("idle");
  const [result, setResult] = useState<LocalBlenderRenderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const runRender = useCallback(
    async (input: { gltfBlob: Blob; renderSpecBlob: Blob }) => {
      setError(null);
      setResult(null);
      setLogs([]);
      setStatus("uploading");

      try {
        const res = await requestLocalRender(input);

        // Extraire les logs si le service les retourne
        if (res.logs && Array.isArray(res.logs)) {
          setLogs(res.logs);
        } else if (typeof (res as any).log === "string") {
          setLogs((res as any).log.split("\n").filter(Boolean));
        }

        setResult(res);
        setStatus("done");
        return res;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setStatus("error");

        // Récupérer les logs attachés à l'erreur par requestLocalRender
        if (err instanceof Error && Array.isArray((err as any).logs) && (err as any).logs.length > 0) {
          setLogs((err as any).logs);
        }

        throw err;
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setResult(null);
    setError(null);
    setLogs([]);
  }, []);

  return {
    status,
    result,
    error,
    logs,
    runRender,
    reset,
  };
}