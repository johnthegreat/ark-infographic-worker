/**
 * One-time script to extract species metadata and color table from values.json.
 * Outputs two JSON files for bundling in the worker:
 *   - src/data/colors.json   — ArkColor entries (base + dye)
 *   - src/data/species-meta.json — minimal species metadata for infographic rendering
 *
 * Server multipliers (from serverMultipliers.json) are applied to stat values
 * during extraction, matching the C# initialization pipeline in Values.cs.
 *
 * Usage: npx tsx scripts/extract-data.ts [path-to-values.json] [--preset <name>]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(__dirname, "../src/data");

interface ValuesJson {
  colorDefinitions: [string, [number, number, number, number]][];
  dyeDefinitions: [string, [number, number, number, number]][];
  species: RawSpecies[];
}

interface RawSpecies {
  name: string;
  displayedStats?: number;
  statNames?: Record<string, string>;
  colors?: (null | { name: string; colors?: string[] })[];
  fullStatsRaw?: (number[] | null)[];
  TamedBaseHealthMultiplier?: number;
  statImprintMult?: number[];
  taming?: unknown;
  breeding?: unknown;
}

/**
 * Per-stat multiplier tuple: [TamingAdd, TamingMult, DomLevel, WildLevel].
 * Indices match C# ServerMultipliers constants.
 */
type StatMultiplier = [number, number, number, number];

interface ServerMultipliersJson {
  serverMultiplierDictionary: Record<string, {
    statMultipliers?: (StatMultiplier | null)[];
  }>;
}

interface ArkColorEntry {
  id: number;
  name: string;
  linearRgba: [number, number, number, number];
  isDye: boolean;
}

interface SpeciesMetaEntry {
  enabledColorRegions: boolean[];
  usedStats: boolean[];
  statNames: Record<string, string> | null;
  colorRegionNames: (string | null)[];
  fullStatsRaw: ([number, number, number, number, number] | null)[];
  tamedBaseHealthMultiplier: number;
  statImprintMultipliers: number[];
}

function extractColors(values: ValuesJson): ArkColorEntry[] {
  const colors: ArkColorEntry[] = [];

  // Base colors: IDs 1..N (sequential)
  for (let i = 0; i < values.colorDefinitions.length; i++) {
    const [name, rgba] = values.colorDefinitions[i]!;
    colors.push({
      id: i + 1,
      name,
      linearRgba: rgba,
      isDye: false,
    });
  }

  // Dye colors: IDs 201..200+N (sequential)
  for (let i = 0; i < values.dyeDefinitions.length; i++) {
    const [name, rgba] = values.dyeDefinitions[i]!;
    colors.push({
      id: 201 + i,
      name,
      linearRgba: rgba,
      isDye: true,
    });
  }

  return colors;
}

/** Default per-stat multiplier (identity). */
const DEFAULT_STAT_MULT: StatMultiplier = [1, 1, 1, 1];

/**
 * Apply server multipliers to a raw stat tuple.
 *
 * Matches C# Values.cs initialization:
 * - BaseValue (index 0): NOT multiplied
 * - IncPerWildLevel (index 1): × WildLevel multiplier [3]
 * - IncPerDomLevel (index 2): × DomLevel multiplier [2]
 * - AddWhenTamed (index 3): × TamingAdd multiplier [0] (only if positive)
 * - MultAffinity (index 4): × TamingMult multiplier [1] (only if positive)
 */
function applyStatMultiplier(
  raw: [number, number, number, number, number],
  mult: StatMultiplier,
): [number, number, number, number, number] {
  const [base, incWild, incDom, addTamed, multAff] = raw;
  return [
    base,
    incWild * mult[3],
    incDom * mult[2],
    addTamed * (addTamed > 0 ? mult[0] : 1),
    multAff * (multAff > 0 ? mult[1] : 1),
  ];
}

