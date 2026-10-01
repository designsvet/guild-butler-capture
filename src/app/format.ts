/**
 * How the shell writes a length of time and a time of day. Pure, so test/shellModel.test.ts can
 * pin the forms the boards draw.
 */

import type { TStrings } from "../shared/strings.js";

/**
 * A length of time the way board Fh1 writes it in the title bar: "40 s", "3 min", "1 h 20 min",
 * "2 h". Seconds only under a minute, where they are the only thing moving; minutes are whole and
 * floored, so "1 h 20 min" turns over when the twentieth minute is full, as a clock does.
 */
export const formatDuration = (ms: number, units: TStrings["shell"]["units"]): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) {
    return `${seconds} ${units.s}`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} ${units.min}`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} ${units.h}` : `${hours} ${units.h} ${rest} ${units.min}`;
};

/**
 * A time of day, "14:33" — in the OS's own short format rather than the app language's, as the old
 * window writes its build time: a reader set to English on a 24-hour system reads 24 hours, and
 * one on a 12-hour system reads "2:33 PM", not "02:33 PM".
 */
export const formatClock = (epochMs: number, locale?: string): string => {
  return new Date(epochMs).toLocaleTimeString(locale === undefined ? [] : [locale], { timeStyle: "short" });
};
