/**
 * The shell's router: the page lives in the hash, `#/session`. Small and its own, because the page
 * runs from a file under a content-security policy and a strict will-navigate guard
 * (src/main/windowOptions.ts `isOwnPage`): a hash change is not a navigation, so moving between
 * pages never asks the main process anything.
 *
 * Only a hash that starts with `#/` is a route. Any other — the skip link's `#main` — is left to
 * the browser, which scrolls to and focuses its target, and the page stays where it was. An
 * unknown route falls back to Session rather than to a blank page.
 *
 * In slice 0 Session is the only page there is (a page with no data yet is not listed — SPEC).
 */

export const ROUTES = ["session"] as const;

export type TRoute = (typeof ROUTES)[number];

export const DEFAULT_ROUTE: TRoute = "session";

export const hrefOf = (route: TRoute): string => `#/${route}`;

const isRoute = (name: string): name is TRoute => (ROUTES as readonly string[]).includes(name);

/** The route a hash asks for, or `current` when the hash is not a route at all. */
export const nextRoute = (hash: string, current: TRoute): TRoute => {
  if (!hash.startsWith("#/")) {
    return current;
  }
  const name = hash.slice(2).split(/[/?]/)[0] ?? "";
  return isRoute(name) ? name : DEFAULT_ROUTE;
};

/** What the router needs from the window — narrow, so a test can hand it a fake one. */
export type THashSource = {
  location: { hash: string };
  addEventListener: (type: "hashchange", listener: () => void) => void;
};

export type TRouter = {
  getSnapshot: () => TRoute;
  subscribe: (listener: () => void) => () => void;
};

/** The current route as an external store, for React's `useSyncExternalStore`. */
export const createRouter = (source: THashSource): TRouter => {
  let route = nextRoute(source.location.hash, DEFAULT_ROUTE);
  const listeners = new Set<() => void>();
  source.addEventListener("hashchange", () => {
    const next = nextRoute(source.location.hash, route);
    if (next !== route) {
      route = next;
      for (const listener of listeners) {
        listener();
      }
    }
  });
  return {
    getSnapshot: () => route,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
