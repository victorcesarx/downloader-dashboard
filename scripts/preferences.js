export const PREFERENCES_KEY = 'webscope_preferences_v1';

const systemLanguage = () => navigator.language?.startsWith('pt') ? 'pt-BR' : 'en';
export const DEFAULT_PREFERENCES = Object.freeze({
  theme: 'system',
  lang: systemLanguage(),
  thumbBlurred: false,
  soundEnabled: false,
  notificationsEnabled: false,
  preferredQuality: 'best',
  downloadConcurrency: 3,
  historyRetention: 50,
});

const listeners = new Set();

function sanitized(value = {}) {
  return {
    theme: ['system', 'light', 'dark'].includes(value.theme) ? value.theme : DEFAULT_PREFERENCES.theme,
    lang: ['pt-BR', 'en'].includes(value.lang) ? value.lang : DEFAULT_PREFERENCES.lang,
    thumbBlurred: value.thumbBlurred === true,
    soundEnabled: value.soundEnabled === true,
    notificationsEnabled: value.notificationsEnabled === true,
    preferredQuality: ['best', '1080p', '720p', '480p'].includes(value.preferredQuality) ? value.preferredQuality : 'best',
    downloadConcurrency: Math.min(5, Math.max(1, Number.parseInt(value.downloadConcurrency, 10) || 3)),
    historyRetention: Math.min(100, Math.max(10, Number.parseInt(value.historyRetention, 10) || 50)),
  };
}

function legacyPreferences() {
  return sanitized({
    ...DEFAULT_PREFERENCES,
    theme: localStorage.getItem('downdash_theme') || DEFAULT_PREFERENCES.theme,
    lang: localStorage.getItem('downdash_lang') || DEFAULT_PREFERENCES.lang,
    thumbBlurred: localStorage.getItem('downdash_blur') === 'true',
    soundEnabled: localStorage.getItem('downdash_sound') === 'true',
  });
}

export function getPreferences() {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    if (!raw) {
      const migrated = legacyPreferences();
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(migrated));
      return migrated;
    }
    return sanitized(JSON.parse(raw));
  } catch { return legacyPreferences(); }
}

export function updatePreference(key, value) {
  const current = getPreferences();
  const next = sanitized({ ...current, [key]: value });
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next)); } catch { /* storage indisponível */ }
  listeners.forEach(listener => listener(next, key));
  return next;
}

export function resetPreferences() {
  const next = sanitized(DEFAULT_PREFERENCES);
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next)); } catch { /* storage indisponível */ }
  listeners.forEach(listener => listener(next, 'reset'));
  return next;
}

export function subscribePreferences(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resolvedTheme(theme = getPreferences().theme) {
  if (theme !== 'system') return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
