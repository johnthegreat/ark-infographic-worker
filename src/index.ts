import {
  DEFAULT_CONFIG,
  DEFAULT_SERVER_SETTINGS,
  DEFAULT_STRING_PROVIDER,
  computeStatValues,
  renderInfoGraphicSvg,
  colorizeCreature,
} from "ark-infographic";
import { renderInfoGraphicPng } from "ark-infographic/rasterizer";
import type {
  CreatureData,
  InfoGraphicConfig,
  ServerSettings,
  SrgbColor,
} from "ark-infographic";
import type { Env } from "./env.js";
import type { InfographicRequestBody } from "./request-types.js";
import { ensureInitialized } from "./init.js";
import { colorLookup } from "./color-lookup.js";
import { getSpeciesInfo, getSpeciesNames } from "./species-data.js";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/infographic" && request.method === "POST") {
      return handleInfographic(request, env, ctx);
    }
    if (url.pathname === "/api/species" && request.method === "GET") {
      return handleSpeciesList();
    }
    if (url.pathname === "/api/health") {
      return new Response("OK", { status: 200 });
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

function handleSpeciesList(): Response {
  return Response.json(getSpeciesNames());
}

async function handleInfographic(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // Check cache first
  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = await buildCacheKey(request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let body: InfographicRequestBody;
  try {
    body = (await request.json()) as InfographicRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.creature?.speciesName || !body.creature.levelsWild || !body.creature.levelsDom) {
    return Response.json(
      { error: "Missing required fields: creature.speciesName, creature.levelsWild, creature.levelsDom" },
      { status: 400 },
    );
  }

  if (!Array.isArray(body.creature.levelsWild) || body.creature.levelsWild.length !== 12 ||
      !Array.isArray(body.creature.levelsDom) || body.creature.levelsDom.length !== 12) {
    return Response.json(
      { error: "levelsWild and levelsDom must be arrays of exactly 12 numbers" },
      { status: 400 },
    );
  }

  // Look up species metadata (includes stat data)
  const speciesName = body.creature.speciesName;
  const species = getSpeciesInfo(speciesName);
  if (!species) {
    return Response.json(
      { error: `Unknown species: ${speciesName}` },
      { status: 400 },
    );
  }

  // Apply defaults for optional creature fields
  const c = body.creature;
  const isBred = c.isBred ?? false;
  const tamingEffectiveness = c.tamingEffectiveness ?? 0;
  const imprintingBonus = c.imprintingBonus ?? 0;

  // Compute stat values from species base stats + levels
  const isTamed = isBred || tamingEffectiveness > 0;
  const { valuesBreeding, valuesCurrent } = computeStatValues(
    species,
    c.levelsWild,
    c.levelsDom,
    c.levelsMutated ?? null,
    isTamed,
    isBred ? 1.0 : tamingEffectiveness,
    imprintingBonus,
  );

  // Compute level / levelHatched from levelsWild + levelsDom
  const torpidityWild = c.levelsWild[2] ?? 0;
  const domSum = c.levelsDom.reduce((a, b) => a + b, 0);

  const creature: CreatureData = {
    speciesName,
    creatureName: c.creatureName ?? "",
    sex: c.sex ?? 0,
    isNeutered: c.isNeutered ?? false,
    isMutagenApplied: c.isMutagenApplied ?? false,
    isBred,
    levelsWild: c.levelsWild,
    levelsDom: c.levelsDom,
    levelsMutated: c.levelsMutated ?? null,
    valuesBreeding,
    valuesCurrent,
    colors: c.colors ?? [0, 0, 0, 0, 0, 0],
    tamingEffectiveness,
    imprintingBonus,
    mutations: c.mutations ?? 0,
    generation: c.generation ?? 0,
    level: torpidityWild + 1 + domSum,
    levelHatched: torpidityWild + 1,
  };

  // Merge config with defaults (strip format from InfoGraphicConfig)
  const { format: _format, ...configOverrides } = body.options ?? {};
  const config: InfoGraphicConfig = {
    ...DEFAULT_CONFIG,
    ...configOverrides,
  };

  // Build server settings
  const server: ServerSettings = {
    ...DEFAULT_SERVER_SETTINGS,
    game: body.game ?? "ASA",
  };

  // Fetch creature images from R2 and colorize
  let creatureImageDataUri: string | undefined;
  try {
    const suffix = server.game === "ASA" ? "_ASA" : "";
    const [baseObj, maskObj] = await Promise.all([
      env.SPRITES.get(`${speciesName}${suffix}.png`),
      env.SPRITES.get(`${speciesName}${suffix}_m.png`),
    ]);

    if (baseObj) {
      const baseBytes = new Uint8Array(await baseObj.arrayBuffer());

      let imageBytes: Uint8Array;
      if (maskObj) {
        const maskBytes = new Uint8Array(await maskObj.arrayBuffer());
        // Resolve region sRGB colors from creature color IDs
        const regionColors: (SrgbColor | null)[] = [];
        for (let i = 0; i < 6; i++) {
          const colorId = creature.colors[i] ?? 0;
          if (species.enabledColorRegions[i] && colorId !== 0) {
            const c = colorLookup.getColor(colorId);
            regionColors.push([c.r, c.g, c.b]);
          } else {
            regionColors.push(null);
          }
        }
        imageBytes = colorizeCreature(baseBytes, maskBytes, regionColors);
      } else {
        imageBytes = baseBytes;
      }

      const base64 = uint8ArrayToBase64(imageBytes);
      creatureImageDataUri = `data:image/png;base64,${base64}`;
    }
  } catch (err) {
    console.error("Sprite fetch/colorize failed:", err);
  }

  // Determine output format
  const format = body.options?.format ?? "svg";

  let response: Response;
  if (format === "png") {
    // Initialize rasterizer (lazy, once)
    await ensureInitialized();

    const png = renderInfoGraphicPng(
      creature,
      species,
      server,
      config,
      colorLookup,
      DEFAULT_STRING_PROVIDER,
      creatureImageDataUri,
    );
    response = new Response(png.buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } else {
    const svg = renderInfoGraphicSvg(
      creature,
      species,
      server,
      config,
      colorLookup,
      DEFAULT_STRING_PROVIDER,
      creatureImageDataUri,
    );
    response = new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  // Cache the response asynchronously (doesn't block the response)
  ctx.waitUntil(cache.put(cacheKey, response.clone()));

  return response;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function buildCacheKey(request: Request): Promise<Request> {
  const body = await request.clone().text();
  const encoder = new TextEncoder();
  const data = encoder.encode(body);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return new Request(`https://cache.internal/infographic:${hashHex}`);
}
