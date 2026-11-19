/**
 * Single-tab lock per register using Web Locks API with BroadcastChannel fallback.
 */

export interface TabLockHandle {
  hasLock: boolean;
  release: () => void;
}

export async function acquireRegisterTabLock(
  registerId: string,
  onLockLost?: () => void
): Promise<TabLockHandle> {
  const lockName = `pos-tab-lock-${registerId}`;

  // 1. If Web Locks API is available
  if (typeof window !== "undefined" && "locks" in navigator) {
    let releasePromiseResolve: (() => void) | null = null;
    const releasePromise = new Promise<void>((resolve) => {
      releasePromiseResolve = resolve;
    });

    let acquired = false;
    let released = false;

    const lockPromise = new Promise<boolean>((resolveAcquired) => {
      navigator.locks.request(
        lockName,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            resolveAcquired(false);
            return;
          }
          if (released) {
            resolveAcquired(false);
            return;
          }
          acquired = true;
          resolveAcquired(true);

          // Hold the lock until release is called
          await releasePromise;
        }
      ).catch(() => {
        if (!acquired) {
          resolveAcquired(false);
        } else if (onLockLost) {
          onLockLost();
        }
      });
    });

    const hasLock = await lockPromise;

    return {
      hasLock,
      release: () => {
        if (!released) {
          released = true;
          if (releasePromiseResolve) {
            releasePromiseResolve();
          }
        }
      },
    };
  }

  // 2. Fallback: BroadcastChannel
  if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
    const channelName = `pos-tab-channel-${registerId}`;
    const channel = new BroadcastChannel(channelName);
    let hasLock = true;
    const tabId = crypto.randomUUID();

    // Broadcast our presence
    channel.postMessage({ type: "claim_lock", tabId, timestamp: Date.now() });

    channel.onmessage = (event) => {
      if (event.data?.type === "claim_lock" && event.data.tabId !== tabId) {
        // Someone else was already holding or is claiming
        // The earlier timestamp wins, or on conflict first claimer wins
        channel.postMessage({ type: "lock_denied", toTabId: event.data.tabId });
      } else if (event.data?.type === "lock_denied" && event.data.toTabId === tabId) {
        hasLock = false;
        if (onLockLost) onLockLost();
      }
    };

    return {
      get hasLock() {
        return hasLock;
      },
      release: () => {
        channel.close();
      },
    };
  }

  // In test or non-browser environments
  return {
    hasLock: true,
    release: () => {},
  };
}

/**
 * Pure guard determining whether POS sign-out is permitted.
 * Sign-out is blocked while offline if any unsynced outbox sales remain.
 */
export function isSignOutAllowed(isOnline: boolean, unsyncedOutboxCount: number): boolean {
  if (!isOnline && unsyncedOutboxCount > 0) {
    return false;
  }
  return true;
}