function extractSpeciesMeta(
  values: ValuesJson,
  statMultipliers: (StatMultiplier | null)[],
): Record<string, SpeciesMetaEntry> {
  const meta: Record<string, SpeciesMetaEntry> = {};

  for (const sp of values.species) {
    // Derive enabledColorRegions from colors array (null = disabled)
    const enabledColorRegions: boolean[] = [];
    const colorRegionNames: (string | null)[] = [];
    if (sp.colors) {
      for (let i = 0; i < 6; i++) {
        const region = sp.colors[i];
        enabledColorRegions.push(region != null);
        colorRegionNames.push(region?.name ?? null);
      }
    } else {
      for (let i = 0; i < 6; i++) {
        enabledColorRegions.push(false);
        colorRegionNames.push(null);
      }
    }

    // Extract fullStatsRaw with server multipliers applied
    const fullStatsRaw: ([number, number, number, number, number] | null)[] = [];
    for (let i = 0; i < 12; i++) {
      const raw = sp.fullStatsRaw?.[i];
      if (raw != null && raw.length >= 5) {
        const tuple: [number, number, number, number, number] = [raw[0]!, raw[1]!, raw[2]!, raw[3]!, raw[4]!];
        const mult = statMultipliers[i] ?? DEFAULT_STAT_MULT;
        fullStatsRaw.push(applyStatMultiplier(tuple, mult));
      } else {
        fullStatsRaw.push(null);
      }
    }

    // Derive usedStats from fullStatsRaw presence (matches C# Species.UsesStat)
    const usedStats: boolean[] = [];
    for (let i = 0; i < 12; i++) {
      usedStats.push(fullStatsRaw[i] != null);
    }

    // statImprintMult: 12-element array, default all zeros
    const statImprintMultipliers: number[] = [];
    for (let i = 0; i < 12; i++) {
      statImprintMultipliers.push(sp.statImprintMult?.[i] ?? 0);
    }

    meta[sp.name] = {
      enabledColorRegions,
      usedStats,
      statNames: sp.statNames ?? null,
      colorRegionNames,
      fullStatsRaw,
      tamedBaseHealthMultiplier: sp.TamedBaseHealthMultiplier ?? 1,
      statImprintMultipliers,
    };
  }

  return meta;
}

// --- Main ---

// Parse CLI args
const args = process.argv.slice(2);
let valuesPath: string | undefined;
let preset = "official";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--preset" && i + 1 < args.length) {
    preset = args[++i]!;
  } else if (!valuesPath) {
    valuesPath = args[i];
  }
}

valuesPath ??= resolve(
  __dirname,
  "../../ark-infographic-ts/OtherRepos/json/values/values.json",
);

const serverMultsPath = resolve(
  __dirname,
  "../../ark-infographic-ts/OtherRepos/json/serverMultipliers.json",
);

console.log(`Reading: ${valuesPath}`);
console.log(`Server multipliers: ${serverMultsPath} (preset: ${preset})`);

const raw = readFileSync(valuesPath, "utf-8");
const values: ValuesJson = JSON.parse(raw);

// Load server multipliers
let statMultipliers: (StatMultiplier | null)[] = new Array(12).fill(null);
try {
  const smRaw = readFileSync(serverMultsPath, "utf-8");
  const smJson: ServerMultipliersJson = JSON.parse(smRaw);
  const presetData = smJson.serverMultiplierDictionary[preset];
  if (presetData?.statMultipliers) {
    statMultipliers = presetData.statMultipliers;
    console.log(`Loaded ${preset} preset multipliers`);
  } else {
    console.warn(`Preset "${preset}" not found or has no statMultipliers — using defaults`);
  }
} catch {
  console.warn(`Could not read serverMultipliers.json — using default [1,1,1,1] for all stats`);
}

const colors = extractColors(values);
const speciesMeta = extractSpeciesMeta(values, statMultipliers);

const colorsPath = resolve(outputDir, "colors.json");
const speciesPath = resolve(outputDir, "species-meta.json");

writeFileSync(colorsPath, JSON.stringify(colors, null, 2));
writeFileSync(speciesPath, JSON.stringify(speciesMeta, null, 2));

console.log(
  `Wrote ${colors.length} colors to ${colorsPath} (${(Buffer.byteLength(JSON.stringify(colors)) / 1024).toFixed(1)} KB)`,
);
console.log(
  `Wrote ${Object.keys(speciesMeta).length} species to ${speciesPath} (${(Buffer.byteLength(JSON.stringify(speciesMeta)) / 1024).toFixed(1)} KB)`,
);
