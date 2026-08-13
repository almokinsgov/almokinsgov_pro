(() => {
  'use strict';

  const DATA = window.TRANSPORT_PAGE_DATA;
  const WORKSPACE_KEY = 'transportPageBrowser.workspace.v1';
  const UI_KEY = 'transportPageBrowser.ui';
  const WORKSPACE_TYPE = 'transport-page-browser-workspace';
  const WORKSPACE_SCHEMA = 3;
  const SUPPORTED_WORKSPACE_SCHEMAS = new Set([1, 2, 3]);
  const MAX_PAGE_HISTORY = 60;
  const clone = value => JSON.parse(JSON.stringify(value));
  const storageGet = key => { try { return localStorage.getItem(key); } catch (error) { return null; } };
  const storageSet = (key, value) => { try { localStorage.setItem(key, value); return true; } catch (error) { return false; } };
  const storageRemove = key => { try { localStorage.removeItem(key); return true; } catch (error) { return false; } };

  const stripHtml = html => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html || '';
    return (wrapper.textContent || '').replace(/\s+/g, ' ').trim();
  };

  function normalisePage(raw) {
    const page = clone(raw || {});
    page.id = String(page.id || `custom-${Date.now()}`);
    page.name = String(page.name || 'Untitled page');
    page.breadcrumb = String(page.breadcrumb || page.name);
    page.path = page.breadcrumb.split('>').map(part => part.trim()).filter(Boolean);
    if (!page.path.length) page.path = [page.name];
    page.seo = String(page.seo || '');
    page.status = String(page.status || '');
    page.removed = Boolean(page.removed);
    page.html = {
      current: '',
      commented: '',
      original: '',
      ...(page.html || {})
    };
    page.search = [
      page.name,
      page.breadcrumb,
      page.seo,
      page.status,
      stripHtml(page.html.current),
      stripHtml(page.html.commented),
      stripHtml(page.html.original)
    ].join(' ').toLowerCase();
    return page;
  }

  const basePages = DATA.pages.map(normalisePage);
  const baseById = new Map(basePages.map(page => [page.id, page]));
  let pages = basePages.map(clone).map(normalisePage);
  let byId = new Map(pages.map(page => [page.id, page]));

  const el = {
    sidebar: document.getElementById('sidebar'),
    tree: document.getElementById('tree'),
    search: document.getElementById('pageSearch'),
    showRemoved: document.getElementById('showRemoved'),
    expandAll: document.getElementById('expandAll'),
    collapseAll: document.getElementById('collapseAll'),
    toggleSidebar: document.getElementById('toggleSidebar'),
    datasetSummary: document.getElementById('datasetSummary'),
    breadcrumbLabel: document.getElementById('breadcrumbLabel'),
    pageTitle: document.getElementById('pageTitle'),
    statusLine: document.getElementById('statusLine'),
    metaBreadcrumb: document.getElementById('metaBreadcrumb'),
    metaSeo: document.getElementById('metaSeo'),
    version: document.getElementById('versionSelect'),
    includeH1: document.getElementById('includeH1'),
    includeEditorial: document.getElementById('includeEditorial'),
    includeImages: document.getElementById('includeImages'),
    includePlaceholders: document.getElementById('includePlaceholders'),
    accordionMode: document.getElementById('accordionMode'),
    expandAccordions: document.getElementById('expandAccordions'),
    collapseAccordions: document.getElementById('collapseAccordions'),
    previewAccordionActions: document.getElementById('previewAccordionActions'),
    copyWysiwyg: document.getElementById('copyWysiwyg'),
    copyHtml: document.getElementById('copyHtml'),
    copyText: document.getElementById('copyText'),
    pageView: document.getElementById('pageView'),
    codeView: document.getElementById('codeView'),
    editView: document.getElementById('editView'),
    wrapCode: document.getElementById('wrapCode'),
    wrapCodeLabel: document.getElementById('wrapCodeLabel'),
    prevPage: document.getElementById('prevPage'),
    nextPage: document.getElementById('nextPage'),
    toast: document.getElementById('toast'),
    saveWorkspace: document.getElementById('saveWorkspace'),
    importWorkspace: document.getElementById('importWorkspace'),
    exportWorkspace: document.getElementById('exportWorkspace'),
    resetWorkspace: document.getElementById('resetWorkspace'),
    workspaceFile: document.getElementById('workspaceFile'),
    workspaceIndicator: document.getElementById('workspaceIndicator'),
    savePageTop: document.getElementById('savePageTop'),
    pageSaveStatus: document.getElementById('pageSaveStatus'),
    pageLastSaved: document.getElementById('pageLastSaved'),
    pageSaveRevision: document.getElementById('pageSaveRevision'),
    pageDraftUpdated: document.getElementById('pageDraftUpdated'),
    pageHistoryCount: document.getElementById('pageHistoryCount'),
    workspaceSaveStatus: document.getElementById('workspaceSaveStatus'),
    workspaceLastSaved: document.getElementById('workspaceLastSaved'),
    workspaceSaveRevision: document.getElementById('workspaceSaveRevision'),
    workspaceDraftUpdated: document.getElementById('workspaceDraftUpdated'),
    workspaceHistoryCount: document.getElementById('workspaceHistoryCount'),
    editName: document.getElementById('editName'),
    editBreadcrumb: document.getElementById('editBreadcrumb'),
    editSeo: document.getElementById('editSeo'),
    seoCount: document.getElementById('seoCount'),
    editStatus: document.getElementById('editStatus'),
    editRemoved: document.getElementById('editRemoved'),
    editorVersionLabel: document.getElementById('editorVersionLabel'),
    visualEditorMode: document.getElementById('visualEditorMode'),
    sourceEditorMode: document.getElementById('sourceEditorMode'),
    formatToolbar: document.getElementById('formatToolbar'),
    formatBlock: document.getElementById('formatBlock'),
    insertLink: document.getElementById('insertLink'),
    insertAccordion: document.getElementById('insertAccordion'),
    visualEditor: document.getElementById('visualEditor'),
    sourceEditor: document.getElementById('sourceEditor'),
    editSaveState: document.getElementById('editSaveState'),
    resetVersion: document.getElementById('resetVersion'),
    resetPage: document.getElementById('resetPage'),
    savePage: document.getElementById('savePage'),
    undoPage: document.getElementById('undoPage'),
    redoPage: document.getElementById('redoPage'),
    historyCard: document.getElementById('historyCard'),
    historySummary: document.getElementById('historySummary'),
    historyList: document.getElementById('historyList'),
    historyUndo: document.getElementById('historyUndo'),
    historyRedo: document.getElementById('historyRedo')
  };

  const state = {
    selectedId: null,
    search: '',
    showRemoved: false,
    expanded: new Set(),
    view: 'page',
    editorMode: 'visual'
  };

  const editorContext = {
    pageId: null,
    version: null,
    dirty: false,
    autosaveTimer: null,
    treeTimer: null,
    pendingHistoryLabel: null
  };

  let pageHistory = {};

  let saveInfo = {
    workspace: {
      savedAt: null,
      revision: 0,
      signature: null
    },
    pages: {},
    draftUpdatedAt: null,
    pageDraftUpdatedAt: {}
  };

  const dateTimeFormatter = new Intl.DateTimeFormat('en-NZ', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  function formatSavedTime(value, fallback = 'Not manually saved') {
    if (!value) return fallback;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : dateTimeFormatter.format(date);
  }

  function fingerprint(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  const versionLabels = {
    current: 'Current suggested content',
    commented: 'V2 commented content',
    original: 'V1 original content'
  };

  const statusKind = status => {
    const s = (status || '').toLowerCase();
    if (s.startsWith('removed')) return 'removed';
    if (s.includes('new page')) return 'new';
    return 'normal';
  };

  const comparablePage = page => ({
    name: page.name,
    breadcrumb: page.breadcrumb,
    seo: page.seo,
    status: page.status,
    removed: Boolean(page.removed),
    html: {
      current: page.html.current || '',
      commented: page.html.commented || '',
      original: page.html.original || ''
    }
  });

  function isPageModified(page) {
    const base = baseById.get(page.id);
    if (!base) return true;
    return JSON.stringify(comparablePage(page)) !== JSON.stringify(comparablePage(base));
  }

  function modifiedPageCount() {
    return pages.filter(isPageModified).length;
  }

  function pageSignature(page) {
    return page ? fingerprint(comparablePage(page)) : null;
  }

  function workspaceSignature() {
    return fingerprint(pages.map(page => [page.id, pageSignature(page)]));
  }

  function historySnapshot(page) {
    return clone(comparablePage(page));
  }

  function normalisePageHistory(raw = {}) {
    if (!raw || typeof raw !== 'object') return {};
    const output = {};
    for (const [pageId, value] of Object.entries(raw)) {
      if (!value || !Array.isArray(value.entries) || !value.entries.length) continue;
      const entries = value.entries.map((entry, index) => {
        const snapshot = entry?.snapshot && typeof entry.snapshot === 'object'
          ? clone(entry.snapshot)
          : null;
        if (!snapshot) return null;
        return {
          id: String(entry.id || `${pageId}-${index}-${Date.now()}`),
          createdAt: entry.createdAt || null,
          reason: String(entry.reason || 'edit'),
          label: String(entry.label || 'Page edit'),
          version: entry.version || null,
          saveRevision: Number(entry.saveRevision) || null,
          signature: entry.signature || fingerprint(snapshot),
          snapshot
        };
      }).filter(Boolean);
      if (!entries.length) continue;
      output[String(pageId)] = {
        entries,
        pointer: Math.max(0, Math.min(Number(value.pointer) || 0, entries.length - 1))
      };
    }
    return output;
  }

  function ensurePageHistory(page) {
    if (!page) return null;
    let history = pageHistory[page.id];
    if (history?.entries?.length) return history;
    const baseline = baseById.get(page.id) || page;
    const snapshot = historySnapshot(baseline);
    history = {
      entries: [{
        id: `${page.id}-baseline`,
        createdAt: null,
        reason: 'baseline',
        label: 'Bundled baseline',
        version: null,
        saveRevision: null,
        signature: fingerprint(snapshot),
        snapshot
      }],
      pointer: 0
    };
    pageHistory[page.id] = history;
    return history;
  }

  function pageHistoryUserCount(page) {
    const history = page ? pageHistory[page.id] : null;
    return history?.entries?.length ? Math.max(0, history.entries.length - 1) : 0;
  }

  function totalHistoryCount() {
    return Object.values(pageHistory).reduce((total, history) => {
      return total + (history?.entries?.length ? Math.max(0, history.entries.length - 1) : 0);
    }, 0);
  }

  function recordPageHistory(page, {
    reason = 'edit',
    label = 'Page edit',
    version = null,
    saveRevision = null,
    force = false,
    preserveFuture = false
  } = {}) {
    if (!page) return false;
    const history = ensurePageHistory(page);
    if (!preserveFuture && history.pointer < history.entries.length - 1) {
      history.entries = history.entries.slice(0, history.pointer + 1);
    }
    const snapshot = historySnapshot(page);
    const signature = fingerprint(snapshot);
    const active = history.entries[history.pointer] || history.entries[history.entries.length - 1];
    if (!force && active?.signature === signature) return false;
    const now = new Date().toISOString();
    history.entries.push({
      id: `${page.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      reason,
      label,
      version,
      saveRevision,
      signature,
      snapshot
    });
    if (history.entries.length > MAX_PAGE_HISTORY) {
      const removeAt = history.entries[0]?.reason === 'baseline' ? 1 : 0;
      history.entries.splice(removeAt, 1);
    }
    history.pointer = history.entries.length - 1;
    return true;
  }

  function applyPageSnapshot(page, snapshot) {
    if (!page || !snapshot) return;
    page.name = String(snapshot.name || 'Untitled page');
    page.breadcrumb = String(snapshot.breadcrumb || page.name);
    page.seo = String(snapshot.seo || '');
    page.status = String(snapshot.status || '');
    page.removed = Boolean(snapshot.removed);
    page.html = {
      current: String(snapshot.html?.current || ''),
      commented: String(snapshot.html?.commented || ''),
      original: String(snapshot.html?.original || '')
    };
    rebuildPage(page);
  }

  function findUndoHistoryIndex(page) {
    const history = page ? ensurePageHistory(page) : null;
    if (!history || history.pointer <= 0) return -1;
    const currentSignature = history.entries[history.pointer]?.signature;
    for (let index = history.pointer - 1; index >= 0; index -= 1) {
      if (history.entries[index]?.signature !== currentSignature) return index;
    }
    return -1;
  }

  function findRedoHistoryIndex(page) {
    const history = page ? ensurePageHistory(page) : null;
    if (!history || history.pointer >= history.entries.length - 1) return -1;
    const currentSignature = history.entries[history.pointer]?.signature;
    for (let index = history.pointer + 1; index < history.entries.length; index += 1) {
      if (history.entries[index]?.signature !== currentSignature) return index;
    }
    return -1;
  }

  function refreshAfterHistoryChange(page, message = null) {
    if (!page) return;
    rebuildPage(page);
    persistWorkspace({ silent: true, touchDraft: true, pageId: page.id });
    renderTree();
    renderPage();
    if (state.view === 'edit') loadEditor(page, el.version.value, { force: true });
    updateWorkspaceIndicator();
    renderHistory();
    if (message) showToast(message);
  }

  function undoPageHistory() {
    if (state.view === 'edit' && editorContext.dirty) commitEditorToPage({ silent: true });
    const page = currentPage();
    if (!page) return;
    const history = ensurePageHistory(page);
    const targetIndex = findUndoHistoryIndex(page);
    if (targetIndex < 0) return;
    history.pointer = targetIndex;
    applyPageSnapshot(page, history.entries[targetIndex].snapshot);
    refreshAfterHistoryChange(page, 'Page history undone');
  }

  function redoPageHistory() {
    if (state.view === 'edit' && editorContext.dirty) commitEditorToPage({ silent: true });
    const page = currentPage();
    if (!page) return;
    const history = ensurePageHistory(page);
    const targetIndex = findRedoHistoryIndex(page);
    if (targetIndex < 0) return;
    history.pointer = targetIndex;
    applyPageSnapshot(page, history.entries[targetIndex].snapshot);
    refreshAfterHistoryChange(page, 'Page history redone');
  }

  function restoreHistoryEntry(entryId) {
    if (state.view === 'edit' && editorContext.dirty) commitEditorToPage({ silent: true });
    const page = currentPage();
    if (!page) return;
    const history = ensurePageHistory(page);
    const entry = history.entries.find(item => item.id === entryId);
    if (!entry) return;
    if (!window.confirm(`Restore “${page.name}” to the selected history entry? The current state will remain in history.`)) return;
    applyPageSnapshot(page, entry.snapshot);
    recordPageHistory(page, {
      reason: 'restore',
      label: `Restored from ${entry.label}`,
      version: entry.version,
      force: true,
      preserveFuture: true
    });
    refreshAfterHistoryChange(page, 'History entry restored');
  }

  function renderHistory() {
    if (!el.historyList) return;
    const page = currentPage();
    if (!page) {
      el.historySummary.textContent = 'No page selected';
      el.historyList.innerHTML = '<div class="history-empty">Select a page to view its edit history.</div>';
      el.undoPage.disabled = true;
      el.redoPage.disabled = true;
      el.historyUndo.disabled = true;
      el.historyRedo.disabled = true;
      return;
    }
    const history = ensurePageHistory(page);
    const undoIndex = findUndoHistoryIndex(page);
    const redoIndex = findRedoHistoryIndex(page);
    const canUndo = undoIndex >= 0;
    const canRedo = redoIndex >= 0;
    el.undoPage.disabled = !canUndo;
    el.redoPage.disabled = !canRedo;
    el.historyUndo.disabled = !canUndo;
    el.historyRedo.disabled = !canRedo;
    const userCount = Math.max(0, history.entries.length - 1);
    el.historySummary.textContent = userCount
      ? `${userCount} recoverable snapshot${userCount === 1 ? '' : 's'}`
      : 'Bundled baseline only';
    el.historyList.innerHTML = '';
    history.entries.map((entry, index) => ({ entry, index })).reverse().forEach(({ entry, index }) => {
      const row = document.createElement('div');
      row.className = `history-entry${index === history.pointer ? ' current' : ''}`;
      const main = document.createElement('div');
      main.className = 'history-entry-main';
      const title = document.createElement('div');
      title.className = 'history-entry-title';
      title.textContent = entry.label;
      const meta = document.createElement('div');
      meta.className = 'history-entry-meta';
      const time = document.createElement('span');
      time.textContent = entry.createdAt ? formatSavedTime(entry.createdAt) : 'Original bundled content';
      meta.appendChild(time);
      if (entry.version) {
        const version = document.createElement('span');
        version.textContent = versionLabels[entry.version] || entry.version;
        meta.appendChild(version);
      }
      const badge = document.createElement('span');
      badge.className = `history-entry-badge ${entry.reason}`;
      badge.textContent = entry.reason === 'baseline' ? 'Baseline' : entry.reason;
      meta.appendChild(badge);
      if (entry.saveRevision) {
        const revision = document.createElement('span');
        revision.textContent = `Page save r${entry.saveRevision}`;
        meta.appendChild(revision);
      }
      main.append(title, meta);
      const actions = document.createElement('div');
      actions.className = 'history-entry-actions';
      if (index === history.pointer) {
        const current = document.createElement('span');
        current.className = 'history-current-label';
        current.textContent = 'Current';
        actions.appendChild(current);
      } else {
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.className = 'history-restore';
        restore.textContent = 'Restore';
        restore.addEventListener('click', () => restoreHistoryEntry(entry.id));
        actions.appendChild(restore);
      }
      row.append(main, actions);
      el.historyList.appendChild(row);
    });
  }

  function normaliseSaveInfo(raw = {}) {
    const workspace = raw.workspace || {};
    const pageData = raw.pages && typeof raw.pages === 'object' ? raw.pages : {};
    return {
      workspace: {
        savedAt: workspace.savedAt || null,
        revision: Number(workspace.revision) || 0,
        signature: workspace.signature || null
      },
      pages: Object.fromEntries(Object.entries(pageData).map(([id, info]) => [String(id), {
        savedAt: info?.savedAt || null,
        revision: Number(info?.revision) || 0,
        signature: info?.signature || null,
        version: info?.version || null,
        nameAtSave: info?.nameAtSave || null
      }])),
      draftUpdatedAt: raw.draftUpdatedAt || null,
      pageDraftUpdatedAt: raw.pageDraftUpdatedAt && typeof raw.pageDraftUpdatedAt === 'object'
        ? { ...raw.pageDraftUpdatedAt }
        : {}
    };
  }

  function pageCheckpointState(page) {
    if (!page) return { kind: 'baseline', text: 'No page selected' };
    if (editorContext.dirty && editorContext.pageId === page.id) {
      return { kind: 'draft', text: 'Unsaved editor changes' };
    }
    const info = saveInfo.pages[page.id];
    if (!info?.signature) {
      return isPageModified(page)
        ? { kind: 'draft', text: 'Draft only, not manually saved' }
        : { kind: 'baseline', text: 'Bundled baseline' };
    }
    return info.signature === pageSignature(page)
      ? { kind: 'saved', text: 'Saved checkpoint' }
      : { kind: 'draft', text: 'Changes since page save' };
  }

  function workspaceCheckpointState() {
    if (editorContext.dirty) return { kind: 'draft', text: 'Unsaved editor changes' };
    const info = saveInfo.workspace;
    if (!info?.signature) {
      return modifiedPageCount()
        ? { kind: 'draft', text: 'Draft only, not manually saved' }
        : { kind: 'baseline', text: 'Bundled workspace' };
    }
    return info.signature === workspaceSignature()
      ? { kind: 'saved', text: 'Saved checkpoint' }
      : { kind: 'draft', text: 'Changes since workspace save' };
  }

  function setSaveStatus(element, stateInfo) {
    if (!element) return;
    element.textContent = stateInfo.text;
    element.classList.remove('saved', 'draft', 'baseline');
    element.classList.add(stateInfo.kind);
  }

  function updateSaveInfoPanel() {
    const page = currentPage();
    const pageInfo = page ? saveInfo.pages[page.id] : null;
    setSaveStatus(el.pageSaveStatus, pageCheckpointState(page));
    el.pageLastSaved.textContent = formatSavedTime(pageInfo?.savedAt);
    el.pageSaveRevision.textContent = String(pageInfo?.revision || 0);
    el.pageDraftUpdated.textContent = formatSavedTime(
      page ? saveInfo.pageDraftUpdatedAt[page.id] : null,
      'No draft changes'
    );
    const pageHistoryCount = page ? pageHistoryUserCount(page) : 0;
    el.pageHistoryCount.textContent = page
      ? (pageHistoryCount ? `${pageHistoryCount} snapshot${pageHistoryCount === 1 ? '' : 's'}` : 'Baseline only')
      : 'No page selected';

    setSaveStatus(el.workspaceSaveStatus, workspaceCheckpointState());
    el.workspaceLastSaved.textContent = formatSavedTime(saveInfo.workspace.savedAt);
    el.workspaceSaveRevision.textContent = String(saveInfo.workspace.revision || 0);
    el.workspaceDraftUpdated.textContent = formatSavedTime(saveInfo.draftUpdatedAt, 'No draft changes');
    const workspaceHistoryEntries = totalHistoryCount();
    el.workspaceHistoryCount.textContent = workspaceHistoryEntries
      ? `${workspaceHistoryEntries} page snapshot${workspaceHistoryEntries === 1 ? '' : 's'}`
      : 'No page history';
    if (el.savePageTop) el.savePageTop.disabled = !page;
  }

  function rebuildPage(page) {
    page.path = page.breadcrumb.split('>').map(part => part.trim()).filter(Boolean);
    if (!page.path.length) page.path = [page.name || 'Untitled page'];
    page.search = [
      page.name,
      page.breadcrumb,
      page.seo,
      page.status,
      stripHtml(page.html.current),
      stripHtml(page.html.commented),
      stripHtml(page.html.original)
    ].join(' ').toLowerCase();
  }

  function rebuildIndexes() {
    pages.forEach(rebuildPage);
    byId = new Map(pages.map(page => [page.id, page]));
  }

  const visiblePages = () => pages.filter(page => state.showRemoved || !page.removed);

  function buildTreeModel() {
    const root = { key: '', name: '', children: new Map(), page: null };
    for (const page of visiblePages()) {
      let node = root;
      page.path.forEach((segment, index) => {
        const key = page.path.slice(0, index + 1).join(' > ');
        if (!node.children.has(segment)) {
          node.children.set(segment, { key, name: segment, children: new Map(), page: null });
        }
        node = node.children.get(segment);
      });
      node.page = page;
    }
    return root;
  }

  function pageButton(page, depth, hasChildren, key) {
    const row = document.createElement('div');
    row.className = `tree-row${page && page.id === state.selectedId ? ' selected' : ''}${page && page.removed ? ' removed' : ''}${page && isPageModified(page) ? ' edited' : ''}`;
    row.style.paddingLeft = `${Math.max(0, depth * 3)}px`;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = `tree-toggle${hasChildren ? '' : ' placeholder'}`;
    toggle.textContent = hasChildren ? (state.expanded.has(key) ? '▾' : '▸') : '•';
    toggle.setAttribute('aria-label', state.expanded.has(key) ? 'Collapse section' : 'Expand section');
    if (hasChildren) {
      toggle.addEventListener('click', event => {
        event.stopPropagation();
        if (state.expanded.has(key)) state.expanded.delete(key); else state.expanded.add(key);
        saveUiState();
        renderTree();
      });
    }
    row.appendChild(toggle);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tree-page';
    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = page ? page.name : key.split(' > ').pop();
    button.appendChild(name);
    if (page && page.status) {
      const status = document.createElement('span');
      status.className = 'tree-status';
      status.textContent = page.status;
      button.appendChild(status);
    }
    if (page && isPageModified(page)) {
      const edited = document.createElement('span');
      edited.className = 'tree-edited';
      edited.textContent = 'Edited';
      button.appendChild(edited);
    }
    if (page && saveInfo.pages[page.id]?.revision) {
      const checkpoint = pageCheckpointState(page);
      const saved = document.createElement('span');
      saved.className = `tree-save-state ${checkpoint.kind}`;
      saved.textContent = checkpoint.kind === 'saved'
        ? `Saved r${saveInfo.pages[page.id].revision}`
        : `Changed after r${saveInfo.pages[page.id].revision}`;
      button.appendChild(saved);
    }
    button.addEventListener('click', () => {
      if (page) selectPage(page.id);
      else if (hasChildren) {
        if (state.expanded.has(key)) state.expanded.delete(key); else state.expanded.add(key);
        saveUiState();
        renderTree();
      }
    });
    row.appendChild(button);
    return row;
  }

  function renderNode(node, depth, container) {
    for (const child of node.children.values()) {
      const hasChildren = child.children.size > 0;
      const row = pageButton(child.page, depth, hasChildren, child.key);
      container.appendChild(row);
      if (hasChildren && state.expanded.has(child.key)) {
        const children = document.createElement('div');
        children.className = 'tree-children';
        renderNode(child, depth + 1, children);
        container.appendChild(children);
      }
    }
  }

  function renderSearchResults() {
    const query = state.search.toLowerCase().trim();
    const terms = query.split(/\s+/).filter(Boolean);
    const matches = visiblePages().filter(page => terms.every(term => page.search.includes(term)));
    el.tree.innerHTML = '';
    if (!matches.length) {
      el.tree.innerHTML = '<div class="tree-empty">No matching pages.</div>';
      return;
    }
    for (const page of matches) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `search-result${page.id === state.selectedId ? ' selected' : ''}${page.removed ? ' removed' : ''}${isPageModified(page) ? ' edited' : ''}`;
      button.innerHTML = '<div class="result-title"></div><div class="result-path"></div>';
      const pageSave = saveInfo.pages[page.id];
      const saveSuffix = pageSave?.revision
        ? (pageCheckpointState(page).kind === 'saved' ? ` · Saved r${pageSave.revision}` : ` · Changed after r${pageSave.revision}`)
        : '';
      button.querySelector('.result-title').textContent = `${page.name}${isPageModified(page) ? ' · Edited' : ''}${saveSuffix}`;
      button.querySelector('.result-path').textContent = page.breadcrumb;
      button.addEventListener('click', () => selectPage(page.id));
      el.tree.appendChild(button);
    }
  }

  function renderTree() {
    if (state.search.trim()) {
      renderSearchResults();
      return;
    }
    el.tree.innerHTML = '';
    renderNode(buildTreeModel(), 0, el.tree);
  }

  function selectPage(id, { updateHash = true } = {}) {
    if (state.view === 'edit') commitEditorToPage({ silent: true });
    const page = byId.get(id);
    if (!page) return;
    if (page.removed && !state.showRemoved) {
      state.showRemoved = true;
      el.showRemoved.checked = true;
    }
    state.selectedId = id;
    page.path.forEach((_, index) => state.expanded.add(page.path.slice(0, index + 1).join(' > ')));
    saveUiState();
    if (updateHash) history.replaceState(null, '', `#${id}`);
    renderTree();
    renderPage();
    if (window.innerWidth <= 760) el.sidebar.classList.remove('open');
  }

  function currentPage() {
    return byId.get(state.selectedId) || null;
  }

  function selectedHtml() {
    const page = currentPage();
    if (!page) return '';
    return page.html[el.version.value] || '';
  }

  function cleanCmsHtml() {
    const source = selectedHtml();
    if (!source) return '';
    const wrapper = document.createElement('div');
    wrapper.innerHTML = source;

    if (!el.includeH1.checked) {
      const firstH1 = wrapper.querySelector('h1');
      if (firstH1) firstH1.remove();
    }
    if (!el.includeEditorial.checked) {
      wrapper.querySelectorAll('[data-editorial-note]').forEach(node => node.remove());
    }
    if (!el.includeImages.checked) {
      wrapper.querySelectorAll('[data-demo-media], figure.content-image, img').forEach(node => node.remove());
    }
    if (!el.includePlaceholders.checked) {
      wrapper.querySelectorAll('[data-cms-placeholder="dynamic"], .cms-placeholder').forEach(node => node.remove());
    }

    if (el.accordionMode.value === 'expanded') {
      wrapper.querySelectorAll('details').forEach(details => {
        const summary = details.querySelector(':scope > summary');
        const heading = document.createElement('h3');
        heading.textContent = summary ? summary.textContent.trim() : 'More information';
        const fragment = document.createDocumentFragment();
        fragment.appendChild(heading);
        [...details.children].forEach(child => {
          if (child !== summary) {
            while (child.firstChild) fragment.appendChild(child.firstChild);
          }
        });
        details.replaceWith(fragment);
      });
    }

    wrapper.querySelectorAll('*').forEach(node => {
      [...node.attributes].forEach(attr => {
        const tag = node.tagName;
        const keep =
          (tag === 'A' && ['href', 'title', 'target'].includes(attr.name)) ||
          (tag === 'IMG' && ['src', 'alt', 'title', 'width', 'height'].includes(attr.name)) ||
          (tag === 'DETAILS' && attr.name === 'open');
        if (keep) return;
        node.removeAttribute(attr.name);
      });
    });
    return wrapper.innerHTML.trim();
  }

  function formatHtml(source) {
    if (!source) return '';
    const tokens = source.replace(/>\s*</g, '>\n<').split('\n');
    let depth = 0;
    const lines = [];
    const voidTags = new Set(['br', 'hr', 'img', 'meta', 'link', 'input']);
    for (let token of tokens) {
      token = token.trim();
      if (!token) continue;
      const closing = token.match(/^<\/([a-z0-9]+)/i);
      const opening = token.match(/^<([a-z0-9]+)/i);
      if (closing) depth = Math.max(0, depth - 1);
      lines.push('  '.repeat(depth) + token);
      if (opening) {
        const tag = opening[1].toLowerCase();
        const sameLineClosed = new RegExp(`<\\/${tag}>$`, 'i').test(token);
        const selfClosing = /\/>$/.test(token) || voidTags.has(tag);
        if (!sameLineClosed && !selfClosing && !token.startsWith('</')) depth += 1;
      }
    }
    return lines.join('\n');
  }

  function renderStatusAndMetadata(page) {
    el.pageTitle.textContent = page.name;
    el.breadcrumbLabel.textContent = page.breadcrumb;
    el.metaBreadcrumb.textContent = page.breadcrumb || 'Not supplied';
    el.metaSeo.textContent = page.seo || 'Not supplied';
    el.statusLine.innerHTML = '';

    const badge = document.createElement('span');
    if (page.status) {
      const kind = statusKind(page.status);
      badge.className = `status-badge${kind !== 'normal' ? ` ${kind}` : ''}`;
      badge.textContent = page.status;
    } else {
      badge.className = 'status-badge';
      badge.textContent = 'Current page';
    }
    el.statusLine.appendChild(badge);

    if (isPageModified(page)) {
      const edited = document.createElement('span');
      edited.className = 'status-badge edited';
      edited.textContent = 'Workspace edited';
      el.statusLine.appendChild(edited);
    }

    const media = page.demoMedia || {};
    const mediaParts = [];
    if (media.images) mediaParts.push(`${media.images} image${media.images === 1 ? '' : 's'}`);
    if (media.placeholders) mediaParts.push(`${media.placeholders} dynamic placeholder${media.placeholders === 1 ? '' : 's'}`);
    if (mediaParts.length) {
      const mediaBadge = document.createElement('span');
      mediaBadge.className = 'status-badge media';
      mediaBadge.textContent = `Demo media: ${mediaParts.join(' · ')}`;
      el.statusLine.appendChild(mediaBadge);
    }
  }

  function renderPage() {
    const page = currentPage();
    if (!page) return;

    renderStatusAndMetadata(page);
    const html = selectedHtml();
    el.pageView.innerHTML = '';
    if (el.version.value === 'current' && page.removed && !html) {
      const box = document.createElement('div');
      box.className = 'removed-state';
      box.innerHTML = '<strong>This page is removed from the current structure.</strong><br>Select V2 commented content or V1 original content to view its historical content.';
      el.pageView.appendChild(box);
    }

    if (html) {
      const content = document.createElement('div');
      content.innerHTML = html;
      while (content.firstChild) el.pageView.appendChild(content.firstChild);
    } else if (!(el.version.value === 'current' && page.removed)) {
      el.pageView.innerHTML += '<div class="empty-state"><div><strong>No content in this version</strong>This content version is blank for the selected page.</div></div>';
    }

    const clean = cleanCmsHtml();
    el.codeView.querySelector('code').textContent = formatHtml(clean);
    const canCopy = Boolean(clean);
    el.copyWysiwyg.disabled = !canCopy;
    el.copyHtml.disabled = !canCopy;
    el.copyText.disabled = !canCopy;

    if (state.view === 'edit') loadEditor(page, el.version.value);
    updatePrevNext();
    updateWorkspaceIndicator();
  }

  function updatePrevNext() {
    const list = visiblePages();
    const index = list.findIndex(page => page.id === state.selectedId);
    el.prevPage.disabled = index <= 0;
    el.nextPage.disabled = index < 0 || index >= list.length - 1;
  }

  function stepPage(delta) {
    const list = visiblePages();
    const index = list.findIndex(page => page.id === state.selectedId);
    const next = list[index + delta];
    if (next) selectPage(next.id);
  }

  function switchView(view) {
    if (state.view === 'edit' && view !== 'edit') commitEditorToPage({ silent: true });
    state.view = ['page', 'code', 'edit'].includes(view) ? view : 'page';
    const pageMode = state.view === 'page';
    const codeMode = state.view === 'code';
    const editMode = state.view === 'edit';
    el.pageView.hidden = !pageMode;
    el.codeView.hidden = !codeMode;
    el.editView.hidden = !editMode;
    el.wrapCodeLabel.hidden = !codeMode;
    el.previewAccordionActions.hidden = !pageMode;
    document.querySelectorAll('.tab').forEach(tab => {
      const active = tab.dataset.view === state.view;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    if (editMode && currentPage()) loadEditor(currentPage(), el.version.value, { force: true });
    saveUiState();
  }

  function showToast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => el.toast.classList.remove('show'), 1800);
  }

  function htmlToPlainText(htmlString) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = htmlString;
    return (wrapper.innerText || wrapper.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  async function copyPlain(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }

  async function copyRich(htmlString) {
    const plain = htmlToPlainText(htmlString);
    if (navigator.clipboard && window.ClipboardItem && window.isSecureContext) {
      try {
        const item = new ClipboardItem({
          'text/html': new Blob([htmlString], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' })
        });
        await navigator.clipboard.write([item]);
        return true;
      } catch (error) {
        // Fall through to local-file compatible methods.
      }
    }

    let copied = false;
    const onCopy = event => {
      if (!event.clipboardData) return;
      event.clipboardData.setData('text/html', htmlString);
      event.clipboardData.setData('text/plain', plain);
      event.preventDefault();
      copied = true;
    };
    document.addEventListener('copy', onCopy, { once: true });
    document.execCommand('copy');
    if (copied) return true;

    const holder = document.createElement('div');
    holder.contentEditable = 'true';
    holder.innerHTML = htmlString;
    holder.style.position = 'fixed';
    holder.style.left = '-9999px';
    holder.style.top = '0';
    document.body.appendChild(holder);
    const range = document.createRange();
    range.selectNodeContents(holder);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const ok = document.execCommand('copy');
    selection.removeAllRanges();
    holder.remove();
    return ok;
  }

  function getUiState() {
    return {
      selectedId: state.selectedId,
      showRemoved: state.showRemoved,
      expanded: [...state.expanded],
      view: state.view,
      version: el.version.value,
      includeH1: el.includeH1.checked,
      includeEditorial: el.includeEditorial.checked,
      includeImages: el.includeImages.checked,
      includePlaceholders: el.includePlaceholders.checked,
      wrapCode: el.wrapCode.checked,
      accordionMode: el.accordionMode.value,
      editorMode: state.editorMode
    };
  }

  function applyUiState(saved = {}) {
    state.showRemoved = Boolean(saved.showRemoved);
    state.expanded = new Set(Array.isArray(saved.expanded) ? saved.expanded : ['Transport']);
    state.view = ['page', 'code', 'edit'].includes(saved.view) ? saved.view : 'page';
    state.editorMode = saved.editorMode === 'source' ? 'source' : 'visual';
    state.selectedId = saved.selectedId || state.selectedId;
    el.version.value = ['current', 'commented', 'original'].includes(saved.version) ? saved.version : 'current';
    el.includeH1.checked = Boolean(saved.includeH1);
    el.includeEditorial.checked = Boolean(saved.includeEditorial);
    el.includeImages.checked = saved.includeImages !== false;
    el.includePlaceholders.checked = saved.includePlaceholders !== false;
    el.wrapCode.checked = saved.wrapCode !== false;
    el.accordionMode.value = saved.accordionMode === 'expanded' ? 'expanded' : 'keep';
    el.showRemoved.checked = state.showRemoved;
    setEditorMode(state.editorMode, { sync: false });
  }

  function saveUiState() {
    storageSet(UI_KEY, JSON.stringify(getUiState()));
  }

  function loadUiState() {
    try {
      applyUiState(JSON.parse(storageGet(UI_KEY) || '{}'));
    } catch (error) {
      state.expanded = new Set(['Transport']);
      el.showRemoved.checked = false;
    }
  }

  function serialisablePage(page) {
    const result = comparablePage(page);
    return { id: page.id, ...result };
  }

  function workspacePayload({ exportedAt = null } = {}) {
    return {
      workspaceType: WORKSPACE_TYPE,
      schemaVersion: WORKSPACE_SCHEMA,
      appVersion: DATA.appVersion,
      sourceWorkbook: DATA.sourceWorkbook,
      updatedAt: saveInfo.draftUpdatedAt,
      savedAt: saveInfo.workspace.savedAt,
      exportedAt,
      saveInfo: clone(saveInfo),
      pageHistory: clone(pageHistory),
      pages: pages.map(serialisablePage),
      ui: getUiState()
    };
  }

  function persistWorkspace({ silent = true, touchDraft = false, pageId = null } = {}) {
    try {
      if (touchDraft) {
        const now = new Date().toISOString();
        saveInfo.draftUpdatedAt = now;
        if (pageId) saveInfo.pageDraftUpdatedAt[String(pageId)] = now;
      }
      if (!storageSet(WORKSPACE_KEY, JSON.stringify(workspacePayload()))) throw new Error('Local storage unavailable');
      saveUiState();
      updateWorkspaceIndicator();
      updateSaveInfoPanel();
      if (el.editSaveState && !editorContext.dirty) el.editSaveState.textContent = 'Draft autosaved';
      if (!silent) showToast('Draft saved locally');
      return true;
    } catch (error) {
      if (el.editSaveState) el.editSaveState.textContent = 'Local save failed';
      if (!silent) showToast('Could not save draft locally');
      return false;
    }
  }

  function applyWorkspacePages(importedPages) {
    if (!Array.isArray(importedPages) || !importedPages.length) throw new Error('Workspace has no pages');
    const importedById = new Map(importedPages.map(page => [String(page.id), page]));
    const merged = basePages.map(base => {
      const imported = importedById.get(base.id);
      if (!imported) return clone(base);
      importedById.delete(base.id);
      return normalisePage({
        ...clone(base),
        ...clone(imported),
        html: { ...clone(base.html), ...(clone(imported.html || {})) }
      });
    });
    for (const imported of importedById.values()) merged.push(normalisePage(imported));
    pages = merged;
    rebuildIndexes();
  }

  function loadWorkspaceFromStorage() {
    try {
      const saved = JSON.parse(storageGet(WORKSPACE_KEY) || 'null');
      if (!saved || saved.workspaceType !== WORKSPACE_TYPE || !Array.isArray(saved.pages)) return;
      applyWorkspacePages(saved.pages);
      if (saved.saveInfo) {
        saveInfo = normaliseSaveInfo(saved.saveInfo);
      } else if (saved.savedAt) {
        // v0.3.0 stored only an autosave timestamp, not a manual checkpoint.
        saveInfo = normaliseSaveInfo({ draftUpdatedAt: saved.savedAt });
      }
      pageHistory = normalisePageHistory(saved.pageHistory || {});
    } catch (error) {
      console.warn('Stored workspace could not be loaded.', error);
    }
  }

  function updateWorkspaceIndicator() {
    const count = modifiedPageCount();
    el.workspaceIndicator.textContent = count ? `${count} edited page${count === 1 ? '' : 's'}` : 'No workspace edits';
    el.workspaceIndicator.classList.toggle('has-edits', count > 0);
    el.resetWorkspace.disabled = count === 0;
    updateDatasetSummary();
    updateSaveInfoPanel();
  }

  function updateDatasetSummary() {
    const removed = pages.filter(page => page.removed).length;
    const current = pages.length - removed;
    el.datasetSummary.textContent = `${current} current pages · ${removed} removed · v${DATA.appVersion}`;
  }

  function scheduleAutosave(historyLabel = null) {
    editorContext.dirty = true;
    if (historyLabel) editorContext.pendingHistoryLabel = historyLabel;
    el.editSaveState.textContent = 'Unsaved editor changes';
    updateSaveInfoPanel();
    clearTimeout(editorContext.autosaveTimer);
    editorContext.autosaveTimer = setTimeout(() => commitEditorToPage({ silent: true }), 700);
  }

  function scheduleTreeRefresh() {
    clearTimeout(editorContext.treeTimer);
    editorContext.treeTimer = setTimeout(() => {
      renderTree();
      updatePrevNext();
    }, 220);
  }

  function syncEditorContentToPage(page, version) {
    if (!page || !version) return;
    const html = state.editorMode === 'source' ? el.sourceEditor.value : el.visualEditor.innerHTML;
    page.html[version] = html.trim();
    rebuildPage(page);
  }

  function commitEditorToPage({ silent = false } = {}) {
    clearTimeout(editorContext.autosaveTimer);
    const page = byId.get(editorContext.pageId);
    const wasDirty = editorContext.dirty;
    const historyLabel = editorContext.pendingHistoryLabel || `Edited ${versionLabels[editorContext.version] || 'page content'}`;
    if (page && editorContext.version) syncEditorContentToPage(page, editorContext.version);
    if (page && wasDirty) {
      recordPageHistory(page, {
        reason: 'edit',
        label: historyLabel,
        version: editorContext.version
      });
    }
    editorContext.dirty = false;
    editorContext.pendingHistoryLabel = null;
    persistWorkspace({ silent: true, touchDraft: Boolean(page && wasDirty), pageId: page?.id || null });
    if (page) {
      renderStatusAndMetadata(page);
      const clean = cleanCmsHtml();
      el.codeView.querySelector('code').textContent = formatHtml(clean);
      renderTree();
      renderHistory();
    }
    if (!silent) showToast('Draft autosaved');
  }

  function saveCurrentPageCheckpoint() {
    if (state.view === 'edit') commitEditorToPage({ silent: true });
    const page = currentPage();
    if (!page) return;
    const previous = saveInfo.pages[page.id] || {};
    const now = new Date().toISOString();
    const nextRevision = (Number(previous.revision) || 0) + 1;
    saveInfo.pages[page.id] = {
      savedAt: now,
      revision: nextRevision,
      signature: pageSignature(page),
      version: el.version.value,
      nameAtSave: page.name
    };
    recordPageHistory(page, {
      reason: 'save',
      label: `Page save checkpoint r${nextRevision}`,
      version: el.version.value,
      saveRevision: nextRevision,
      force: true
    });
    saveInfo.draftUpdatedAt = now;
    saveInfo.pageDraftUpdatedAt[page.id] = now;
    persistWorkspace({ silent: true });
    updateSaveInfoPanel();
    renderTree();
    renderHistory();
    el.editSaveState.textContent = `Page saved · revision ${nextRevision}`;
    showToast(`Page saved · revision ${nextRevision}`);
  }

  function saveWorkspaceCheckpoint() {
    if (state.view === 'edit') commitEditorToPage({ silent: true });
    const previous = saveInfo.workspace || {};
    const now = new Date().toISOString();
    saveInfo.workspace = {
      savedAt: now,
      revision: (Number(previous.revision) || 0) + 1,
      signature: workspaceSignature(),
      editedPagesAtSave: modifiedPageCount(),
      pageCountAtSave: pages.length
    };
    saveInfo.draftUpdatedAt = now;
    persistWorkspace({ silent: true });
    updateSaveInfoPanel();
    showToast(`Workspace saved · revision ${saveInfo.workspace.revision}`);
  }

  function loadEditor(page, version, { force = false } = {}) {
    if (!page) return;
    if (!force && editorContext.pageId === page.id && editorContext.version === version) return;
    if (editorContext.dirty) commitEditorToPage({ silent: true });

    editorContext.pageId = page.id;
    editorContext.version = version;
    editorContext.dirty = false;
    editorContext.pendingHistoryLabel = null;
    el.editName.value = page.name;
    el.editBreadcrumb.value = page.breadcrumb;
    el.editSeo.value = page.seo;
    el.editStatus.value = page.status;
    el.editRemoved.checked = page.removed;
    el.seoCount.textContent = `${page.seo.length} characters`;
    el.editorVersionLabel.textContent = versionLabels[version] || version;
    el.visualEditor.innerHTML = page.html[version] || '';
    el.sourceEditor.value = formatHtml(page.html[version] || '');
    el.editSaveState.textContent = pageCheckpointState(page).text;
    setEditorMode(state.editorMode, { sync: false });
    renderHistory();
  }

  function updateMetadataFromEditor() {
    const page = currentPage();
    if (!page) return;
    page.name = el.editName.value.trim() || 'Untitled page';
    page.breadcrumb = el.editBreadcrumb.value.trim() || page.name;
    page.seo = el.editSeo.value;
    page.status = el.editStatus.value;
    page.removed = el.editRemoved.checked;
    if (page.removed && !state.showRemoved) {
      state.showRemoved = true;
      el.showRemoved.checked = true;
    }
    rebuildPage(page);
    el.seoCount.textContent = `${page.seo.length} characters`;
    renderStatusAndMetadata(page);
    scheduleTreeRefresh();
    scheduleAutosave('Edited page details');
  }

  function setEditorMode(mode, { sync = true } = {}) {
    const next = mode === 'source' ? 'source' : 'visual';
    if (sync && state.editorMode !== next) {
      if (next === 'source') {
        el.sourceEditor.value = formatHtml(el.visualEditor.innerHTML);
      } else {
        el.visualEditor.innerHTML = el.sourceEditor.value;
      }
    }
    state.editorMode = next;
    el.visualEditor.hidden = next !== 'visual';
    el.sourceEditor.hidden = next !== 'source';
    el.visualEditorMode.classList.toggle('active', next === 'visual');
    el.sourceEditorMode.classList.toggle('active', next === 'source');
    el.formatToolbar.classList.toggle('disabled', next === 'source');
    el.formatToolbar.querySelectorAll('button, select').forEach(control => control.disabled = next === 'source');
    saveUiState();
  }

  function resetCurrentVersion() {
    if (state.view === 'edit' && editorContext.dirty) commitEditorToPage({ silent: true });
    const page = currentPage();
    if (!page) return;
    const base = baseById.get(page.id);
    const version = el.version.value;
    if (!window.confirm(`Reset ${versionLabels[version]} for “${page.name}” to the bundled version?`)) return;
    page.html[version] = base ? (base.html[version] || '') : '';
    rebuildPage(page);
    recordPageHistory(page, {
      reason: 'reset',
      label: `Reset ${versionLabels[version]} to bundled version`,
      version,
      force: true
    });
    persistWorkspace({ silent: true, touchDraft: true, pageId: page.id });
    loadEditor(page, version, { force: true });
    renderPage();
    renderTree();
    renderHistory();
    showToast('Content version reset');
  }

  function resetCurrentPage() {
    if (state.view === 'edit' && editorContext.dirty) commitEditorToPage({ silent: true });
    const page = currentPage();
    if (!page) return;
    const base = baseById.get(page.id);
    if (!base) {
      showToast('This page has no bundled version to restore');
      return;
    }
    if (!window.confirm(`Reset all workspace edits for “${page.name}”?`)) return;
    const replacement = normalisePage(base);
    const index = pages.findIndex(item => item.id === page.id);
    pages[index] = replacement;
    rebuildIndexes();
    recordPageHistory(replacement, {
      reason: 'reset',
      label: 'Reset page to bundled version',
      version: el.version.value,
      force: true
    });
    persistWorkspace({ silent: true, touchDraft: true, pageId: replacement.id });
    state.selectedId = replacement.id;
    loadEditor(replacement, el.version.value, { force: true });
    renderTree();
    renderPage();
    renderHistory();
    showToast('Page reset to bundled version');
  }

  function exportWorkspace() {
    if (state.view === 'edit') commitEditorToPage({ silent: true });
    const exportedAt = new Date().toISOString();
    const payload = workspacePayload({ exportedAt });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const stamp = exportedAt.replace(/[:.]/g, '-');
    const revision = saveInfo.workspace.revision || 0;
    const link = document.createElement('a');
    link.href = url;
    link.download = `transport-page-browser-workspace-r${revision}-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Workspace exported · saved revision ${revision}`);
  }

  async function importWorkspaceFile(file) {
    try {
      const payload = JSON.parse(await file.text());
      if (payload.workspaceType !== WORKSPACE_TYPE || !Array.isArray(payload.pages)) {
        throw new Error('Not a Transport Page Browser workspace');
      }
      if (!SUPPORTED_WORKSPACE_SCHEMAS.has(Number(payload.schemaVersion))) {
        throw new Error(`Unsupported workspace schema ${payload.schemaVersion}`);
      }
      if (state.view === 'edit') commitEditorToPage({ silent: true });
      applyWorkspacePages(payload.pages);
      saveInfo = payload.saveInfo
        ? normaliseSaveInfo(payload.saveInfo)
        : normaliseSaveInfo({ draftUpdatedAt: payload.updatedAt || payload.savedAt || payload.exportedAt || null });
      pageHistory = normalisePageHistory(payload.pageHistory || {});
      if (payload.ui) applyUiState(payload.ui);
      if (!byId.has(state.selectedId)) state.selectedId = pages[0]?.id || null;
      persistWorkspace({ silent: true });
      renderTree();
      switchView(state.view);
      if (state.selectedId) selectPage(state.selectedId, { updateHash: true });
      updateWorkspaceIndicator();
      showToast('Workspace imported');
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Workspace import failed');
    } finally {
      el.workspaceFile.value = '';
    }
  }

  function resetWholeWorkspace() {
    const count = modifiedPageCount();
    if (!count) return;
    if (!window.confirm(`Discard workspace edits on ${count} page${count === 1 ? '' : 's'} and restore all bundled content?`)) return;
    clearTimeout(editorContext.autosaveTimer);
    pages = basePages.map(clone).map(normalisePage);
    rebuildIndexes();
    storageRemove(WORKSPACE_KEY);
    saveInfo = normaliseSaveInfo();
    pageHistory = {};
    editorContext.pageId = null;
    editorContext.version = null;
    editorContext.dirty = false;
    if (!byId.has(state.selectedId)) state.selectedId = pages[0]?.id || null;
    renderTree();
    if (state.selectedId) renderPage();
    updateWorkspaceIndicator();
    showToast('Workspace reset');
  }

  el.search.addEventListener('input', () => {
    state.search = el.search.value;
    renderTree();
  });
  el.showRemoved.addEventListener('change', () => {
    state.showRemoved = el.showRemoved.checked;
    saveUiState();
    renderTree();
    updatePrevNext();
  });
  el.expandAll.addEventListener('click', () => {
    for (const page of visiblePages()) {
      page.path.forEach((_, index) => state.expanded.add(page.path.slice(0, index + 1).join(' > ')));
    }
    saveUiState();
    renderTree();
  });
  el.collapseAll.addEventListener('click', () => {
    state.expanded = new Set(['Transport']);
    saveUiState();
    renderTree();
  });
  el.toggleSidebar.addEventListener('click', () => el.sidebar.classList.toggle('open'));

  el.version.addEventListener('change', () => {
    if (state.view === 'edit') commitEditorToPage({ silent: true });
    saveUiState();
    renderPage();
  });
  el.includeH1.addEventListener('change', () => { saveUiState(); renderPage(); });
  el.includeEditorial.addEventListener('change', () => { saveUiState(); renderPage(); });
  el.includeImages.addEventListener('change', () => { saveUiState(); renderPage(); });
  el.includePlaceholders.addEventListener('change', () => { saveUiState(); renderPage(); });
  el.accordionMode.addEventListener('change', () => { saveUiState(); renderPage(); });
  el.expandAccordions.addEventListener('click', () => {
    el.pageView.querySelectorAll('details').forEach(details => details.open = true);
  });
  el.collapseAccordions.addEventListener('click', () => {
    el.pageView.querySelectorAll('details').forEach(details => details.open = false);
  });
  el.wrapCode.addEventListener('change', () => {
    el.codeView.classList.toggle('no-wrap', !el.wrapCode.checked);
    saveUiState();
  });

  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => switchView(tab.dataset.view)));
  el.prevPage.addEventListener('click', () => stepPage(-1));
  el.nextPage.addEventListener('click', () => stepPage(1));

  el.copyWysiwyg.addEventListener('click', async () => {
    if (state.view === 'edit') commitEditorToPage({ silent: true });
    const html = cleanCmsHtml();
    if (!html) return;
    const ok = await copyRich(html);
    showToast(ok ? 'WYSIWYG content copied' : 'Copy was blocked by the browser');
  });
  el.copyHtml.addEventListener('click', async () => {
    if (state.view === 'edit') commitEditorToPage({ silent: true });
    const html = formatHtml(cleanCmsHtml());
    if (!html) return;
    const ok = await copyPlain(html);
    showToast(ok ? 'HTML copied' : 'Copy was blocked by the browser');
  });
  el.copyText.addEventListener('click', async () => {
    if (state.view === 'edit') commitEditorToPage({ silent: true });
    const text = htmlToPlainText(cleanCmsHtml());
    if (!text) return;
    const ok = await copyPlain(text);
    showToast(ok ? 'Plain text copied' : 'Copy was blocked by the browser');
  });

  document.querySelectorAll('[data-copy-meta]').forEach(button => {
    button.addEventListener('click', async () => {
      const page = currentPage();
      if (!page) return;
      const key = button.dataset.copyMeta;
      const value = key === 'seo' ? page.seo : page.breadcrumb;
      await copyPlain(value || '');
      showToast(`${key === 'seo' ? 'SEO' : 'Breadcrumb'} copied`);
    });
  });

  el.pageView.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (/^https?:\/\//i.test(href) || /^tel:/i.test(href) || /^mailto:/i.test(href)) {
      if (/^https?:\/\//i.test(href)) {
        event.preventDefault();
        window.open(href, '_blank', 'noopener');
      }
      return;
    }
    event.preventDefault();
    showToast(`CMS link: ${href}`);
  });

  [el.editName, el.editBreadcrumb, el.editSeo, el.editStatus].forEach(input => input.addEventListener('input', updateMetadataFromEditor));
  el.editRemoved.addEventListener('change', updateMetadataFromEditor);
  el.visualEditor.addEventListener('input', () => scheduleAutosave(`Edited ${versionLabels[el.version.value] || 'page content'}`));
  el.sourceEditor.addEventListener('input', () => scheduleAutosave(`Edited ${versionLabels[el.version.value] || 'page content'} HTML`));
  el.visualEditor.addEventListener('click', event => {
    if (event.target.closest('a')) event.preventDefault();
  });
  el.visualEditorMode.addEventListener('click', () => setEditorMode('visual'));
  el.sourceEditorMode.addEventListener('click', () => setEditorMode('source'));
  el.savePage.addEventListener('click', saveCurrentPageCheckpoint);
  el.savePageTop.addEventListener('click', saveCurrentPageCheckpoint);
  el.resetVersion.addEventListener('click', resetCurrentVersion);
  el.resetPage.addEventListener('click', resetCurrentPage);
  el.undoPage.addEventListener('click', undoPageHistory);
  el.redoPage.addEventListener('click', redoPageHistory);
  el.historyUndo.addEventListener('click', undoPageHistory);
  el.historyRedo.addEventListener('click', redoPageHistory);

  el.formatBlock.addEventListener('change', () => {
    if (state.editorMode !== 'visual') return;
    el.visualEditor.focus();
    document.execCommand('formatBlock', false, el.formatBlock.value);
    scheduleAutosave(`Formatted ${versionLabels[el.version.value] || 'page content'}`);
  });
  el.formatToolbar.querySelectorAll('[data-command]').forEach(button => {
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => {
      if (state.editorMode !== 'visual') return;
      el.visualEditor.focus();
      document.execCommand(button.dataset.command, false, null);
      scheduleAutosave(`Formatted ${versionLabels[el.version.value] || 'page content'}`);
    });
  });
  el.insertLink.addEventListener('mousedown', event => event.preventDefault());
  el.insertLink.addEventListener('click', () => {
    if (state.editorMode !== 'visual') return;
    const url = window.prompt('Link URL');
    if (!url) return;
    el.visualEditor.focus();
    document.execCommand('createLink', false, url.trim());
    scheduleAutosave(`Edited links in ${versionLabels[el.version.value] || 'page content'}`);
  });
  el.insertAccordion.addEventListener('mousedown', event => event.preventDefault());
  el.insertAccordion.addEventListener('click', () => {
    if (state.editorMode !== 'visual') return;
    el.visualEditor.focus();
    const html = '<details class="cms-accordion"><summary>Accordion heading</summary><div class="cms-accordion__body"><p>Accordion content</p></div></details><p><br></p>';
    document.execCommand('insertHTML', false, html);
    scheduleAutosave(`Inserted accordion in ${versionLabels[el.version.value] || 'page content'}`);
  });

  el.saveWorkspace.addEventListener('click', saveWorkspaceCheckpoint);
  el.importWorkspace.addEventListener('click', () => el.workspaceFile.click());
  el.workspaceFile.addEventListener('change', () => {
    const file = el.workspaceFile.files?.[0];
    if (file) importWorkspaceFile(file);
  });
  el.exportWorkspace.addEventListener('click', exportWorkspace);
  el.resetWorkspace.addEventListener('click', resetWholeWorkspace);

  document.addEventListener('keydown', event => {
    if (event.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName) && !document.activeElement.isContentEditable) {
      event.preventDefault();
      el.search.focus();
    }
    if (event.altKey && event.key === 'ArrowUp') { event.preventDefault(); stepPage(-1); }
    if (event.altKey && event.key === 'ArrowDown') { event.preventDefault(); stepPage(1); }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveWorkspaceCheckpoint();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (state.view === 'edit') saveCurrentPageCheckpoint();
      else saveWorkspaceCheckpoint();
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      el.copyWysiwyg.click();
    }
  });

  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (byId.has(id)) selectPage(id, { updateHash: false });
  });

  window.addEventListener('beforeunload', () => {
    if (state.view === 'edit') commitEditorToPage({ silent: true });
  });

  loadUiState();
  loadWorkspaceFromStorage();
  rebuildIndexes();
  updateDatasetSummary();
  updateWorkspaceIndicator();
  el.codeView.classList.toggle('no-wrap', !el.wrapCode.checked);
  switchView(state.view);

  const hashId = location.hash.slice(1);
  const savedId = byId.has(state.selectedId) ? state.selectedId : null;
  const start = byId.has(hashId) ? hashId : savedId || visiblePages()[0]?.id || pages[0]?.id;
  if (start) selectPage(start, { updateHash: !hashId });
})();
