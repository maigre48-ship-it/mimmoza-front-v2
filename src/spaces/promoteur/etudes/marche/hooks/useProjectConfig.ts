// FILE: src/spaces/promoteur/etudes/marche/hooks/useProjectConfig.ts

import { useMemo } from "react";
import { getPoiConfigsForProject, getProjectConfig } from "../config";
import { PoiProjectConfig, ProjectType, ProjectTypeConfig } from "../types";

interface UseProjectConfigReturn {
  config: ProjectTypeConfig;
  poiConfigs: PoiProjectConfig[];
}

export function useProjectConfig(projectType: ProjectType): UseProjectConfigReturn {
  const config = useMemo(() => getProjectConfig(projectType), [projectType]);
  const poiConfigs = useMemo(() => getPoiConfigsForProject(projectType), [projectType]);

  return { config, poiConfigs };
}