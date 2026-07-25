// Persistent personal preferences, stored in localStorage — deliberately
// separate from Filters (which live in the URL and are meant to be
// shared/bookmarked). Settings are local-only on purpose: opening someone
// else's shared filter link should show what THEY filtered for, not have
// your own hidden categories silently applied on top.

export interface AppSettings {
  hiddenCategories: string[];
  hiddenChains: string[];
}

const STORAGE_KEY = "matvarepris_settings";

const DEFAULT_SETTINGS: AppSettings = {
  hiddenCategories: [],
  hiddenChains: [],
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
