import { renderTemplate } from './schema.js';
import { getEntryById, loadLibrary, loadSession } from './storage.js';
import {
  setupPanoramaTopBarState,
  setupScrollReveal,
  setupStandalonePreviewNavigation,
} from './runtime/preview-motion.js';

const root = document.getElementById('standalone-preview-root');

function setTheme(draft) {
  root.style.setProperty('--theme-background', draft.theme.backgroundColor);
  root.style.setProperty('--theme-surface', draft.theme.surfaceColor);
  root.style.setProperty('--theme-accent', draft.theme.accentColor);
  root.style.setProperty('--theme-text', draft.theme.textColor);
  root.style.setProperty('--theme-panel', draft.theme.panelColor);
}

function renderEmptyState(title, description) {
  root.className = 'standalone-preview-empty';
  root.innerHTML = `
    <div>
      <h1>${title}</h1>
      <p>${description}</p>
    </div>
  `;
}

function resolvePreviewDraft() {
  const params = new URLSearchParams(globalThis.location.search);
  const mode = params.get('mode') || 'session';

  if (mode === 'session') {
    const session = loadSession();
    return session?.draft || null;
  }

  const kind = params.get('kind') === 'website' ? 'website' : 'design';
  const entryId = params.get('id') || '';
  const entry = getEntryById(loadLibrary(), kind, entryId);
  return entry?.draft || null;
}

const draft = resolvePreviewDraft();

if (!draft) {
  renderEmptyState(
    'Preview unavailable',
    'We could not find that saved website or design. Return to the Website Builder workspace and try again.'
  );
} else {
  document.title = draft.site?.title
    ? `${draft.site.title} | O.R.I.O.N. Website Preview`
    : 'O.R.I.O.N. Website Preview';
  setTheme(draft);
  root.className = 'preview-root standalone-preview-root';
  root.dataset.templateId = draft.templateId;
  root.innerHTML = renderTemplate(draft);
  setupScrollReveal(root, null);
  setupPanoramaTopBarState(root, null);
  setupStandalonePreviewNavigation(root, null);
}
