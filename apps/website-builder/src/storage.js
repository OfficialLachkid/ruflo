import {
  createDefaultDraft,
  hydrateDraft,
  getTemplateById,
  TEMPLATE_OPTIONS,
} from './schema.js';

const LIBRARY_STORAGE_KEY = 'orion.website-builder.library.v1';
const SESSION_STORAGE_KEY = 'orion.website-builder.session.v1';

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeDraft(input, templateId) {
  if (input) {
    return hydrateDraft(templateId ? { ...input, templateId } : input);
  }

  return createDefaultDraft(templateId);
}

function getSessionTitle(kind, entryTitle, draft) {
  const normalizedEntryTitle = normalizeText(entryTitle);
  if (normalizedEntryTitle) {
    return normalizedEntryTitle;
  }

  const siteTitle = normalizeText(draft?.site?.title);
  if (siteTitle) {
    return kind === 'design' ? `${siteTitle} design` : siteTitle;
  }

  return kind === 'design' ? 'Untitled design' : 'Untitled website';
}

export function createSession(kind = 'design', options = {}) {
  const templateId = normalizeText(options.templateId) || undefined;
  const draft = normalizeDraft(options.draft, templateId);
  const nextKind = kind === 'website' ? 'website' : 'design';

  return {
    recordKind: nextKind,
    recordId: normalizeText(options.recordId),
    entryTitle: getSessionTitle(nextKind, options.entryTitle, draft),
    companyName: nextKind === 'website'
      ? normalizeText(options.companyName) || normalizeText(draft.site?.title)
      : '',
    summary: normalizeText(options.summary),
    sourceDesignId: nextKind === 'website' ? normalizeText(options.sourceDesignId) : '',
    draft,
  };
}

function normalizeEntry(kind, entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const nextKind = kind === 'website' ? 'website' : 'design';
  const draft = normalizeDraft(entry.draft, entry.templateId);
  const normalizedEntry = {
    id: normalizeText(entry.id) || createId(nextKind),
    kind: nextKind,
    templateId: draft.templateId,
    title: getSessionTitle(nextKind, entry.title, draft),
    companyName: nextKind === 'website'
      ? normalizeText(entry.companyName) || normalizeText(draft.site?.title)
      : '',
    summary: normalizeText(entry.summary),
    sourceDesignId: nextKind === 'website' ? normalizeText(entry.sourceDesignId) : '',
    createdAt: normalizeText(entry.createdAt) || nowIso(),
    updatedAt: normalizeText(entry.updatedAt) || nowIso(),
    draft,
  };

  return normalizedEntry;
}

export function createEmptyLibrary() {
  return {
    designs: [],
    websites: [],
  };
}

export function hydrateLibrary(input) {
  const parsed = input && typeof input === 'object' ? input : {};
  const designs = Array.isArray(parsed.designs)
    ? parsed.designs.map((entry) => normalizeEntry('design', entry)).filter(Boolean)
    : [];
  const websites = Array.isArray(parsed.websites)
    ? parsed.websites.map((entry) => normalizeEntry('website', entry)).filter(Boolean)
    : [];

  return { designs, websites };
}

function mergeEntryCollections(preferredCollection = [], fallbackCollection = []) {
  const mergedById = new Map();

  for (const entry of [...preferredCollection, ...fallbackCollection]) {
    if (!entry?.id || mergedById.has(entry.id)) {
      continue;
    }

    mergedById.set(entry.id, entry);
  }

  return [...mergedById.values()];
}

export function mergeLibraries(preferredLibrary, fallbackLibrary) {
  const preferred = hydrateLibrary(preferredLibrary);
  const fallback = hydrateLibrary(fallbackLibrary);

  return {
    designs: mergeEntryCollections(preferred.designs, fallback.designs),
    websites: mergeEntryCollections(preferred.websites, fallback.websites),
  };
}

export function hasLibraryEntries(library) {
  return (library?.designs?.length || 0) > 0 || (library?.websites?.length || 0) > 0;
}

function createStarterDesignId(templateId) {
  return `starter-design-${normalizeText(templateId)}`;
}

function createStarterDesignEntry(templateOption) {
  const template = getTemplateById(templateOption.id);
  const draft = createDefaultDraft(template.id);
  const baseTitle = normalizeText(draft.site?.title) || template.name;

  return normalizeEntry('design', {
    id: createStarterDesignId(template.id),
    title: `${baseTitle} design`,
    summary: `${template.description} Starter reusable design imported from the ${template.name} template.`,
    templateId: template.id,
    draft,
  });
}

export function createStarterDesignEntries() {
  return TEMPLATE_OPTIONS
    .filter((template) => template.builderEnabled)
    .map((template) => createStarterDesignEntry(template))
    .filter(Boolean);
}

export function getMissingStarterDesignEntries(library) {
  const existingDesignIds = new Set(
    hydrateLibrary(library).designs.map((entry) => entry.id).filter(Boolean)
  );

  return createStarterDesignEntries().filter((entry) => !existingDesignIds.has(entry.id));
}

