import { initRasterizer } from "ark-infographic/rasterizer";
// @ts-expect-error — binary imports handled by wrangler bundler
import resvgWasm from "../node_modules/@resvg/resvg-wasm/index_bg.wasm";
// @ts-expect-error — binary imports handled by wrangler bundler
import arialRegular from "../assets/fonts/Arial-Regular.ttf";
// @ts-expect-error — binary imports handled by wrangler bundler
import arialBold from "../assets/fonts/Arial-Bold.ttf";

let initialized = false;

/**
 * Lazily initialize the resvg rasterizer with WASM + fonts.
 * Safe to call multiple times — only runs once.
 */
export async function ensureInitialized(): Promise<void> {
  if (initialized) return;

  await initRasterizer(resvgWasm, [
    { name: "Arial", data: arialRegular, weight: 400 },
    { name: "Arial", data: arialBold, weight: 700 },
  ]);

  initialized = true;
}
