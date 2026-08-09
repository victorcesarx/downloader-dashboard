import { loadLocale, onLocaleChange, t } from './i18n.js';
import { getPreferences, resetPreferences, resolvedTheme, subscribePreferences, updatePreference } from './preferences.js';
import { store } from './state.js';
import { closeRightPanel, getActiveRightPanel, setOnRightPanelChange, toggleRightPanel } from './right-panel.js';
import { closeIconSvg } from './icons.js';

let panel = null;
let initialized = false;

function selectOptions(values, current) {
  return values.map(([value, label]) => `<option value="${value}" ${value === current ? 'selected' : ''}>${label}</option>`).join('');
}

function syncControls(prefs) {
  if (!panel) return;
  panel.querySelectorAll('[data-pref]').forEach(control => {
    const value = prefs[control.dataset.pref];
    if (control.type === 'checkbox') control.checked = Boolean(value);
    else control.value = String(value);
  });
}

function render() {
  if (!panel) return;
  const prefs = getPreferences();
  panel.innerHTML = `
    <header class="queue-panel-header preferences-header">
      <div class="queue-panel-heading"><h4 id="preferences-title">${t('preferences.title')}</h4><span class="queue-panel-subtext">${t('preferences.subtitle')}</span></div>
      <button class="queue-panel-close icon-close-btn preferences-close" type="button" aria-label="${t('actions.close')}" title="${t('actions.close')}">${closeIconSvg()}</button>
    </header>
    <div class="preferences-body">
      <section class="preferences-section"><h5>${t('preferences.appearance')}</h5>
        <label class="preferences-field"><span>${t('preferences.theme')}</span><select data-pref="theme">${selectOptions([
          ['system', t('preferences.theme_system')], ['dark', t('preferences.theme_dark')], ['light', t('preferences.theme_light')]
        ], prefs.theme)}</select></label>
        <label class="preferences-field"><span>${t('preferences.language')}</span><select data-pref="lang">${selectOptions([['pt-BR', 'Português'], ['en', 'English']], prefs.lang)}</select></label>
        <label class="preferences-field"><span><strong>${t('preferences.nsfw')}</strong><small>${t('preferences.nsfw_hint')}</small></span><span class="toggle-switch"><input class="toggle-switch-input" data-pref="thumbBlurred" type="checkbox" ${prefs.thumbBlurred ? 'checked' : ''}><span class="toggle-switch-slider" aria-hidden="true"></span></span></label>
      </section>
      <section class="preferences-section"><h5>${t('preferences.downloads')}</h5>
        <label class="preferences-field"><span><strong>${t('preferences.sound')}</strong><small>${t('preferences.sound_hint')}</small></span><span class="toggle-switch"><input class="toggle-switch-input" data-pref="soundEnabled" type="checkbox" ${prefs.soundEnabled ? 'checked' : ''}><span class="toggle-switch-slider" aria-hidden="true"></span></span></label>
        <label class="preferences-field"><span><strong>${t('preferences.notifications')}</strong><small>${t('preferences.notifications_hint')}</small></span><span class="toggle-switch"><input class="toggle-switch-input" data-pref="notificationsEnabled" type="checkbox" ${prefs.notificationsEnabled ? 'checked' : ''}><span class="toggle-switch-slider" aria-hidden="true"></span></span></label>
        <label class="preferences-field"><span>${t('preferences.quality')}</span><select data-pref="preferredQuality">${selectOptions([
          ['best', t('preferences.quality_best')], ['1080p', '1080p'], ['720p', '720p'], ['480p', '480p']
        ], prefs.preferredQuality)}</select></label>
        <label class="preferences-field"><span><strong>${t('preferences.concurrency')}</strong><small>${t('preferences.concurrency_hint')}</small></span><select data-pref="downloadConcurrency">${selectOptions([1,2,3,4,5].map(n => [String(n), String(n)]), String(prefs.downloadConcurrency))}</select></label>
      </section>
      <section class="preferences-section"><h5>${t('preferences.history')}</h5>
        <label class="preferences-field"><span><strong>${t('preferences.retention')}</strong><small>${t('preferences.retention_hint')}</small></span><input data-pref="historyRetention" type="number" min="10" max="100" value="${prefs.historyRetention}"></label>
      </section>
    </div>
    <footer class="preferences-footer"><button class="btn btn-secondary btn-sm preferences-reset" type="button">${t('preferences.reset')}</button><span>${t('preferences.autosave')}</span></footer>`;

  panel.querySelector('.preferences-close').addEventListener('click', closeRightPanel);
  panel.querySelector('.preferences-reset').addEventListener('click', async () => applyAll(resetPreferences()));
  panel.querySelectorAll('[data-pref]').forEach(control => control.addEventListener('change', async () => {
    const key = control.dataset.pref;
    let value = control.type === 'checkbox' ? control.checked : control.value;
    if (control.type === 'number' || key === 'downloadConcurrency') value = Number(value);
    if (key === 'notificationsEnabled' && value && 'Notification' in window && Notification.permission === 'default') {
      value = (await Notification.requestPermission()) === 'granted';
      control.checked = value;
    }
    const next = updatePreference(key, value);
    await applyPreference(next, key);
  }));
}

async function applyPreference(prefs, key) {
  if (key === 'theme') {
    store.state.themePreference = prefs.theme;
    store.state.theme = resolvedTheme(prefs.theme);
    document.documentElement.setAttribute('data-theme', store.state.theme);
  } else if (key === 'lang' && store.state.lang !== prefs.lang) {
    await loadLocale(prefs.lang);
  } else if (key === 'thumbBlurred') store.state.thumbBlurred = prefs.thumbBlurred;
  else if (key === 'soundEnabled') store.state.soundEnabled = prefs.soundEnabled;
  else if (key === 'notificationsEnabled') store.state.notificationsEnabled = prefs.notificationsEnabled;
  else if (key === 'preferredQuality') store.state.preferredQuality = prefs.preferredQuality;
  else if (key === 'downloadConcurrency') store.state.downloadConcurrency = prefs.downloadConcurrency;
  else if (key === 'historyRetention') store.state.historyRetention = prefs.historyRetention;
}

async function applyAll(prefs) {
  for (const key of Object.keys(prefs)) await applyPreference(prefs, key);
  render();
}

function getOrCreatePanel() {
  if (panel?.isConnected) return panel;
  panel = document.createElement('aside');
  panel.id = 'preferences-panel';
  panel.className = 'preferences-panel';
  panel.setAttribute('aria-labelledby', 'preferences-title');
  panel.setAttribute('aria-hidden', 'true');
  document.body.appendChild(panel);
  return panel;
}

function syncPanel() {
  const open = getActiveRightPanel() === 'preferences';
  if (open) {
    const el = getOrCreatePanel();
    render();
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
  } else if (panel) {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
  }
}

export function initPreferencesPanel() {
  if (initialized) return;
  initialized = true;
  setOnRightPanelChange(syncPanel);
  onLocaleChange(() => { if (getActiveRightPanel() === 'preferences') render(); });
  subscribePreferences(prefs => {
    if (getActiveRightPanel() === 'preferences') syncControls(prefs);
  });
  document.getElementById('preferences-toggle-btn')?.addEventListener('click', () => toggleRightPanel('preferences'));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (getPreferences().theme === 'system') {
      store.state.theme = resolvedTheme('system');
      document.documentElement.setAttribute('data-theme', store.state.theme);
    }
  });
}
