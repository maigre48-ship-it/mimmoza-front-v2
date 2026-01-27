// FILE: src/spaces/promoteur/etudes/marche/hooks/useProjectConfig.ts

import { useMemo } from "react";
import { ProjectType, ProjectTypeConfig, PoiProjectConfig } from "../types";
import { getProjectConfig, getPoiConfigsForProject } from "../config";

interface UseProjectConfigReturn {
  config: ProjectTypeConfig;
  poiConfigs: PoiProjectConfig[];
}

export function useProjectConfig(projectType: ProjectType): UseProjectConfigReturn {
  const config = useMemo(() => getProjectConfig(projectType), [projectType]);
  const poiConfigs = useMemo(() => getPoiConfigsForProject(projectType), [projectType]);

  return { config, poiConfigs };
}