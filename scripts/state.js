/**
 * State Management for Downloader Dashboard
 */

const initialState = {
  currentUrl: '',
  items: [],
  selectedItemIds: new Set(),
  activeFilter: 'all',
  searchQuery: '',
  viewMode: localStorage.getItem('downdash_view') || 'grid',
  thumbBlurred: localStorage.getItem('downdash_blur') === 'true',
  theme: localStorage.getItem('downdash_theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  lang: localStorage.getItem('downdash_lang') || (navigator.language.startsWith('pt') ? 'pt-BR' : 'en'),
  isAnalyzing: false,
  activeZipTask: null,
  soundEnabled: localStorage.getItem('downdash_sound') === 'true'
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
