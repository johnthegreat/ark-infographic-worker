import type { SpeciesInfo, SpeciesStatData } from "ark-infographic";
import speciesMetaJson from "./data/species-meta.json";

export type SpeciesMetaEntry = SpeciesInfo & SpeciesStatData;

const speciesMap = speciesMetaJson as Record<string, SpeciesMetaEntry>;

export function getSpeciesInfo(name: string): SpeciesMetaEntry | undefined {
  return speciesMap[name];
}

export function getSpeciesNames(): string[] {
  return Object.keys(speciesMap);
}
