/**
 * Whether an engine's lines may reach the guild's bot.
 *
 * The mock engine (`GBC_MOCK_ENGINE=1`, tools/mock-engine.cjs) exists to drive the app with no game,
 * and it runs out of the real data folder — so on a paired computer its invented loot would be
 * uploaded as the member's, and its festivities line ("europe") would be posted for every guild on
 * that server. Nothing it says is true, so nothing it says leaves the machine: no upload loop, no
 * forwarded festivities, energy or engine health.
 *
 * The same for a `replay` engine (a recorded session played back): what it says happened, happened
 * on another day — and a trade journal replayed as today's would move a debt twice. No loot, no
 * trades (the trade loop starts inside the loot loop's guard), nothing forwarded.
 */
export const talksToBot = (source: string | null | undefined): boolean => {
  return source !== "mock" && source !== "replay";
};
