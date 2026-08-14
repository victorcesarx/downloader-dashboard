/**
 * State Management for Downloader Dashboard
 */
import { getPreferences, resolvedTheme } from './preferences.js';

const preferences = getPreferences();

const initialState = {
  currentUrl: '',
  items: [],
  selectedItemIds: new Set(),
  activeFilter: 'all',
  searchQuery: '',
  sortOrder: sessionStorage.getItem('downdash_sort') || 'original',
  viewMode: localStorage.getItem('downdash_view') || 'grid',
  thumbBlurred: preferences.thumbBlurred,
  theme: resolvedTheme(preferences.theme),
  themePreference: preferences.theme,
  lang: preferences.lang,
  isAnalyzing: false,
  activeZipTask: null,
  soundEnabled: preferences.soundEnabled,
  notificationsEnabled: preferences.notificationsEnabled,
  faviconBadgeEnabled: preferences.faviconBadgeEnabled,
  preferredQuality: preferences.preferredQuality,
  downloadConcurrency: preferences.downloadConcurrency,
  historyRetention: preferences.historyRetention,
};

class Store {
  constructor(state) {
    this.state = new Proxy(state, {
      set: (target, property, value) => {
        target[property] = value;
        this.notify(property, value);
        return true;
      }
    });
    this.listeners = [];
  }

  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  notify(property, value) {
    this.listeners.forEach(listener => listener(property, value, this.state));
  }

  getState() {
    return this.state;
  }
}

export const store = new Store(initialState);
