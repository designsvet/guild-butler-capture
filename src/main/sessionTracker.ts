import { closeSession, newSession, reduceSession, restartSession, type TSession } from "../shared/session/model.js";
import { createSessionTail, type TSessionTailDeps } from "./sessionFiles.js";

export type TSessionTrackerDeps = Omit<TSessionTailDeps, "onLines"> & {
  now: () => number;
  id: () => string;
  onSnapshot: (session: TSession) => void;
  save: (session: TSession) => Promise<void>;
  setInterval: (callback: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
};
export const createSessionTracker = (deps: TSessionTrackerDeps) => {
  let session = newSession(deps.id(), deps.now());
  let boundaries = new Map<string, number>();
  let dirty = false;
  let closed = false;
  let closing: Promise<void> | null = null;
  let transition: Promise<TSession> | null = null;
  const tail = createSessionTail({
    ...deps,
    onLines: (lines) => {
      for (const line of lines) {
        if (line.event == null) {
          session = { ...session, refused: session.refused + 1 };
          deps.log(`[session] refused ${line.file}:${line.line}`);
        } else {
          session = reduceSession(session, line.event, line.file);
        }
        const previous = session.files.find((file) => file.path === line.file);
        session = {
          ...session,
          files: [
            ...session.files.filter((file) => file.path !== line.file),
            {
              path: line.file,
              originByte: line.originByte,
              fromByte: Math.min(previous?.fromByte ?? line.fromByte, line.fromByte),
              toByte: Math.max(previous?.toByte ?? 0, line.toByte),
              fromLine: previous?.fromLine ?? (boundaries.get(line.file) ?? 0) + 1,
              toLine: Math.max(previous?.toLine ?? 0, line.line),
            },
          ],
        };
        dirty = true;
      }
    },
  });
  const push = (): void => {
    if (dirty) {
      dirty = false;
      deps.onSnapshot(session);
    }
  };
  const poll = async (): Promise<void> => {
    try {
      await tail.poll();
      push();
    } catch (err) {
      deps.log(`[session] poll failed: ${String(err)}`);
    }
  };
  const drain = async (): Promise<void> => {
    // Bound teardown even if a raw file becomes unreadable or another process keeps appending.
    for (let attempt = 0; attempt < 256; attempt += 1) {
      await tail.poll();
      if (await tail.caughtUp()) {
        return;
      }
    }
    throw new Error("Session files could not be fully read");
  };
  // One timer owns snapshots, never more than 4/sec; the tail coalesces overlapping reads.
  const timer = deps.setInterval(() => {
    if (!closed && transition == null && closing == null) {
      void poll();
    }
  }, 250);
  const save = async (at: number): Promise<TSession> => {
    const completed = closeSession(session, at);
    // Failure rejects New session: keep its counters and let the member try again.
    if (completed.events > 0 || completed.refused > 0) {
      await deps.save(completed);
    }
    return completed;
  };
  return {
    snapshot: (): TSession => session,
    poll,
    newSession: (): Promise<TSession> => {
      if (transition != null) {
        return transition;
      }
      if (closed || closing != null) {
        return Promise.reject(new Error("session is closing"));
      }
      transition = (async () => {
        await drain();
        const completed = await save(deps.now());
        boundaries = tail.positions();
        session = restartSession(session, deps.id(), completed.lastAt);
        dirty = true;
        push();
        return session;
      })().finally(() => {
        transition = null;
      });
      return transition;
    },
    stop: (): Promise<void> => {
      if (closing != null) {
        return closing;
      }
      closed = true;
      deps.clearInterval(timer);
      const stoppedAt = deps.now();
      closing = (async () => {
        try {
          await transition;
        } catch (err) {
          deps.log(`[session] reset failed before Stop: ${String(err)}`);
        }
        try {
          await drain();
          session = await save(stoppedAt);
        } finally {
          // A disk failure must not leave a stopped session's clock running in the renderer.
          session = closeSession(session, stoppedAt);
          dirty = true;
          push();
        }
      })();
      return closing;
    },
  };
};
export type TSessionTracker = ReturnType<typeof createSessionTracker>;
