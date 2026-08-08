/**
 * Internationalization Module (i18n)
 */
import { store } from './state.js';

let translations = {};
const localeListeners = new Set();

export async function loadLocale(lang) {
  try {
    const res = await fetch(`/locales/${lang}.json`);
    if (!res.ok) throw new Error(`Failed to load locale ${lang}`);
    translations = await res.json();
    store.state.lang = lang;
    localStorage.setItem('downdash_lang', lang);
    document.documentElement.lang = lang;
    translateDOM();
    localeListeners.forEach(listener => listener(lang));
    return true;
  } catch (err) {
    console.error('Error loading locale:', err);
    if (lang !== 'en') {
      return loadLocale('en');
    }
    return false;
  }
}

export function onLocaleChange(listener) {
  if (typeof listener !== 'function') return () => {};
  localeListeners.add(listener);
  return () => localeListeners.delete(listener);
}

export function t(key, params = {}) {
  const keys = key.split('.');
  let value = translations;
  
  for (const k of keys) {
    if (value && value[k] !== undefined) {
      value = value[k];
    } else {
      return key; // fallback to key name
    }
  }

  if (typeof value === 'string') {
    Object.keys(params).forEach(p => {
      value = value.replace(new RegExp(`\\{${p}\\}`, 'g'), params[p]);
    });
  }

  return value;
}

export function translateDOM() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });

  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    el.innerHTML = t(key);
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(key);
  });

  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.title = t(key);
  });

  document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    const key = el.getAttribute('data-i18n-aria-label');
    el.setAttribute('aria-label', t(key));
  });

  document.querySelectorAll('[data-i18n-content]').forEach(el => {
    const key = el.getAttribute('data-i18n-content');
    el.setAttribute('content', t(key));
  });
}

export async function initI18n() {
  const lang = store.state.lang;
  await loadLocale(lang);
}
