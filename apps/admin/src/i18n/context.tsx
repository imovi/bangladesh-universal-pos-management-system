"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { bn, type TranslationKeys } from "./bn";
import { en } from "./en";

type Locale = "bn" | "en";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (path: string) => string;
  strings: TranslationKeys;
}

const translations: Record<Locale, TranslationKeys> = { bn, en };

const I18nContext = createContext<I18nContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("bn");

  useEffect(() => {
    const saved = localStorage.getItem("pos_locale") as Locale | null;
    if (saved && (saved === "bn" || saved === "en")) {
      setLocaleState(saved);
      document.documentElement.lang = saved;
    } else {
      document.documentElement.lang = "bn";
    }
  }, []);

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem("pos_locale", newLocale);
    document.documentElement.lang = newLocale;
  };

  const t = (path: string): string => {
    const keys = path.split(".");
    let current: any = translations[locale];
    for (const key of keys) {
      if (current && typeof current === "object" && key in current) {
        current = current[key];
      } else {
        return path;
      }
    }
    return typeof current === "string" ? current : path;
  };

  return (
    <I18nContext.Provider
      value={{
        locale,
        setLocale,
        t,
        strings: translations[locale],
      }}
    >
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useTranslation must be used within a LanguageProvider");
  }
  return context;
}
