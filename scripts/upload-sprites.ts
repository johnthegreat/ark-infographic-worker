/**
 * Upload species images to R2 in the expected directory structure.
 *
 * Source format (flat directory, mixed games):
 *   {Species}.png            — ASE base creature sprite
 *   {Species}_m.png          — ASE RGB-encoded mask
 *   {Species}_ASA.png        — ASA base creature sprite
 *   {Species}_ASA_m.png      — ASA RGB-encoded mask
 *
 * R2 target structure:
 *   {game}/{species}/base.png
 *   {game}/{species}/mask.png
 *
 * Game is auto-detected from filename: "_ASA" suffix → ASA, otherwise ASE.
 * Also generates manifest.json listing all uploaded species.
 *
 * NOTE: Female variants (_sf suffix, e.g. "Ovis_sf.png") are skipped for now.
 * The worker has no concept of gender-specific sprites yet.
 *
 * Usage:
 *   npx tsx scripts/upload-sprites.ts <source-dir> [--dry-run]
 *
 * Prerequisites:
 *   - wrangler must be authenticated (`npx wrangler login`)
 *   - R2 bucket "ark-creature-sprites" must exist
 */

import { readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

interface ManifestEntry {
  hasBase: boolean;
  hasMask: boolean;
}

// --- Parse args ---

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const sourceDir = args.find((a) => !a.startsWith("--"));

if (!sourceDir) {
  console.error(
    "Usage: npx tsx scripts/upload-sprites.ts <source-dir> [--dry-run]",
  );
  process.exit(1);
}

const resolvedSource = resolve(sourceDir);
console.log(`Source: ${resolvedSource}`);
console.log(`Dry run: ${dryRun}`);

// --- Helpers ---

interface ParsedFile {
  species: string;
  game: "ASE" | "ASA";
  isMask: boolean;
  filename: string;
}

/**
 * Parse a PNG filename to extract species name, game, and mask flag.
 * Returns null for non-PNG files, metadata files, and female variants (_sf).
 */
function parseFilename(filename: string): ParsedFile | null {
  if (!filename.endsWith(".png")) return null;

  // Skip female variants (_sf) and versioned duplicates (_v1, _v2, etc.)
  if (/_sf[._]/.test(filename) || /_v\d/.test(filename)) return null;

  let name = filename.slice(0, -4); // remove ".png"
  const isMask = name.endsWith("_m");
  if (isMask) name = name.slice(0, -2); // remove "_m"

  let game: "ASE" | "ASA" = "ASE";
  if (name.endsWith("_ASA")) {
    game = "ASA";
    name = name.slice(0, -4); // remove "_ASA"
  }

  return { species: name, game, isMask, filename };
}

// --- Scan source directory ---

const files = readdirSync(resolvedSource).filter((f) => f.endsWith(".png"));

// Map: game → species → { baseFile, maskFile }
const speciesMap = new Map<
  string,
  Map<string, { baseFile?: string; maskFile?: string }>
>();

let skipped = 0;

for (const f of files) {
  const parsed = parseFilename(f);
  if (!parsed) {
    if (/_sf[._]/.test(f) || /_v\d/.test(f)) skipped++;
    continue;
  }

  if (!speciesMap.has(parsed.game)) {
    speciesMap.set(parsed.game, new Map());
  }
  const gameMap = speciesMap.get(parsed.game)!;

  if (!gameMap.has(parsed.species)) {
    gameMap.set(parsed.species, {});
  }
  const entry = gameMap.get(parsed.species)!;

  if (parsed.isMask) {
    entry.maskFile = parsed.filename;
  } else {
    entry.baseFile = parsed.filename;
  }
}

// Build manifest and upload
const manifest: Record<string, Record<string, ManifestEntry>> = {};
let uploaded = 0;

for (const [game, gameMap] of [...speciesMap.entries()].sort()) {
  manifest[game] = {};
  const sortedSpecies = [...gameMap.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );

  console.log(
    `\n${game}: ${sortedSpecies.length} species (${[...gameMap.values()].filter((e) => e.baseFile).length} base, ${[...gameMap.values()].filter((e) => e.maskFile).length} masks)`,
  );

  for (const [species, entry] of sortedSpecies) {
    const hasBase = !!entry.baseFile;
    const hasMask = !!entry.maskFile;
    manifest[game]![species] = { hasBase, hasMask };

    if (hasBase) {
      const srcPath = resolve(resolvedSource, entry.baseFile!);
      const r2Key = `${game}/${species}/base.png`;

      if (dryRun) {
        console.log(`[dry-run] Would upload: ${r2Key}`);
      } else {
        console.log(`Uploading: ${r2Key}`);
        execSync(
          `npx wrangler r2 object put "ark-creature-sprites/${r2Key}" --file="${srcPath}" --remote`,
          { stdio: "inherit" },
        );
      }
      uploaded++;
    }

    if (hasMask) {
      const srcPath = resolve(resolvedSource, entry.maskFile!);
      const r2Key = `${game}/${species}/mask.png`;

      if (dryRun) {
        console.log(`[dry-run] Would upload: ${r2Key}`);
      } else {
        console.log(`Uploading: ${r2Key}`);
        execSync(
          `npx wrangler r2 object put "ark-creature-sprites/${r2Key}" --file="${srcPath}" --remote`,
          { stdio: "inherit" },
        );
      }
      uploaded++;
    }
  }
}

if (skipped > 0) {
  console.log(`\nSkipped ${skipped} files (female variants, versioned duplicates)`);
}

// Write manifest
const manifestPath = resolve(
  process.cwd(),
  "src/data/sprite-manifest.json",
);
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`\nWrote manifest to ${manifestPath}`);
console.log(`Total files ${dryRun ? "to upload" : "uploaded"}: ${uploaded}`);
