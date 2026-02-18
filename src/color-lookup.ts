import type { Color, ColorLookup, ArkColor } from "ark-infographic";
import { arkColorToSrgb } from "ark-infographic";
import colorsJson from "./data/colors.json";

interface ArkColorEntry {
  id: number;
  name: string;
  linearRgba: [number, number, number, number];
  isDye: boolean;
}

const LIGHT_GRAY: Color = { r: 211, g: 211, b: 211, a: 255 };

/** Pre-computed sRGB color lookup, keyed by ARK color ID. */
const colorMap = new Map<number, Color>();

for (const entry of colorsJson as ArkColorEntry[]) {
  const arkColor: ArkColor = {
    id: entry.id,
    name: entry.name,
    linearRgba: entry.linearRgba,
    isDye: entry.isDye,
  };
  const [r, g, b] = arkColorToSrgb(arkColor);
  colorMap.set(entry.id, { r, g, b, a: 255 });
}

export const colorLookup: ColorLookup = {
  getColor(colorId: number): Color {
    if (colorId === 0) return LIGHT_GRAY;
    return colorMap.get(colorId) ?? LIGHT_GRAY;
  },
};
