/**
 * Whether an engine's lines may reach the guild's bot.
 *
 * The mock engine (`GBC_MOCK_ENGINE=1`, tools/mock-engine.cjs) exists to drive the app with no game,
 * and it runs out of the real data folder — so on a paired computer its invented loot would be
 * uploaded as the member's, and its festivities line ("europe") would be posted for every guild on
 * that server. Nothing it says is true, so nothing it says leaves the machine: no upload loop, no
 * forwarded festivities, energy or engine health.
 */
export const talksToBot = (source: string | null | undefined): boolean => {
  return source !== "mock" && source !== "replay";
};
