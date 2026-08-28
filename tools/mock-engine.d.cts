/** Types for tools/mock-engine.cjs — the exports tests import. */

export declare const buildLootLine: (now: number, index: number) => string;
export declare const HEADER: string;
export declare const CHARACTER: string;

/** One `[festivities]` line (raid-bot ADR 0100), ticks unconverted, as the real engine prints it. */
export declare const buildFestivitiesLine: (nowMs: number) => string;