export function loadLibrary() {
  if (!globalThis.localStorage) {
    return createEmptyLibrary();
  }

  const stored = globalThis.localStorage.getItem(LIBRARY_STORAGE_KEY);
  return hydrateLibrary(stored ? safeJsonParse(stored) : null);
}

export function saveLibrary(library) {
  if (!globalThis.localStorage) {
    return false;
  }

  globalThis.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify({
    designs: Array.isArray(library?.designs) ? library.designs : [],
    websites: Array.isArray(library?.websites) ? library.websites : [],
  }));

  return true;
}

export function loadSession() {
  if (!globalThis.localStorage) {
    return createSession('design');
  }

  const stored = globalThis.localStorage.getItem(SESSION_STORAGE_KEY);
  const parsed = stored ? safeJsonParse(stored) : null;

  if (!parsed || typeof parsed !== 'object') {
    return createSession('design');
  }

  if (parsed.draft === undefined && parsed.templateId) {
    return createSession('design', {
      entryTitle: '',
      summary: '',
      draft: parsed,
    });
  }

  return createSession(parsed.recordKind, parsed);
}

export function saveSession(session) {
  if (!globalThis.localStorage) {
    return false;
  }

  globalThis.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
    ...session,
    draft: hydrateDraft(session.draft),
  }));

  return true;
}

export function resetSession(session) {
  return createSession(session.recordKind, {
    recordId: session.recordId,
    entryTitle: session.entryTitle,
    companyName: session.companyName,
    summary: session.summary,
    sourceDesignId: session.sourceDesignId,
    templateId: session.draft?.templateId,
  });
}

export function getEntriesByKind(library, kind) {
  return kind === 'website' ? library.websites : library.designs;
}

export function getEntryById(library, kind, entryId) {
  return getEntriesByKind(library, kind).find((entry) => entry.id === entryId) || null;
}

function upsertEntryInCollection(collection, nextEntry) {
  const index = collection.findIndex((entry) => entry.id === nextEntry.id);
  if (index < 0) {
    return [nextEntry, ...collection];
  }

  const nextCollection = [...collection];
  nextCollection[index] = nextEntry;
  return nextCollection;
}

export function createSessionFromEntry(entry) {
  return createSession(entry.kind, {
    recordId: entry.id,
    entryTitle: entry.title,
    companyName: entry.companyName,
    summary: entry.summary,
    sourceDesignId: entry.sourceDesignId,
    draft: entry.draft,
  });
}

export function createWebsiteSessionFromDesign(entry) {
  return createSession('website', {
    entryTitle: `${entry.title} website`,
    companyName: normalizeText(entry.draft?.site?.title),
    summary: entry.summary,
    sourceDesignId: entry.id,
    draft: entry.draft,
  });
}

function getNextWebsiteTitle(library, baseTitle) {
  const normalizedBaseTitle = normalizeText(baseTitle) || 'Untitled website';
  const existingTitles = new Set(
    (library?.websites || []).map((entry) => normalizeText(entry.title).toLowerCase()).filter(Boolean)
  );

  if (!existingTitles.has(normalizedBaseTitle.toLowerCase())) {
    return normalizedBaseTitle;
  }

  let suffix = 2;
  while (existingTitles.has(`${normalizedBaseTitle} ${suffix}`.toLowerCase())) {
    suffix += 1;
  }

  return `${normalizedBaseTitle} ${suffix}`;
}

export function saveEntryFromSession(library, session, targetKind = session.recordKind) {
  const nextKind = targetKind === 'website' ? 'website' : 'design';
  const existingEntry = nextKind === session.recordKind
    ? getEntryById(library, nextKind, session.recordId)
    : null;
  const timestamp = nowIso();
  const draft = hydrateDraft(session.draft);
  const entry = normalizeEntry(nextKind, {
    id: existingEntry?.id || createId(nextKind),
    title: session.entryTitle,
    companyName: nextKind === 'website' ? session.companyName : '',
    summary: session.summary,
    sourceDesignId: nextKind === 'website'
      ? normalizeText(
        session.recordKind === 'design'
          ? session.recordId || session.sourceDesignId
          : session.sourceDesignId
      )
      : '',
    createdAt: existingEntry?.createdAt || timestamp,
    updatedAt: timestamp,
    templateId: draft.templateId,
    draft,
  });

  const nextLibrary = {
    designs: nextKind === 'design'
      ? upsertEntryInCollection(library.designs, entry)
      : library.designs,
    websites: nextKind === 'website'
      ? upsertEntryInCollection(library.websites, entry)
      : library.websites,
  };

  return {
    library: nextLibrary,
    entry,
    session: createSessionFromEntry(entry),
  };
}

export function buildWebsiteFromDesign(library, designEntry) {
  const baseSession = createWebsiteSessionFromDesign(designEntry);
  const nextSession = {
    ...baseSession,
    entryTitle: getNextWebsiteTitle(library, baseSession.entryTitle),
  };

  return saveEntryFromSession(library, nextSession, 'website');
}
