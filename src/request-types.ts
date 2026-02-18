import type { InfoGraphicConfig } from "ark-infographic";

export interface InfographicRequestBody {
  creature: {
    /** Species name used for lookup + display. */
    speciesName: string;
    /** 12-element wild levels array. */
    levelsWild: number[];
    /** 12-element domesticated levels array. */
    levelsDom: number[];
    /** 1 = Male, 2 = Female, 0 = Unknown. */
    sex: number;
    /** 6-element color region IDs. */
    colors: number[];
    /** Taming effectiveness (0.0–1.0). */
    tamingEffectiveness: number;
    /** Optional creature name, default "". */
    creatureName?: string;
    /** Optional 12-element mutated levels, default all zeros. */
    levelsMutated?: number[] | null;
    /** Optional bred flag, default false. */
    isBred?: boolean;
    /** Optional neutered flag, default false. */
    isNeutered?: boolean;
    /** Optional mutagen flag, default false. */
    isMutagenApplied?: boolean;
    /** Optional imprinting bonus (0.0–1.0), default 0. */
    imprintingBonus?: number;
    /** Optional mutation count, default 0. */
    mutations?: number;
    /** Optional generation, default 0. */
    generation?: number;
  };
  /** Game variant, default "ASA". */
  game?: string;
  /** Rendering options. */
  options?: Partial<InfoGraphicConfig> & {
    /** Output format, default "svg". */
    format?: "svg" | "png";
  };
}
