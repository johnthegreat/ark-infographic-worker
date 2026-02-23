import { initRasterizer } from "ark-infographic/rasterizer";
// @ts-expect-error — binary imports handled by wrangler bundler
import resvgWasm from "../node_modules/@resvg/resvg-wasm/index_bg.wasm";
// @ts-expect-error — binary imports handled by wrangler bundler
import liberationSansRegular from "../assets/fonts/LiberationSans-Regular.ttf";
// @ts-expect-error — binary imports handled by wrangler bundler
import liberationSansBold from "../assets/fonts/LiberationSans-Bold.ttf";

let initialized = false;

/**
 * Lazily initialize the resvg rasterizer with WASM + fonts.
 * Safe to call multiple times — only runs once.
 */
export async function ensureInitialized(): Promise<void> {
  if (initialized) return;

  await initRasterizer(resvgWasm, [
    { name: "Liberation Sans", data: liberationSansRegular, weight: 400 },
    { name: "Liberation Sans", data: liberationSansBold, weight: 700 },
  ]);

  initialized = true;
}
