import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { db } from "@/lib/pos/offline/db";
import type { ModuleKey } from "@universal-pos/shared";

export function usePosModules() {
  const { user } = useAuth();
  const [activeModules, setActiveModules] = useState<ModuleKey[]>(user?.activeModules || []);

  useEffect(() => {
    let cancelled = false;

    async function loadSavedModules() {
      try {
        const saved = await db.settings.get("activeModules");
        if (!cancelled) {
          if (saved?.value && Array.isArray(saved.value)) {
            setActiveModules(saved.value as ModuleKey[]);
          } else {
            setActiveModules([]);
          }
        }
      } catch (err) {
        console.error("[usePosModules] Failed to read activeModules from offline db:", err);
        if (!cancelled) {
          setActiveModules([]);
        }
      }
    }

    // When online and user profile has modules, use them; otherwise read from offline db
    if (user?.activeModules && user.activeModules.length > 0) {
      setActiveModules(user.activeModules);
    } else {
      loadSavedModules();
    }

    return () => {
      cancelled = true;
    };
  }, [user?.activeModules]);

  const isModuleActive = useCallback(
    (key: ModuleKey) => activeModules.includes(key),
    [activeModules]
  );

  return { activeModules, isModuleActive };
}
