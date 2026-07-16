// ==UserScript==
// @name         Field Instruments — Webpage Annotation Overlay
// @namespace    https://mbparks.com/fieldinstruments
// @version      1.1.0
// @description  Annotate any webpage with persistent highlights, margin notes, arrows, labels, multi-page collections, evidence snapshots, and Field Instruments handoff exports.
// @author       Michael Parks / Field Instruments
// @match        http://*/*
// @match        https://*/*
// @noframes
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  const APP_NAME = 'Field Instruments Web Annotator';
  const VERSION = '1.1.0';
  const STORAGE_PREFIX = 'fi-web-annotator:v1:';
  const SETTINGS_KEY = `${STORAGE_PREFIX}settings`;
  const COLLECTIONS_KEY = `${STORAGE_PREFIX}collections`;
  const PAGE_INDEX_KEY = `${STORAGE_PREFIX}page-index`;
  const DEFAULT_COLLECTION_ID = 'inbox';
  const HOST_ID = 'fi-web-annotator-host';
  const MAX_Z = 2147483646;
  const MAX_SNAPSHOT_HTML = 700000;
  const MAX_SNAPSHOT_TEXT = 120000;

  const COLOR_MAP = {
    yellow: { fill: 'rgba(255, 221, 64, .43)', solid: '#f0c419', ink: '#2d2500' },
    pink:   { fill: 'rgba(255, 105, 180, .32)', solid: '#ec5c9f', ink: '#3a071f' },
    blue:   { fill: 'rgba(74, 144, 226, .30)', solid: '#4a90e2', ink: '#061f3d' },
    green:  { fill: 'rgba(72, 187, 120, .30)', solid: '#48bb78', ink: '#082b18' },
    orange: { fill: 'rgba(246, 173, 85, .35)', solid: '#ed8936', ink: '#3d1900' }
  };

  const TYPE_META = {
    highlight: { icon: '▰', label: 'Highlight' },
    note:      { icon: '▤', label: 'Margin note' },
    arrow:     { icon: '➜', label: 'Arrow' },
    label:     { icon: '◆', label: 'Label' }
  };

  const state = {
    pageKey: getPageKey(),
    pageMeta: null,
    annotations: [],
    snapshot: null,
    collectionId: DEFAULT_COLLECTION_ID,
    collections: [],
    pageIndex: [],
    exportScope: 'page',
    mode: 'idle',
    visible: true,
    dockOpen: true,
    panelOpen: false,
    filter: '',
    draftArrow: null,
    editingId: null,
    flashId: null,
    saveTimer: null,
    urlWatchTimer: null,
    mutationObserver: null,
    lastSelection: null,
    settings: {
      dockSide: 'right',
      defaultColor: 'yellow',
      lastCollectionId: DEFAULT_COLLECTION_ID
    }
  };

  let host;
  let shadow;
  let ui;
  let overlay;
  let svg;
  let modal;
  let toastTimer;

  init();

  function init() {
    loadSettings();
    loadWorkspace();
    loadPageData();
    buildRoot();
    bindGlobalEvents();
    observePageChanges();
    registerMenuCommands();
    renderAll();
    watchUrlChanges();
    toast(`Ready · ${state.annotations.length} annotation${state.annotations.length === 1 ? '' : 's'}`);
  }

  function getPageKey(url = location.href) {
    try {
      const parsed = new URL(url, location.href);
      return `${parsed.origin}${parsed.pathname}${parsed.search}`;
    } catch {
      return `${location.origin}${location.pathname}${location.search}`;
    }
  }

  function storageKey(pageKey = state.pageKey) {
    return `${STORAGE_PREFIX}page:${pageKey}`;
  }

  function defaultCollection() {
    const now = new Date().toISOString();
    return {
      id: DEFAULT_COLLECTION_ID,
      name: 'Inbox',
      description: 'Unsorted webpage annotations and quick captures.',
      createdAt: now,
      updatedAt: now
    };
  }

  function loadSettings() {
    try {
      const saved = GM_getValue(SETTINGS_KEY, '');
      if (saved) state.settings = { ...state.settings, ...JSON.parse(saved) };
    } catch (error) {
      console.warn(`${APP_NAME}: settings could not be loaded`, error);
    }
  }

  function saveSettings() {
    GM_setValue(SETTINGS_KEY, JSON.stringify(state.settings));
  }

  function loadWorkspace() {
    try {
      const savedCollections = GM_getValue(COLLECTIONS_KEY, '');
      const parsedCollections = savedCollections ? JSON.parse(savedCollections) : [];
      state.collections = Array.isArray(parsedCollections) ? parsedCollections : [];
    } catch (error) {
      console.warn(`${APP_NAME}: collections could not be loaded`, error);
      state.collections = [];
    }
    if (!state.collections.some(item => item.id === DEFAULT_COLLECTION_ID)) {
      state.collections.unshift(defaultCollection());
    }

    try {
      const savedIndex = GM_getValue(PAGE_INDEX_KEY, '');
      const parsedIndex = savedIndex ? JSON.parse(savedIndex) : [];
      state.pageIndex = Array.isArray(parsedIndex) ? parsedIndex : [];
    } catch (error) {
      console.warn(`${APP_NAME}: page index could not be loaded`, error);
      state.pageIndex = [];
    }
    saveWorkspace();
  }

  function saveWorkspace() {
    GM_setValue(COLLECTIONS_KEY, JSON.stringify(state.collections));
    GM_setValue(PAGE_INDEX_KEY, JSON.stringify(state.pageIndex));
  }

  function loadPageData() {
    state.pageMeta = currentPageMetadata();
    let hadSavedData = false;
    try {
      const saved = GM_getValue(storageKey(), '');
      hadSavedData = Boolean(saved);
      const parsed = saved ? JSON.parse(saved) : null;
      state.annotations = Array.isArray(parsed?.annotations) ? parsed.annotations : [];
      state.snapshot = parsed?.snapshot && typeof parsed.snapshot === 'object' ? parsed.snapshot : null;
      const requestedCollection = parsed?.collectionId || state.settings.lastCollectionId || DEFAULT_COLLECTION_ID;
      state.collectionId = state.collections.some(item => item.id === requestedCollection) ? requestedCollection : DEFAULT_COLLECTION_ID;
      state.pageMeta = { ...(parsed?.page || {}), ...currentPageMetadata() };
    } catch (error) {
      console.warn(`${APP_NAME}: page data could not be loaded`, error);
      state.annotations = [];
      state.snapshot = null;
      state.collectionId = state.collections.some(item => item.id === state.settings.lastCollectionId)
        ? state.settings.lastCollectionId
        : DEFAULT_COLLECTION_ID;
    }
    state.settings.lastCollectionId = state.collectionId;
    saveSettings();
    if (hadSavedData || state.annotations.length || state.snapshot) {
      upsertPageIndex({
        pageKey: state.pageKey,
        collectionId: state.collectionId,
        page: state.pageMeta,
        annotationCount: state.annotations.length,
        snapshot: state.snapshot,
        updatedAt: new Date().toISOString()
      });
    }
  }

  function scheduleSave() {
    clearTimeout(state.saveTimer);
    setSaveStatus('saving');
    state.saveTimer = setTimeout(savePageData, 180);
  }

  function flushSave() {
    if (!state.saveTimer) return;
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    savePageData();
  }

  function savePageData() {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    if (getPageKey() === state.pageKey) state.pageMeta = currentPageMetadata();
    const payload = {
      schema: 'field-instruments.web-annotation.v2',
      version: VERSION,
      pageKey: state.pageKey,
      collectionId: state.collectionId,
      page: state.pageMeta || currentPageMetadata(),
      annotations: state.annotations,
      snapshot: state.snapshot,
      updatedAt: new Date().toISOString()
    };
    GM_setValue(storageKey(), JSON.stringify(payload));
    upsertPageIndex(payload);
    setSaveStatus('saved');
  }

  function upsertPageIndex(record) {
    const pageKey = record.pageKey || getPageKey(record.page?.url || location.href);
    const next = {
      pageKey,
      collectionId: record.collectionId || DEFAULT_COLLECTION_ID,
      page: record.page || currentPageMetadata(),
      annotationCount: Array.isArray(record.annotations) ? record.annotations.length : Number(record.annotationCount || 0),
      hasSnapshot: Boolean(record.snapshot),
      snapshotCapturedAt: record.snapshot?.capturedAt || '',
      updatedAt: record.updatedAt || new Date().toISOString()
    };
    const index = state.pageIndex.findIndex(item => item.pageKey === pageKey);
    if (index >= 0) state.pageIndex[index] = { ...state.pageIndex[index], ...next };
    else state.pageIndex.push(next);
    state.pageIndex.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    saveWorkspace();
  }

  function buildRoot() {
    document.getElementById(HOST_ID)?.remove();
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = `all:initial;position:fixed;inset:0;z-index:${MAX_Z};pointer-events:none;contain:layout style;`;
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = getStyles();
    shadow.appendChild(style);

    overlay = el('div', { class: 'fi-overlay', 'aria-hidden': 'true' });
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'fi-svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    overlay.appendChild(svg);

    ui = el('section', { class: `fi-shell side-${state.settings.dockSide}`, role: 'dialog', 'aria-label': APP_NAME });
    modal = el('div', { class: 'fi-modal-layer hidden' });

    shadow.append(overlay, ui, modal);
    buildShell();
  }

  function buildShell() {
    ui.innerHTML = `
      <button class="fi-launcher" type="button" title="Toggle Web Annotator (Alt+Shift+A)">
        <span class="fi-launcher-mark">A</span>
        <span class="fi-count">0</span>
      </button>
      <div class="fi-dock ${state.dockOpen ? '' : 'hidden'}">
        <header class="fi-header">
          <div>
            <div class="fi-kicker">FIELD INSTRUMENTS</div>
            <div class="fi-title">Web Annotator</div>
          </div>
          <div class="fi-header-actions">
            <button class="fi-icon-btn" data-action="toggle-visibility" type="button" title="Hide annotations">◉</button>
            <button class="fi-icon-btn" data-action="close-dock" type="button" title="Collapse">×</button>
          </div>
        </header>

        <div class="fi-version-row">
          <span>v${VERSION}</span>
          <span class="fi-save-status"><i></i><b>Saved</b></span>
        </div>

        <div class="fi-workspace-row">
          <label class="fi-collection-control"><span>Collection</span><select class="fi-collection-select" aria-label="Active annotation collection"></select></label>
          <button class="fi-mini-btn" data-action="create-collection" type="button" title="Create collection">＋</button>
          <button class="fi-snapshot-btn" data-action="capture-snapshot" type="button"><b>Snapshot</b><small>Not captured</small></button>
        </div>

        <div class="fi-tools">
          <button class="fi-tool primary" data-action="highlight" type="button">
            <span>▰</span><b>Highlight</b><small>selected text</small>
          </button>
          <button class="fi-tool" data-mode="note" type="button">
            <span>▤</span><b>Note</b><small>click page</small>
          </button>
          <button class="fi-tool" data-mode="arrow" type="button">
            <span>➜</span><b>Arrow</b><small>drag page</small>
          </button>
          <button class="fi-tool" data-mode="label" type="button">
            <span>◆</span><b>Label</b><small>click page</small>
          </button>
        </div>

        <div class="fi-modebar">
          <span class="fi-mode-text">Ready</span>
          <button class="fi-link-btn hidden" data-action="cancel-mode" type="button">Cancel</button>
        </div>

        <div class="fi-command-row">
          <button data-action="toggle-panel" type="button">Review <span class="fi-review-count">0</span></button>
          <button data-action="undo" type="button">Undo</button>
          <button data-action="export-open" type="button">Export</button>
          <button data-action="more-open" type="button">•••</button>
        </div>

        <div class="fi-panel hidden">
          <div class="fi-panel-head">
            <input class="fi-filter" type="search" placeholder="Filter annotations…" aria-label="Filter annotations">
            <button class="fi-icon-btn" data-action="toggle-panel" type="button" title="Close review">×</button>
          </div>
          <div class="fi-list"></div>
        </div>

        <div class="fi-popover fi-export-popover hidden">
          <div class="fi-popover-title">Export handoff package</div>
          <label class="fi-export-scope"><span>Scope</span><select aria-label="Export scope"><option value="page">Current page</option><option value="collection">Active collection</option></select></label>
          <button data-export="native-json" type="button"><b>Native JSON</b><small>complete backup and re-import</small></button>
          <button data-export="snapshot-html" type="button"><b>Evidence snapshot HTML</b><small>captured page plus annotation register</small></button>
          <button data-export="trace-json" type="button"><b>Trace evidence package</b><small>multi-source structured evidence JSON</small></button>
          <button data-export="critique-md" type="button"><b>Critique review</b><small>review-ready Markdown findings</small></button>
          <button data-export="design-md" type="button"><b>Design report appendix</b><small>source-grouped design observations</small></button>
          <button data-export="training-html" type="button"><b>Training documentation</b><small>standalone linked HTML reference</small></button>
          <button data-export="reliquary-json" type="button"><b>Reliquary project record</b><small>preservation-ready artifact records</small></button>
        </div>

        <div class="fi-popover fi-more-popover hidden">
          <button data-action="collection-overview" type="button"><b>Collection overview</b><small>pages, snapshots, and annotation totals</small></button>
          <button data-action="edit-collection" type="button"><b>Edit collection</b><small>rename or describe this body of work</small></button>
          <button data-action="import" type="button"><b>Import native JSON</b><small>page or collection package</small></button>
          <button data-action="switch-side" type="button"><b>Move dock</b><small>switch left or right</small></button>
          <button data-action="remove-snapshot" type="button"><b>Remove page snapshot</b><small>keep annotations but discard captured content</small></button>
          <button data-action="delete-collection" class="danger" type="button"><b>Delete collection</b><small>move its pages back to Inbox</small></button>
          <button data-action="clear-page" class="danger" type="button"><b>Clear this page</b><small>remove all annotations here</small></button>
          <input class="fi-import-input" type="file" accept="application/json,.json" hidden>
        </div>

        <footer class="fi-footer">
          <span class="fi-page-title"></span>
          <span>Alt Shift A</span>
        </footer>
      </div>
      <div class="fi-toast" role="status" aria-live="polite"></div>
    `;

    ui.querySelector('.fi-launcher').addEventListener('click', toggleDock);
    ui.addEventListener('click', handleUiClick);
    ui.querySelector('.fi-filter').addEventListener('input', event => {
      state.filter = event.target.value.trim().toLowerCase();
      renderList();
    });
    ui.querySelector('.fi-collection-select').addEventListener('change', event => assignCurrentPageToCollection(event.target.value));
    ui.querySelector('.fi-export-scope select').addEventListener('change', event => { state.exportScope = event.target.value; });
    ui.querySelector('.fi-import-input').addEventListener('change', importFile);
  }

  function bindGlobalEvents() {
    window.addEventListener('scroll', requestRender, { passive: true });
    window.addEventListener('resize', requestRender, { passive: true });
    document.addEventListener('selectionchange', rememberSelection, { passive: true });

    window.addEventListener('keydown', event => {
      if (event.altKey && event.shiftKey && event.code === 'KeyA') {
        event.preventDefault();
        toggleDock();
      }
      if (event.altKey && event.shiftKey && event.code === 'KeyH') {
        event.preventDefault();
        createHighlightFromSelection();
      }
      if (event.key === 'Escape') {
        if (!modal.classList.contains('hidden')) closeModal();
        else cancelMode();
      }
    }, true);

    window.addEventListener('pointerdown', handlePagePointerDown, true);
    window.addEventListener('pointermove', handlePagePointerMove, true);
    window.addEventListener('pointerup', handlePagePointerUp, true);
  }

  function observePageChanges() {
    if (!document.body || !window.MutationObserver) return;
    state.mutationObserver = new MutationObserver(() => requestRender());
    state.mutationObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function registerMenuCommands() {
    try {
      GM_registerMenuCommand('Toggle Web Annotator', toggleDock, 'a');
      GM_registerMenuCommand('Highlight current selection', createHighlightFromSelection, 'h');
      GM_registerMenuCommand('Capture page snapshot', capturePageSnapshot);
      GM_registerMenuCommand('Export current page JSON', () => exportAnnotations('native-json', 'page'));
      GM_registerMenuCommand('Export active collection JSON', () => exportAnnotations('native-json', 'collection'));
      GM_registerMenuCommand('Clear annotations on this page', clearPage);
    } catch (error) {
      console.warn(`${APP_NAME}: menu commands unavailable`, error);
    }
  }

  function watchUrlChanges() {
    state.urlWatchTimer = setInterval(() => {
      const nextKey = getPageKey();
      if (nextKey === state.pageKey) return;
      flushSave();
      state.pageKey = nextKey;
      state.pageMeta = currentPageMetadata();
      state.mode = 'idle';
      state.draftArrow = null;
      state.lastSelection = null;
      loadPageData();
      renderAll();
      toast(`Loaded ${state.annotations.length} annotation${state.annotations.length === 1 ? '' : 's'} for this page`);
    }, 700);
  }

  let renderQueued = false;
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderOverlay();
    });
  }

  function renderAll() {
    renderShellState();
    renderList();
    renderOverlay();
  }

  function renderShellState() {
    const dock = ui.querySelector('.fi-dock');
    dock.classList.toggle('hidden', !state.dockOpen);
    ui.classList.toggle('side-left', state.settings.dockSide === 'left');
    ui.classList.toggle('side-right', state.settings.dockSide === 'right');

    ui.querySelector('.fi-count').textContent = state.annotations.length;
    ui.querySelector('.fi-review-count').textContent = state.annotations.length;
    ui.querySelector('.fi-page-title').textContent = truncate(document.title || location.hostname, 28);

    const collectionSelect = ui.querySelector('.fi-collection-select');
    if (collectionSelect) {
      collectionSelect.innerHTML = state.collections
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(collection => option(collection.name, state.collectionId, collection.id))
        .join('');
      collectionSelect.value = state.collectionId;
    }

    const snapshotButton = ui.querySelector('.fi-snapshot-btn');
    if (snapshotButton) {
      snapshotButton.classList.toggle('captured', Boolean(state.snapshot));
      snapshotButton.querySelector('small').textContent = state.snapshot
        ? `Captured ${formatCompactDate(state.snapshot.capturedAt)}`
        : 'Not captured';
      snapshotButton.title = state.snapshot
        ? 'Replace the stored snapshot for this page'
        : 'Capture a sanitized evidence snapshot of this page';
    }

    const exportScope = ui.querySelector('.fi-export-scope select');
    if (exportScope) exportScope.value = state.exportScope;

    const panel = ui.querySelector('.fi-panel');
    panel.classList.toggle('hidden', !state.panelOpen);
    ui.querySelector('[data-action="toggle-visibility"]').textContent = state.visible ? '◉' : '○';
    ui.querySelector('[data-action="toggle-visibility"]').title = state.visible ? 'Hide annotations' : 'Show annotations';

    ui.querySelectorAll('[data-mode]').forEach(button => {
      button.classList.toggle('active', button.dataset.mode === state.mode);
    });

    const modeText = ui.querySelector('.fi-mode-text');
    const cancel = ui.querySelector('[data-action="cancel-mode"]');
    const messages = {
      idle: `Ready · ${activeCollection()?.name || 'Inbox'}`,
      note: 'Click the page to place a margin note',
      label: 'Click the page to place a label',
      arrow: state.draftArrow ? 'Drag to the arrow endpoint' : 'Drag from the arrow start to its endpoint'
    };
    modeText.textContent = messages[state.mode] || 'Ready';
    cancel.classList.toggle('hidden', state.mode === 'idle');
  }

  function renderList() {
    const list = ui.querySelector('.fi-list');
    if (!list) return;
    const filtered = state.annotations
      .filter(annotation => matchesFilter(annotation, state.filter))
      .slice()
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

    if (!filtered.length) {
      list.innerHTML = `<div class="fi-empty">${state.annotations.length ? 'No annotations match this filter.' : 'No annotations yet. Select text to highlight, or place a note, arrow, or label.'}</div>`;
      return;
    }

    list.innerHTML = filtered.map(annotation => {
      const meta = TYPE_META[annotation.type] || { icon: '•', label: annotation.type };
      const title = annotation.title || meta.label;
      const excerpt = annotation.quote || annotation.note || annotation.label || '';
      return `
        <article class="fi-list-item" data-id="${escapeHtml(annotation.id)}">
          <button class="fi-item-main" data-action="focus" data-id="${escapeHtml(annotation.id)}" type="button">
            <span class="fi-item-icon color-${escapeHtml(annotation.color || 'yellow')}">${meta.icon}</span>
            <span class="fi-item-copy">
              <b>${escapeHtml(title)}</b>
              <small>${escapeHtml(annotation.category || 'Reference')} · ${escapeHtml(annotation.severity || 'Info')}</small>
              <em>${escapeHtml(truncate(excerpt, 120) || 'No description')}</em>
            </span>
          </button>
          <div class="fi-item-actions">
            <button data-action="edit" data-id="${escapeHtml(annotation.id)}" type="button">Edit</button>
            <button data-action="delete" data-id="${escapeHtml(annotation.id)}" type="button">Delete</button>
          </div>
        </article>`;
    }).join('');
  }

  function renderOverlay() {
    overlay.querySelectorAll('.fi-visual').forEach(node => node.remove());
    svg.innerHTML = `
      <defs>
        <marker id="fi-arrowhead" markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L9,4 L0,8 z" fill="context-stroke"></path>
        </marker>
      </defs>`;

    if (!state.visible) return;

    const noteLayouts = [];

    for (const annotation of state.annotations) {
      try {
        if (annotation.type === 'highlight') renderHighlight(annotation);
        if (annotation.type === 'label') renderLabel(annotation);
        if (annotation.type === 'arrow') renderArrow(annotation);
        if (annotation.type === 'note') noteLayouts.push({ annotation, point: resolvePoint(annotation.anchor) });
      } catch (error) {
        console.warn(`${APP_NAME}: could not render annotation`, annotation, error);
      }
    }

    renderNotes(noteLayouts);
    if (state.draftArrow) renderDraftArrow();
  }

  function renderHighlight(annotation) {
    const range = resolveTextRange(annotation.textAnchor);
    if (!range) return;
    const color = COLOR_MAP[annotation.color] || COLOR_MAP.yellow;
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width < 1 || rect.height < 1) continue;
      const highlight = el('div', {
        class: `fi-visual fi-highlight ${state.flashId === annotation.id ? 'flash' : ''}`,
        title: annotation.title || annotation.note || 'Highlight'
      });
      Object.assign(highlight.style, {
        left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
        background: color.fill,
        boxShadow: `inset 0 -2px 0 ${color.solid}`
      });
      overlay.appendChild(highlight);
    }
  }

  function renderLabel(annotation) {
    const point = resolvePoint(annotation.anchor);
    if (!point || !isNearViewport(point)) return;
    const color = COLOR_MAP[annotation.color] || COLOR_MAP.yellow;
    const label = el('button', {
      class: `fi-visual fi-page-label ${state.flashId === annotation.id ? 'flash' : ''}`,
      type: 'button',
      'data-id': annotation.id,
      title: annotation.note || annotation.title || 'Label'
    });
    label.textContent = annotation.label || annotation.title || 'Label';
    Object.assign(label.style, {
      left: `${point.x}px`, top: `${point.y}px`, background: color.solid, color: color.ink
    });
    label.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openEditor(annotation.id);
    });
    overlay.appendChild(label);
  }

  function renderArrow(annotation) {
    const start = resolvePoint(annotation.startAnchor);
    const end = resolvePoint(annotation.endAnchor);
    if (!start || !end) return;
    if (!isNearViewport(start) && !isNearViewport(end)) return;
    const color = COLOR_MAP[annotation.color] || COLOR_MAP.orange;
    const line = svgEl('line', {
      x1: start.x, y1: start.y, x2: end.x, y2: end.y,
      class: `fi-arrow-line ${state.flashId === annotation.id ? 'flash-stroke' : ''}`,
      stroke: color.solid,
      'marker-end': 'url(#fi-arrowhead)'
    });
    svg.appendChild(line);

    if (annotation.label || annotation.title) {
      const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      const text = el('button', {
        class: `fi-visual fi-arrow-label ${state.flashId === annotation.id ? 'flash' : ''}`,
        type: 'button',
        'data-id': annotation.id
      });
      text.textContent = annotation.label || annotation.title;
      Object.assign(text.style, { left: `${mid.x}px`, top: `${mid.y}px`, borderColor: color.solid });
      text.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openEditor(annotation.id);
      });
      overlay.appendChild(text);
    }
  }

  function renderNotes(noteLayouts) {
    if (!noteLayouts.length) return;
    const marginX = state.settings.dockSide === 'right' ? 18 : window.innerWidth - 338;
    const visible = noteLayouts
      .filter(item => item.point && isNearViewport(item.point, 250))
      .sort((a, b) => a.point.y - b.point.y);

    let nextTop = 14;
    for (const item of visible) {
      const { annotation, point } = item;
      const desiredTop = clamp(point.y - 22, 14, window.innerHeight - 120);
      const top = Math.max(desiredTop, nextTop);
      nextTop = top + 96;

      const color = COLOR_MAP[annotation.color] || COLOR_MAP.yellow;
      const note = el('button', {
        class: `fi-visual fi-margin-note ${state.flashId === annotation.id ? 'flash' : ''}`,
        type: 'button',
        'data-id': annotation.id
      });
      note.innerHTML = `
        <span class="fi-note-bar" style="background:${color.solid}"></span>
        <b>${escapeHtml(annotation.title || 'Margin note')}</b>
        <small>${escapeHtml(annotation.category || 'Reference')} · ${escapeHtml(annotation.severity || 'Info')}</small>
        <em>${escapeHtml(truncate(annotation.note || '', 170) || 'Click to edit')}</em>`;
      Object.assign(note.style, { left: `${marginX}px`, top: `${top}px` });
      note.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openEditor(annotation.id);
      });
      overlay.appendChild(note);

      const noteEdgeX = state.settings.dockSide === 'right' ? marginX + 320 : marginX;
      const noteCenterY = top + 45;
      svg.appendChild(svgEl('line', {
        x1: point.x, y1: point.y, x2: noteEdgeX, y2: noteCenterY,
        class: 'fi-note-leader', stroke: color.solid
      }));
      svg.appendChild(svgEl('circle', { cx: point.x, cy: point.y, r: 4, fill: color.solid, class: 'fi-note-dot' }));
    }
  }

  function renderDraftArrow() {
    const start = state.draftArrow.start;
    const end = state.draftArrow.end || start;
    svg.appendChild(svgEl('line', {
      x1: start.x, y1: start.y, x2: end.x, y2: end.y,
      class: 'fi-arrow-line fi-draft-line', stroke: COLOR_MAP[state.settings.defaultColor]?.solid || COLOR_MAP.orange.solid,
      'marker-end': 'url(#fi-arrowhead)'
    }));
  }

  function handleUiClick(event) {
    const actionButton = event.target.closest('[data-action]');
    const modeButton = event.target.closest('[data-mode]');
    const exportButton = event.target.closest('[data-export]');

    if (modeButton) {
      toggleMode(modeButton.dataset.mode);
      return;
    }
    if (exportButton) {
      exportAnnotations(exportButton.dataset.export);
      closePopovers();
      return;
    }
    if (!actionButton) return;

    const { action, id } = actionButton.dataset;
    const actions = {
      highlight: createHighlightFromSelection,
      'close-dock': () => { state.dockOpen = false; renderShellState(); },
      'toggle-panel': () => { state.panelOpen = !state.panelOpen; closePopovers(); renderShellState(); if (state.panelOpen) renderList(); },
      'toggle-visibility': () => { state.visible = !state.visible; renderAll(); },
      'cancel-mode': cancelMode,
      undo: undoLast,
      'export-open': () => togglePopover('.fi-export-popover'),
      'more-open': () => togglePopover('.fi-more-popover'),
      edit: () => openEditor(id),
      delete: () => deleteAnnotation(id),
      focus: () => focusAnnotation(id),
      import: () => ui.querySelector('.fi-import-input').click(),
      'switch-side': switchSide,
      'create-collection': createCollection,
      'edit-collection': editCollection,
      'delete-collection': deleteCollection,
      'collection-overview': openCollectionOverview,
      'capture-snapshot': capturePageSnapshot,
      'remove-snapshot': removePageSnapshot,
      'clear-page': clearPage
    };
    actions[action]?.();
  }

  function toggleDock() {
    state.dockOpen = !state.dockOpen;
    renderShellState();
  }

  function toggleMode(mode) {
    state.mode = state.mode === mode ? 'idle' : mode;
    state.draftArrow = null;
    closePopovers();
    renderShellState();
    renderOverlay();
  }

  function cancelMode() {
    state.mode = 'idle';
    state.draftArrow = null;
    renderShellState();
    renderOverlay();
  }

  function rememberSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    if (shadow.contains(selection.anchorNode)) return;
    const range = selection.getRangeAt(0).cloneRange();
    const text = selection.toString().trim();
    if (text) state.lastSelection = { range, text };
  }

  function createHighlightFromSelection() {
    let range;
    let quote;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.rangeCount && !shadow.contains(selection.anchorNode)) {
      range = selection.getRangeAt(0).cloneRange();
      quote = selection.toString().trim();
    } else if (state.lastSelection?.text) {
      range = state.lastSelection.range.cloneRange();
      quote = state.lastSelection.text;
    }

    if (!range || !quote) {
      toast('Select text on the page first');
      return;
    }

    const anchor = createTextAnchor(range, quote);
    if (!anchor) {
      toast('That selection could not be anchored');
      return;
    }

    const annotation = baseAnnotation('highlight', {
      title: 'Highlighted evidence',
      quote,
      textAnchor: anchor,
      color: state.settings.defaultColor
    });
    state.annotations.push(annotation);
    scheduleSave();
    renderAll();
    window.getSelection()?.removeAllRanges();
    state.lastSelection = null;
    openEditor(annotation.id, true);
  }

  function handlePagePointerDown(event) {
    if (state.mode === 'idle' || isInsideAnnotator(event)) return;
    if (event.button !== 0) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (state.mode === 'note' || state.mode === 'label') {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const anchor = createPointAnchor(event.clientX, event.clientY, target);
      const type = state.mode;
      const annotation = baseAnnotation(type, {
        anchor,
        title: type === 'note' ? 'Margin note' : 'Page label',
        label: type === 'label' ? 'Label' : '',
        color: state.settings.defaultColor
      });
      state.annotations.push(annotation);
      state.mode = 'idle';
      scheduleSave();
      renderAll();
      openEditor(annotation.id, true);
      return;
    }

    if (state.mode === 'arrow') {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      state.draftArrow = {
        start: { x: event.clientX, y: event.clientY },
        end: { x: event.clientX, y: event.clientY },
        startAnchor: createPointAnchor(event.clientX, event.clientY, target)
      };
      renderShellState();
      renderOverlay();
    }
  }

  function handlePagePointerMove(event) {
    if (state.mode !== 'arrow' || !state.draftArrow || isInsideAnnotator(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    state.draftArrow.end = { x: event.clientX, y: event.clientY };
    requestRender();
  }

  function handlePagePointerUp(event) {
    if (state.mode !== 'arrow' || !state.draftArrow || isInsideAnnotator(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const distance = Math.hypot(event.clientX - state.draftArrow.start.x, event.clientY - state.draftArrow.start.y);
    if (distance < 14) {
      state.draftArrow = null;
      renderOverlay();
      toast('Drag farther to create an arrow');
      return;
    }

    const target = document.elementFromPoint(event.clientX, event.clientY);
    const annotation = baseAnnotation('arrow', {
      startAnchor: state.draftArrow.startAnchor,
      endAnchor: createPointAnchor(event.clientX, event.clientY, target),
      title: 'Callout arrow',
      label: '',
      color: state.settings.defaultColor === 'yellow' ? 'orange' : state.settings.defaultColor
    });
    state.annotations.push(annotation);
    state.draftArrow = null;
    state.mode = 'idle';
    scheduleSave();
    renderAll();
    openEditor(annotation.id, true);
  }

  function isInsideAnnotator(event) {
    return event.composedPath().includes(host);
  }

  function baseAnnotation(type, extra = {}) {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : `fi-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type,
      title: '',
      note: '',
      label: '',
      category: 'Reference',
      severity: 'Info',
      color: 'yellow',
      tags: [],
      source: currentPageMetadata(),
      createdAt: now,
      updatedAt: now,
      ...extra
    };
  }

  function openEditor(id, isNew = false) {
    const annotation = state.annotations.find(item => item.id === id);
    if (!annotation) return;
    state.editingId = id;
    const meta = TYPE_META[annotation.type] || { label: annotation.type };
    const quoteBlock = annotation.quote
      ? `<div class="fi-quote"><span>Selected text</span><blockquote>${escapeHtml(annotation.quote)}</blockquote></div>`
      : '';

    modal.innerHTML = `
      <div class="fi-modal-backdrop"></div>
      <form class="fi-editor">
        <header>
          <div><span>${escapeHtml(meta.label)}</span><b>${isNew ? 'New annotation' : 'Edit annotation'}</b></div>
          <button type="button" data-modal-action="close">×</button>
        </header>
        ${quoteBlock}
        <label>Title
          <input name="title" maxlength="140" value="${escapeAttr(annotation.title || '')}" placeholder="What should this annotation be called?">
        </label>
        ${annotation.type === 'label' || annotation.type === 'arrow' ? `
        <label>Visible label
          <input name="label" maxlength="100" value="${escapeAttr(annotation.label || '')}" placeholder="Text shown on the page">
        </label>` : ''}
        <label>Observation or note
          <textarea name="note" rows="5" maxlength="4000" placeholder="Why does this matter? What should the reviewer know?">${escapeHtml(annotation.note || '')}</textarea>
        </label>
        <div class="fi-form-grid">
          <label>Category
            <select name="category">
              ${['Evidence','Issue','Recommendation','Training','Reference','Decision','Question'].map(value => option(value, annotation.category)).join('')}
            </select>
          </label>
          <label>Severity
            <select name="severity">
              ${['Info','Low','Medium','High','Critical'].map(value => option(value, annotation.severity)).join('')}
            </select>
          </label>
        </div>
        <div class="fi-form-grid">
          <label>Color
            <select name="color">
              ${Object.keys(COLOR_MAP).map(value => option(capitalize(value), capitalize(annotation.color || 'yellow'), value)).join('')}
            </select>
          </label>
          <label>Tags
            <input name="tags" value="${escapeAttr((annotation.tags || []).join(', '))}" placeholder="accessibility, UI, source">
          </label>
        </div>
        <footer>
          ${!isNew ? '<button type="button" class="danger ghost" data-modal-action="delete">Delete</button>' : '<span></span>'}
          <div>
            <button type="button" class="ghost" data-modal-action="cancel">Cancel</button>
            <button type="submit" class="save">Save annotation</button>
          </div>
        </footer>
      </form>`;

    modal.classList.remove('hidden');
    modal.querySelector('input[name="title"]')?.focus();
    modal.querySelector('.fi-modal-backdrop').addEventListener('click', () => closeModal(isNew));
    modal.querySelectorAll('[data-modal-action]').forEach(button => {
      button.addEventListener('click', () => {
        const action = button.dataset.modalAction;
        if (action === 'delete') {
          deleteAnnotation(id);
          closeModal();
        } else {
          closeModal(isNew && action !== 'close' ? true : isNew);
        }
      });
    });
    modal.querySelector('.fi-editor').addEventListener('submit', event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      annotation.title = String(form.get('title') || '').trim();
      annotation.note = String(form.get('note') || '').trim();
      annotation.label = String(form.get('label') || '').trim();
      annotation.category = String(form.get('category') || 'Reference');
      annotation.severity = String(form.get('severity') || 'Info');
      annotation.color = String(form.get('color') || 'yellow').toLowerCase();
      annotation.tags = String(form.get('tags') || '').split(',').map(tag => tag.trim()).filter(Boolean);
      annotation.updatedAt = new Date().toISOString();
      state.settings.defaultColor = annotation.color;
      saveSettings();
      scheduleSave();
      closeModal();
      renderAll();
      toast('Annotation saved');
    });
  }

  function closeModal(removeUnsaved = false) {
    if (removeUnsaved && state.editingId) {
      state.annotations = state.annotations.filter(item => item.id !== state.editingId);
      scheduleSave();
    }
    state.editingId = null;
    modal.classList.add('hidden');
    modal.innerHTML = '';
    renderAll();
  }

  function deleteAnnotation(id) {
    const annotation = state.annotations.find(item => item.id === id);
    if (!annotation) return;
    state.annotations = state.annotations.filter(item => item.id !== id);
    scheduleSave();
    renderAll();
    toast('Annotation deleted');
  }

  function undoLast() {
    if (!state.annotations.length) {
      toast('Nothing to undo');
      return;
    }
    state.annotations.pop();
    scheduleSave();
    renderAll();
    toast('Last annotation removed');
  }

  function focusAnnotation(id) {
    const annotation = state.annotations.find(item => item.id === id);
    if (!annotation) return;
    let yDoc = null;
    if (annotation.type === 'highlight') {
      const range = resolveTextRange(annotation.textAnchor);
      if (range) yDoc = range.getBoundingClientRect().top + scrollY;
    } else if (annotation.type === 'arrow') {
      yDoc = resolvePointDocument(annotation.startAnchor)?.y;
    } else {
      yDoc = resolvePointDocument(annotation.anchor)?.y;
    }
    if (Number.isFinite(yDoc)) window.scrollTo({ top: Math.max(0, yDoc - window.innerHeight * .35), behavior: 'smooth' });
    state.flashId = id;
    renderOverlay();
    setTimeout(() => { state.flashId = null; renderOverlay(); }, 1500);
  }

  function clearPage() {
    if (!state.annotations.length) {
      toast('This page has no annotations');
      return;
    }
    if (!confirm(`Delete all ${state.annotations.length} annotations on this page? The saved page snapshot will be kept.`)) return;
    state.annotations = [];
    savePageData();
    renderAll();
    closePopovers();
    toast('Page annotations cleared');
  }

  function switchSide() {
    state.settings.dockSide = state.settings.dockSide === 'right' ? 'left' : 'right';
    saveSettings();
    closePopovers();
    renderAll();
  }

  function activeCollection() {
    return state.collections.find(item => item.id === state.collectionId) || state.collections.find(item => item.id === DEFAULT_COLLECTION_ID);
  }

  function createCollection() {
    closePopovers();
    const name = prompt('Collection name:', 'New review collection');
    if (!name?.trim()) return;
    const description = prompt('Collection description (optional):', '') || '';
    const now = new Date().toISOString();
    const collection = {
      id: crypto.randomUUID ? crypto.randomUUID() : `collection-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: name.trim().slice(0, 100),
      description: description.trim().slice(0, 600),
      createdAt: now,
      updatedAt: now
    };
    state.collections.push(collection);
    saveWorkspace();
    assignCurrentPageToCollection(collection.id);
    toast(`Collection created · ${collection.name}`);
  }

  function editCollection() {
    closePopovers();
    const collection = activeCollection();
    if (!collection) return;
    const name = prompt('Collection name:', collection.name);
    if (!name?.trim()) return;
    const description = prompt('Collection description:', collection.description || '') ?? (collection.description || '');
    collection.name = name.trim().slice(0, 100);
    collection.description = String(description).trim().slice(0, 600);
    collection.updatedAt = new Date().toISOString();
    saveWorkspace();
    renderShellState();
    toast('Collection updated');
  }

  function deleteCollection() {
    closePopovers();
    if (state.collectionId === DEFAULT_COLLECTION_ID) {
      toast('The Inbox collection cannot be deleted');
      return;
    }
    const collection = activeCollection();
    if (!collection) return;
    const entries = state.pageIndex.filter(item => item.collectionId === collection.id);
    if (!confirm(`Delete “${collection.name}”? Its ${entries.length} indexed page${entries.length === 1 ? '' : 's'} will move to Inbox. Annotations will not be deleted.`)) return;

    for (const entry of entries) {
      const record = readStoredPageRecord(entry.pageKey);
      if (record) {
        record.collectionId = DEFAULT_COLLECTION_ID;
        record.updatedAt = new Date().toISOString();
        GM_setValue(storageKey(entry.pageKey), JSON.stringify(record));
      }
      entry.collectionId = DEFAULT_COLLECTION_ID;
    }
    state.collections = state.collections.filter(item => item.id !== collection.id);
    state.collectionId = DEFAULT_COLLECTION_ID;
    state.settings.lastCollectionId = DEFAULT_COLLECTION_ID;
    saveSettings();
    saveWorkspace();
    savePageData();
    renderAll();
    toast('Collection deleted; pages moved to Inbox');
  }

  function assignCurrentPageToCollection(collectionId) {
    if (!state.collections.some(item => item.id === collectionId)) return;
    state.collectionId = collectionId;
    state.settings.lastCollectionId = collectionId;
    saveSettings();
    savePageData();
    renderShellState();
    toast(`Page assigned to ${activeCollection()?.name || 'collection'}`);
  }

  function openCollectionOverview() {
    closePopovers();
    const collection = activeCollection();
    if (!collection) return;
    flushSave();
    const pages = state.pageIndex.filter(item => item.collectionId === collection.id);
    const annotationTotal = pages.reduce((sum, page) => sum + Number(page.annotationCount || 0), 0);
    const snapshotTotal = pages.filter(page => page.hasSnapshot).length;
    const pageRows = pages.length ? pages.map(page => `
      <article class="fi-collection-page">
        <div><b>${escapeHtml(page.page?.title || page.pageKey)}</b><small>${escapeHtml(page.page?.hostname || '')} · ${page.annotationCount || 0} annotations · ${page.hasSnapshot ? 'snapshot captured' : 'no snapshot'}</small></div>
        <button type="button" data-open-url="${escapeAttr(page.page?.url || page.pageKey)}">Open</button>
      </article>`).join('') : '<div class="fi-empty">No indexed pages are assigned to this collection yet.</div>';

    modal.innerHTML = `
      <div class="fi-modal-backdrop"></div>
      <section class="fi-editor fi-collection-overview">
        <header><div><span>Annotation collection</span><b>${escapeHtml(collection.name)}</b></div><button type="button" data-modal-action="close">×</button></header>
        <div class="fi-collection-summary"><div><b>${pages.length}</b><span>Pages</span></div><div><b>${annotationTotal}</b><span>Annotations</span></div><div><b>${snapshotTotal}</b><span>Snapshots</span></div></div>
        ${collection.description ? `<p class="fi-collection-description">${escapeHtml(collection.description)}</p>` : ''}
        <div class="fi-collection-pages">${pageRows}</div>
        <footer><span></span><div><button type="button" class="ghost" data-modal-action="edit">Edit collection</button><button type="button" class="save" data-modal-action="close">Done</button></div></footer>
      </section>`;
    modal.classList.remove('hidden');
    modal.querySelector('.fi-modal-backdrop').addEventListener('click', () => closeModal());
    modal.querySelectorAll('[data-modal-action]').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.modalAction === 'edit') { closeModal(); editCollection(); }
      else closeModal();
    }));
    modal.querySelectorAll('[data-open-url]').forEach(button => button.addEventListener('click', () => {
      window.open(button.dataset.openUrl, '_blank', 'noopener,noreferrer');
    }));
  }

  function capturePageSnapshot() {
    closePopovers();
    if (state.snapshot && !confirm('Replace the existing saved snapshot for this page?')) return;
    try {
      setSaveStatus('saving');
      const clone = document.documentElement.cloneNode(true);
      clone.querySelector(`#${cssEscape(HOST_ID)}`)?.remove();
      clone.querySelectorAll('script,noscript,iframe,object,embed,portal').forEach(node => node.remove());
      clone.querySelectorAll('meta[http-equiv="refresh"],meta[http-equiv="content-security-policy"]').forEach(node => node.remove());
      clone.querySelectorAll('input,textarea,select').forEach(node => {
        if (node.tagName === 'TEXTAREA') node.textContent = '';
        else if (node.tagName === 'SELECT') Array.from(node.options || []).forEach(optionNode => optionNode.removeAttribute('selected'));
        else {
          node.removeAttribute('value');
          node.removeAttribute('checked');
        }
      });
      clone.querySelectorAll('*').forEach(node => {
        for (const attr of Array.from(node.attributes || [])) {
          if (/^on/i.test(attr.name) || attr.name === 'nonce') node.removeAttribute(attr.name);
        }
      });
      const head = clone.querySelector('head');
      if (head) {
        head.querySelector('base')?.remove();
        const base = clone.ownerDocument.createElement('base');
        base.href = location.href;
        head.prepend(base);
      }
      const rawHtml = `<!doctype html>\n${clone.outerHTML}`;
      const pageText = String(document.body?.innerText || '').replace(/\n{4,}/g, '\n\n\n');
      const textContent = pageText.slice(0, MAX_SNAPSHOT_TEXT);
      const htmlTruncated = rawHtml.length > MAX_SNAPSHOT_HTML;
      const html = htmlTruncated
        ? `<!doctype html><html lang="${escapeAttr(document.documentElement.lang || 'en')}"><head><meta charset="utf-8"><base href="${escapeAttr(location.href)}"><title>${escapeHtml(document.title || location.hostname)} — Text Snapshot</title><style>body{font:16px/1.55 system-ui,sans-serif;max-width:980px;margin:40px auto;padding:0 24px;color:#17202a}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f3ed;padding:24px;border-radius:12px}</style></head><body><h1>${escapeHtml(document.title || location.hostname)}</h1><p><a href="${escapeAttr(location.href)}">${escapeHtml(location.href)}</a></p><p>The original DOM exceeded the snapshot size limit, so this capture preserves a text rendering.</p><pre>${escapeHtml(textContent)}</pre></body></html>`
        : rawHtml;
      const capturedAt = new Date().toISOString();
      state.snapshot = {
        id: crypto.randomUUID ? crypto.randomUUID() : `snapshot-${Date.now()}`,
        capturedAt,
        source: currentPageMetadata(),
        viewport: { width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY },
        document: {
          width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
          height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
          language: document.documentElement.lang || '',
          description: document.querySelector('meta[name="description"]')?.content || ''
        },
        contentHash: simpleHash(textContent),
        html,
        text: textContent,
        htmlTruncated,
        textTruncated: pageText.length > textContent.length
      };
      savePageData();
      renderShellState();
      toast(`Snapshot captured · ${formatBytes(new Blob([html]).size)}`);
    } catch (error) {
      console.error(`${APP_NAME}: snapshot capture failed`, error);
      setSaveStatus('saved');
      alert(`Snapshot capture failed: ${error.message}`);
    }
  }

  function removePageSnapshot() {
    closePopovers();
    if (!state.snapshot) {
      toast('This page has no saved snapshot');
      return;
    }
    if (!confirm('Remove the saved snapshot for this page? Annotations will be kept.')) return;
    state.snapshot = null;
    savePageData();
    renderShellState();
    toast('Page snapshot removed');
  }

  function togglePopover(selector) {
    const target = ui.querySelector(selector);
    const shouldOpen = target.classList.contains('hidden');
    closePopovers();
    target.classList.toggle('hidden', !shouldOpen);
  }

  function closePopovers() {
    ui.querySelectorAll('.fi-popover').forEach(popover => popover.classList.add('hidden'));
  }

  async function importFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (Array.isArray(parsed.pages)) {
        importCollectionPackage(parsed);
        return;
      }

      const incoming = Array.isArray(parsed.annotations) ? parsed.annotations : [];
      if (!incoming.length && !parsed.snapshot) throw new Error('No annotations or page snapshot were found in that file.');
      const replace = confirm(`Import ${incoming.length} annotations${parsed.snapshot ? ' and one snapshot' : ''}?\n\nOK = replace this page\nCancel = merge with this page`);
      if (replace) {
        state.annotations = incoming.map(normalizeImportedAnnotation);
        state.snapshot = parsed.snapshot || null;
      } else {
        mergeAnnotations(incoming);
        if (!state.snapshot && parsed.snapshot) state.snapshot = parsed.snapshot;
      }
      if (parsed.collection?.name && !state.collections.some(item => item.name.toLowerCase() === parsed.collection.name.toLowerCase())) {
        const importedCollection = normalizeImportedCollection(parsed.collection);
        state.collections.push(importedCollection);
        state.collectionId = importedCollection.id;
      }
      saveWorkspace();
      savePageData();
      renderAll();
      closePopovers();
      toast(`${incoming.length} annotations imported`);
    } catch (error) {
      alert(`Import failed: ${error.message}`);
    }
  }

  function importCollectionPackage(parsed) {
    const sourceCollection = parsed.collection || {};
    const collection = normalizeImportedCollection({
      ...sourceCollection,
      id: crypto.randomUUID ? crypto.randomUUID() : `collection-${Date.now()}`,
      name: sourceCollection.name ? `${sourceCollection.name} (Imported)` : 'Imported annotation collection'
    });
    state.collections.push(collection);

    let importedAnnotations = 0;
    for (const incomingPage of parsed.pages) {
      const page = incomingPage.page || incomingPage.source || {};
      const pageKey = incomingPage.pageKey || getPageKey(page.url || location.href);
      const record = {
        schema: 'field-instruments.web-annotation.v2',
        version: VERSION,
        pageKey,
        collectionId: collection.id,
        page,
        annotations: (incomingPage.annotations || []).map(normalizeImportedAnnotation),
        snapshot: incomingPage.snapshot || null,
        updatedAt: new Date().toISOString()
      };
      importedAnnotations += record.annotations.length;
      GM_setValue(storageKey(pageKey), JSON.stringify(record));
      upsertPageIndex(record);
    }

    state.collectionId = collection.id;
    state.settings.lastCollectionId = collection.id;
    saveSettings();
    saveWorkspace();
    const currentImported = parsed.pages.find(page => (page.pageKey || getPageKey(page.page?.url || '')) === state.pageKey);
    if (currentImported) loadPageData();
    renderAll();
    closePopovers();
    toast(`${parsed.pages.length} pages and ${importedAnnotations} annotations imported`);
  }

  function normalizeImportedCollection(item) {
    const now = new Date().toISOString();
    return {
      id: item.id || (crypto.randomUUID ? crypto.randomUUID() : `collection-${Date.now()}`),
      name: String(item.name || 'Imported collection').trim().slice(0, 100),
      description: String(item.description || '').trim().slice(0, 600),
      createdAt: item.createdAt || now,
      updatedAt: now
    };
  }

  function mergeAnnotations(incoming) {
    const existingIds = new Set(state.annotations.map(item => item.id));
    for (const item of incoming.map(normalizeImportedAnnotation)) {
      if (existingIds.has(item.id)) item.id = crypto.randomUUID ? crypto.randomUUID() : `fi-${Date.now()}-${Math.random()}`;
      existingIds.add(item.id);
      state.annotations.push(item);
    }
  }

  function normalizeImportedAnnotation(item) {
    const normalized = {
      ...baseAnnotation(item.type || 'note'),
      ...item,
      updatedAt: new Date().toISOString()
    };
    normalized.tags = Array.isArray(normalized.tags) ? normalized.tags : [];
    return normalized;
  }

  function readStoredPageRecord(pageKey) {
    try {
      const saved = GM_getValue(storageKey(pageKey), '');
      if (!saved) return null;
      const parsed = JSON.parse(saved);
      return {
        schema: parsed.schema || 'field-instruments.web-annotation.v1',
        version: parsed.version || '1.0.0',
        pageKey,
        collectionId: parsed.collectionId || state.pageIndex.find(item => item.pageKey === pageKey)?.collectionId || DEFAULT_COLLECTION_ID,
        page: parsed.page || state.pageIndex.find(item => item.pageKey === pageKey)?.page || { url: pageKey, title: pageKey },
        annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
        snapshot: parsed.snapshot || null,
        updatedAt: parsed.updatedAt || ''
      };
    } catch (error) {
      console.warn(`${APP_NAME}: stored page could not be read`, pageKey, error);
      return null;
    }
  }

  function getExportRecords(scope = state.exportScope) {
    flushSave();
    if (scope !== 'collection') {
      return [{
        schema: 'field-instruments.web-annotation.v2',
        version: VERSION,
        pageKey: state.pageKey,
        collectionId: state.collectionId,
        page: state.pageMeta || currentPageMetadata(),
        annotations: state.annotations,
        snapshot: state.snapshot,
        updatedAt: new Date().toISOString()
      }];
    }

    const records = [];
    const seen = new Set();
    for (const entry of state.pageIndex.filter(item => item.collectionId === state.collectionId)) {
      const record = readStoredPageRecord(entry.pageKey);
      if (!record || seen.has(entry.pageKey)) continue;
      seen.add(entry.pageKey);
      records.push(record);
    }
    const currentIndexEntry = state.pageIndex.find(item => item.pageKey === state.pageKey);
    const currentBelongsHere = currentIndexEntry?.collectionId === state.collectionId || state.annotations.length > 0 || Boolean(state.snapshot);
    if (!seen.has(state.pageKey) && currentBelongsHere) records.push(getExportRecords('page')[0]);
    return records.sort((a, b) => String(a.page?.title || '').localeCompare(String(b.page?.title || '')));
  }

  function exportAnnotations(format, forcedScope = null) {
    const scope = forcedScope || state.exportScope;
    if (format === 'snapshot-html') {
      if (!state.snapshot) capturePageSnapshot();
      if (!state.snapshot) return;
      const record = getExportRecords('page')[0];
      const date = new Date().toISOString();
      const baseName = sanitizeFilename(`${location.hostname}-${document.title || 'page'}-snapshot`);
      downloadText(`${baseName}.snapshot.html`, buildSnapshotHtml(record, date), 'text/html');
      toast('Evidence snapshot exported');
      return;
    }

    const records = getExportRecords(scope);
    if (!records.length) {
      toast('No indexed pages are available for this export');
      return;
    }
    const date = new Date().toISOString();
    const collection = activeCollection();
    const baseName = sanitizeFilename(scope === 'collection'
      ? `${collection?.name || 'annotation-collection'}-${records.length}-pages`
      : `${records[0].page?.hostname || location.hostname}-${records[0].page?.title || 'annotations'}`);
    let content;
    let mime;
    let extension;

    if (format === 'native-json') {
      const payload = {
        schema: 'field-instruments.web-annotation-package.v2',
        version: VERSION,
        exportedAt: date,
        exportScope: scope,
        collection: collection ? { ...collection } : null,
        pages: records
      };
      if (scope === 'page') {
        payload.page = records[0].page;
        payload.annotations = records[0].annotations;
        payload.snapshot = records[0].snapshot;
      }
      content = JSON.stringify(payload, null, 2);
      mime = 'application/json'; extension = 'json';
    }

    if (format === 'trace-json') {
      content = JSON.stringify(buildTracePackage(records, scope, date), null, 2);
      mime = 'application/json'; extension = 'trace.json';
    }

    if (format === 'critique-md') {
      content = buildCritiqueMarkdown(records, scope, date);
      mime = 'text/markdown'; extension = 'critique.md';
    }

    if (format === 'design-md') {
      content = buildDesignMarkdown(records, scope, date);
      mime = 'text/markdown'; extension = 'design-report.md';
    }

    if (format === 'training-html') {
      content = buildTrainingHtml(records, scope, date);
      mime = 'text/html'; extension = 'training.html';
    }

    if (format === 'reliquary-json') {
      content = JSON.stringify(buildReliquaryRecord(records, scope, date), null, 2);
      mime = 'application/json'; extension = 'reliquary.json';
    }

    if (content == null) return;
    downloadText(`${baseName}.${extension}`, content, mime);
    toast(`${formatLabel(format)} exported · ${scope === 'collection' ? `${records.length} pages` : 'current page'}`);
  }

  function exportSummary(records) {
    const annotations = records.flatMap(record => record.annotations || []);
    const severity = {};
    const category = {};
    for (const annotation of annotations) {
      severity[annotation.severity || 'Info'] = (severity[annotation.severity || 'Info'] || 0) + 1;
      category[annotation.category || 'Reference'] = (category[annotation.category || 'Reference'] || 0) + 1;
    }
    return {
      pageCount: records.length,
      annotationCount: annotations.length,
      snapshotCount: records.filter(record => record.snapshot).length,
      severity,
      category
    };
  }

  function buildTracePackage(records, scope, date) {
    const summary = exportSummary(records);
    return {
      schema: 'trace.evidence-package.v2',
      generator: { name: APP_NAME, version: VERSION },
      exportedAt: date,
      scope,
      collection: activeCollection(),
      summary,
      sources: records.map(record => ({
        sourceId: record.pageKey,
        ...record.page,
        annotationCount: record.annotations.length,
        snapshotId: record.snapshot?.id || '',
        snapshotCapturedAt: record.snapshot?.capturedAt || ''
      })),
      snapshots: records.filter(record => record.snapshot).map(record => ({ sourceId: record.pageKey, ...record.snapshot })),
      evidence: records.flatMap(record => record.annotations.map((annotation, index) => ({
        evidenceId: annotation.id,
        sourceId: record.pageKey,
        sequenceWithinSource: index + 1,
        evidenceType: 'web-annotation',
        annotationType: annotation.type,
        title: annotation.title || TYPE_META[annotation.type]?.label || 'Annotation',
        observation: annotation.note || '',
        quotedText: annotation.quote || '',
        visibleLabel: annotation.label || '',
        category: annotation.category || 'Reference',
        severity: annotation.severity || 'Info',
        tags: annotation.tags || [],
        locator: exportLocator(annotation),
        sourceUrl: record.page.url,
        sourceTitle: record.page.title,
        capturedAt: annotation.createdAt,
        updatedAt: annotation.updatedAt
      })))
    };
  }

  function buildCritiqueMarkdown(records, scope, date) {
    const summary = exportSummary(records);
    const title = scope === 'collection' ? activeCollection()?.name || 'Web Critique Collection' : records[0].page.title;
    const rows = records.flatMap(record => record.annotations.map((annotation, index) => {
      const finding = annotation.note || annotation.quote || annotation.label || '';
      return `| ${escapeMd(record.page.title)} | ${index + 1} | ${escapeMd(annotation.category || 'Reference')} | ${escapeMd(annotation.severity || 'Info')} | ${escapeMd(annotation.title || TYPE_META[annotation.type]?.label || annotation.type)} | ${escapeMd(truncate(finding, 180))} |`;
    })).join('\n');
    const detail = records.map(record => {
      const notes = record.annotations.map((annotation, index) => markdownAnnotation(annotation, index + 1, 'Critique note')).join('\n\n');
      return `## Source: ${record.page.title}\n\n- **URL:** ${record.page.url}\n- **Snapshot:** ${record.snapshot ? `Captured ${record.snapshot.capturedAt}` : 'Not captured'}\n- **Annotations:** ${record.annotations.length}\n\n${notes || '_No annotations recorded for this source._'}`;
    }).join('\n\n---\n\n');
    return `# Critique Review: ${title}\n\n` +
      `**Scope:** ${scope === 'collection' ? 'Multi-page collection' : 'Current page'}\n\n**Reviewed:** ${date}\n\n` +
      `**Sources:** ${summary.pageCount} · **Annotations:** ${summary.annotationCount} · **Snapshots:** ${summary.snapshotCount}\n\n` +
      `## Review Summary\n\n- **Severity:** ${objectSummary(summary.severity)}\n- **Categories:** ${objectSummary(summary.category)}\n\n` +
      `## Findings Register\n\n| Source | # | Category | Severity | Finding | Observation |\n|---|---:|---|---|---|---|\n${rows || '| — | — | — | — | No findings recorded | — |'}\n\n` +
      `${detail}\n`;
  }

  function buildDesignMarkdown(records, scope, date) {
    const summary = exportSummary(records);
    const title = scope === 'collection' ? activeCollection()?.name || 'Annotated Web References' : records[0].page.title;
    const sources = records.map(record => {
      const detail = record.annotations.map((annotation, index) => markdownAnnotation(annotation, index + 1, 'Design implication')).join('\n\n');
      return `## ${record.page.title}\n\n- **URL:** ${record.page.url}\n- **Captured snapshot:** ${record.snapshot?.capturedAt || 'Not captured'}\n- **Content hash:** ${record.snapshot?.contentHash || 'Not available'}\n- **Annotation count:** ${record.annotations.length}\n\n${detail || '_No annotations recorded._'}`;
    }).join('\n\n---\n\n');
    return `# Design Report Appendix: ${title}\n\n` +
      `## Source Set\n\n- **Scope:** ${scope}\n- **Exported:** ${date}\n- **Sources:** ${summary.pageCount}\n- **Annotations:** ${summary.annotationCount}\n- **Snapshots:** ${summary.snapshotCount}\n- **Tool:** ${APP_NAME} v${VERSION}\n\n` +
      `${sources}\n\n## Provenance Note\n\nThese observations were recorded as a non-destructive overlay. Captured snapshots are sanitized copies with scripts and live form values removed; external resources may still depend on the source site.\n`;
  }

  function buildTrainingHtml(records, scope, date) {
    const summary = exportSummary(records);
    const title = scope === 'collection' ? activeCollection()?.name || 'Web Annotation Training Reference' : records[0].page.title;
    const navigation = records.map((record, index) => `<a href="#source-${index + 1}">${escapeHtml(record.page.title)}</a>`).join('');
    const sections = records.map((record, sourceIndex) => {
      const cards = record.annotations.map((annotation, index) => {
        const color = COLOR_MAP[annotation.color] || COLOR_MAP.yellow;
        return `<article class="card" style="--accent:${color.solid}"><div class="num">${index + 1}</div><div><div class="meta">${escapeHtml(annotation.category || 'Reference')} · ${escapeHtml(annotation.severity || 'Info')} · ${escapeHtml(TYPE_META[annotation.type]?.label || annotation.type)}</div><h3>${escapeHtml(annotation.title || TYPE_META[annotation.type]?.label || 'Annotation')}</h3>${annotation.quote ? `<blockquote>${escapeHtml(annotation.quote)}</blockquote>` : ''}${annotation.note ? `<p>${nl2br(escapeHtml(annotation.note))}</p>` : ''}${annotation.label ? `<p><strong>Visible label:</strong> ${escapeHtml(annotation.label)}</p>` : ''}${(annotation.tags || []).length ? `<p class="tags">${annotation.tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</p>` : ''}</div></article>`;
      }).join('');
      return `<section id="source-${sourceIndex + 1}" class="source"><header><div><span>SOURCE ${sourceIndex + 1}</span><h2>${escapeHtml(record.page.title)}</h2></div><a href="${escapeAttr(record.page.url)}">Open source</a></header><p class="source-meta">${escapeHtml(record.page.url)} · ${record.annotations.length} annotations · ${record.snapshot ? `snapshot ${escapeHtml(record.snapshot.capturedAt)}` : 'no snapshot'}</p>${cards || '<p>No annotations recorded.</p>'}</section>`;
    }).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Training Reference — ${escapeHtml(title)}</title><style>body{font:16px/1.55 system-ui,sans-serif;max-width:1040px;margin:0 auto;padding:40px 24px;color:#18202a;background:#f5f3ed}.hero{padding:28px;background:#17202a;color:#fff;border-radius:18px}.hero p{color:#cbd5df}.nav{display:flex;gap:8px;overflow:auto;margin:18px 0}.nav a{white-space:nowrap;background:#fff;border:1px solid #d5d9dd;border-radius:999px;padding:7px 12px;color:#203143;text-decoration:none}.source{margin:36px 0}.source>header{display:flex;align-items:end;justify-content:space-between;border-bottom:2px solid #17202a;padding-bottom:10px}.source>header span,.meta{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#637080}.source>header h2{margin:2px 0}.source-meta{overflow-wrap:anywhere;color:#637080}.card{display:grid;grid-template-columns:44px 1fr;gap:16px;background:#fff;margin:18px 0;padding:22px;border-left:7px solid var(--accent);border-radius:12px;box-shadow:0 5px 18px #0001}.num{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:#17202a;color:#fff;font-weight:800}h1,h2,h3{line-height:1.15}blockquote{margin:14px 0;padding:14px 18px;background:#f4f6f8;border-left:4px solid var(--accent)}.tags span{display:inline-block;background:#e9edf1;border-radius:999px;padding:3px 9px;margin:3px;font-size:12px}footer{margin-top:36px;color:#64707d;font-size:13px}</style></head><body><header class="hero"><div>FIELD INSTRUMENTS · TRAINING DOCUMENTATION</div><h1>${escapeHtml(title)}</h1><p>${summary.pageCount} sources · ${summary.annotationCount} annotations · ${summary.snapshotCount} captured snapshots</p><p>Generated ${escapeHtml(date)}</p></header><nav class="nav">${navigation}</nav>${sections}<footer>Generated by ${APP_NAME} v${VERSION}. Annotations were applied as a non-destructive webpage overlay.</footer></body></html>`;
  }

  function buildReliquaryRecord(records, scope, date) {
    const summary = exportSummary(records);
    return {
      schema: 'reliquary.project-record.v2',
      generator: { name: APP_NAME, version: VERSION },
      exportedAt: date,
      scope,
      collection: activeCollection(),
      summary,
      recordType: 'annotated-web-reference-collection',
      artifacts: records.map(record => ({
        artifactId: record.pageKey,
        title: record.page.title,
        url: record.page.url,
        canonicalUrl: record.page.canonicalUrl || '',
        hostname: record.page.hostname,
        capturedAt: record.snapshot?.capturedAt || date,
        annotationCount: record.annotations.length,
        snapshot: record.snapshot || null,
        preservationNote: 'Annotations were recorded as a non-destructive overlay. Saved snapshots have scripts and live form values removed.',
        records: record.annotations.map(annotation => ({
          id: annotation.id,
          type: annotation.type,
          title: annotation.title || TYPE_META[annotation.type]?.label || 'Annotation',
          description: annotation.note || '',
          quote: annotation.quote || '',
          label: annotation.label || '',
          category: annotation.category || 'Reference',
          severity: annotation.severity || 'Info',
          tags: annotation.tags || [],
          locator: exportLocator(annotation),
          createdAt: annotation.createdAt,
          updatedAt: annotation.updatedAt
        }))
      }))
    };
  }

  function buildSnapshotHtml(record, date) {
    const snapshot = record.snapshot;
    const encoded = utf8ToBase64(snapshot.html || '<!doctype html><html><body><p>No HTML content captured.</p></body></html>');
    const cards = record.annotations.map((annotation, index) => `<article><b>${index + 1}. ${escapeHtml(annotation.title || TYPE_META[annotation.type]?.label || 'Annotation')}</b><small>${escapeHtml(annotation.category || 'Reference')} · ${escapeHtml(annotation.severity || 'Info')}</small>${annotation.quote ? `<blockquote>${escapeHtml(annotation.quote)}</blockquote>` : ''}${annotation.note ? `<p>${nl2br(escapeHtml(annotation.note))}</p>` : ''}</article>`).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Evidence Snapshot — ${escapeHtml(record.page.title)}</title><style>*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,sans-serif;background:#e9edf0;color:#17202a}.bar{position:sticky;top:0;z-index:3;background:#17202a;color:#fff;padding:12px 18px;display:flex;justify-content:space-between;gap:20px}.bar div{min-width:0}.bar b{display:block;font-size:16px}.bar small{display:block;color:#b9c7d2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.layout{display:grid;grid-template-columns:minmax(0,1fr) 360px;height:calc(100vh - 66px)}iframe{width:100%;height:100%;border:0;background:#fff}.notes{overflow:auto;padding:14px;background:#f5f3ed;border-left:1px solid #c8ced3}.notes h2{margin:3px 0 12px}.notes article{background:#fff;border:1px solid #d5d9dd;border-radius:10px;padding:12px;margin:10px 0}.notes article b,.notes article small{display:block}.notes article small{color:#667481;margin:3px 0 8px}.notes blockquote{margin:8px 0;padding:8px 10px;background:#fff8cf;border-left:4px solid #f0c419}@media(max-width:800px){.layout{grid-template-columns:1fr;height:auto}iframe{height:70vh}.notes{border-left:0;border-top:1px solid #c8ced3}}</style></head><body><header class="bar"><div><b>${escapeHtml(record.page.title)}</b><small>${escapeHtml(record.page.url)}</small></div><div><b>${record.annotations.length} annotations</b><small>Snapshot ${escapeHtml(snapshot.capturedAt)} · Export ${escapeHtml(date)}</small></div></header><main class="layout"><iframe id="captured-page" sandbox=""></iframe><aside class="notes"><h2>Annotation Register</h2><p>Content hash: <code>${escapeHtml(snapshot.contentHash || '')}</code>${snapshot.htmlTruncated ? ' · HTML capture truncated' : ''}</p>${cards || '<p>No annotations recorded.</p>'}</aside></main><script>const encoded=${JSON.stringify(encoded)};const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));document.getElementById('captured-page').srcdoc=new TextDecoder().decode(bytes);</script></body></html>`;
  }

  function markdownAnnotation(annotation, index, noteLabel) {
    const title = annotation.title || TYPE_META[annotation.type]?.label || annotation.type;
    const lines = [
      `### ${index}. ${escapeMd(title)}`,
      '',
      `- **Type:** ${TYPE_META[annotation.type]?.label || annotation.type}`,
      `- **Category:** ${annotation.category || 'Reference'}`,
      `- **Severity:** ${annotation.severity || 'Info'}`,
      `- **Tags:** ${(annotation.tags || []).join(', ') || 'None'}`
    ];
    if (annotation.quote) lines.push('', `> ${annotation.quote.replace(/\n/g, '\n> ')}`);
    if (annotation.label) lines.push('', `**Visible label:** ${annotation.label}`);
    lines.push('', `**${noteLabel}:** ${annotation.note || '_Not recorded_'}`);
    return lines.join('\n');
  }

  function exportLocator(annotation) {
    if (annotation.type === 'highlight') {
      return {
        method: 'text-quote',
        exact: annotation.textAnchor?.exact || annotation.quote || '',
        prefix: annotation.textAnchor?.prefix || '',
        suffix: annotation.textAnchor?.suffix || ''
      };
    }
    if (annotation.type === 'arrow') {
      return { method: 'anchored-vector', start: annotation.startAnchor, end: annotation.endAnchor };
    }
    return { method: 'anchored-point', anchor: annotation.anchor };
  }

  function createTextAnchor(range, quote) {
    const map = buildTextMap();
    if (!map.text || !quote) return null;
    const preferredRect = range.getBoundingClientRect();
    const occurrences = findOccurrences(map.text, quote);
    let best = null;
    let bestScore = -Infinity;

    for (const start of occurrences.slice(0, 200)) {
      const candidate = rangeFromTextOffsets(map, start, start + quote.length);
      if (!candidate) continue;
      const rect = candidate.getBoundingClientRect();
      const score = -Math.abs(rect.top - preferredRect.top) - Math.abs(rect.left - preferredRect.left) * .2;
      if (score > bestScore) {
        bestScore = score;
        best = { start, range: candidate };
      }
    }

    if (!best) {
      const start = map.text.indexOf(quote);
      if (start < 0) return null;
      best = { start };
    }

    return {
      exact: quote,
      prefix: map.text.slice(Math.max(0, best.start - 48), best.start),
      suffix: map.text.slice(best.start + quote.length, best.start + quote.length + 48),
      startChar: best.start
    };
  }

  function resolveTextRange(anchor) {
    if (!anchor?.exact) return null;
    const map = buildTextMap();
    const occurrences = findOccurrences(map.text, anchor.exact);
    if (!occurrences.length) return null;

    let bestStart = occurrences[0];
    let bestScore = -Infinity;
    for (const start of occurrences) {
      let score = 0;
      if (anchor.prefix) score += commonSuffixLength(map.text.slice(Math.max(0, start - anchor.prefix.length), start), anchor.prefix) * 4;
      if (anchor.suffix) score += commonPrefixLength(map.text.slice(start + anchor.exact.length, start + anchor.exact.length + anchor.suffix.length), anchor.suffix) * 4;
      if (Number.isFinite(anchor.startChar)) score -= Math.abs(start - anchor.startChar) * .002;
      if (score > bestScore) { bestScore = score; bestStart = start; }
    }
    return rangeFromTextOffsets(map, bestStart, bestStart + anchor.exact.length);
  }

  function buildTextMap() {
    const nodes = [];
    let text = '';
    if (!document.body) return { text, nodes };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || !node.nodeValue) return NodeFilter.FILTER_REJECT;
        if (parent.closest(`#${HOST_ID},script,style,noscript,template,textarea,select,option`)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode())) {
      const start = text.length;
      text += node.nodeValue;
      nodes.push({ node, start, end: text.length });
    }
    return { text, nodes };
  }

  function rangeFromTextOffsets(map, start, end) {
    const startInfo = map.nodes.find(item => start >= item.start && start <= item.end);
    const endInfo = map.nodes.find(item => end >= item.start && end <= item.end) || map.nodes[map.nodes.length - 1];
    if (!startInfo || !endInfo) return null;
    const range = document.createRange();
    try {
      range.setStart(startInfo.node, clamp(start - startInfo.start, 0, startInfo.node.nodeValue.length));
      range.setEnd(endInfo.node, clamp(end - endInfo.start, 0, endInfo.node.nodeValue.length));
      return range;
    } catch {
      return null;
    }
  }

  function createPointAnchor(clientX, clientY, target) {
    const candidate = target && target !== host && !target.closest?.(`#${HOST_ID}`) ? target : null;
    if (candidate && candidate.nodeType === Node.ELEMENT_NODE) {
      const rect = candidate.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return {
          kind: 'element',
          selector: uniqueSelector(candidate),
          xRatio: clamp((clientX - rect.left) / rect.width, 0, 1),
          yRatio: clamp((clientY - rect.top) / rect.height, 0, 1),
          fallbackX: clientX + scrollX,
          fallbackY: clientY + scrollY
        };
      }
    }
    return { kind: 'document', x: clientX + scrollX, y: clientY + scrollY };
  }

  function resolvePoint(anchor) {
    const docPoint = resolvePointDocument(anchor);
    return docPoint ? { x: docPoint.x - scrollX, y: docPoint.y - scrollY } : null;
  }

  function resolvePointDocument(anchor) {
    if (!anchor) return null;
    if (anchor.kind === 'element' && anchor.selector) {
      try {
        const target = document.querySelector(anchor.selector);
        if (target) {
          const rect = target.getBoundingClientRect();
          return {
            x: rect.left + scrollX + rect.width * (Number(anchor.xRatio) || 0),
            y: rect.top + scrollY + rect.height * (Number(anchor.yRatio) || 0)
          };
        }
      } catch { /* fall through */ }
      if (Number.isFinite(anchor.fallbackX) && Number.isFinite(anchor.fallbackY)) return { x: anchor.fallbackX, y: anchor.fallbackY };
    }
    if (anchor.kind === 'document') return { x: Number(anchor.x) || 0, y: Number(anchor.y) || 0 };
    return null;
  }

  function uniqueSelector(element) {
    if (!(element instanceof Element)) return '';
    if (element.id) return `#${cssEscape(element.id)}`;
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      let part = current.localName;
      const stableClass = Array.from(current.classList || []).find(name => /^[a-zA-Z][\w-]{2,}$/.test(name) && !/active|selected|hover|focus|open|closed|current|js-|css-/.test(name));
      if (stableClass) part += `.${cssEscape(stableClass)}`;
      const siblings = current.parentElement ? Array.from(current.parentElement.children).filter(sibling => sibling.localName === current.localName) : [];
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      parts.unshift(part);
      const selector = parts.join(' > ');
      try { if (document.querySelectorAll(selector).length === 1) return selector; } catch { /* continue */ }
      current = current.parentElement;
    }
    return `body > ${parts.join(' > ')}`;
  }

  function matchesFilter(annotation, filter) {
    if (!filter) return true;
    return [annotation.type, annotation.title, annotation.note, annotation.label, annotation.quote, annotation.category, annotation.severity, ...(annotation.tags || [])]
      .some(value => String(value || '').toLowerCase().includes(filter));
  }

  function setSaveStatus(status) {
    const container = ui?.querySelector('.fi-save-status');
    if (!container) return;
    container.classList.toggle('saving', status === 'saving');
    container.querySelector('b').textContent = status === 'saving' ? 'Saving' : 'Saved';
  }

  function toast(message) {
    const node = ui?.querySelector('.fi-toast');
    if (!node) return;
    clearTimeout(toastTimer);
    node.textContent = message;
    node.classList.add('show');
    toastTimer = setTimeout(() => node.classList.remove('show'), 2300);
  }

  function currentPageMetadata() {
    return {
      url: location.href,
      pageKey: getPageKey(),
      canonicalUrl: document.querySelector('link[rel="canonical"]')?.href || '',
      title: document.title || location.hostname,
      hostname: location.hostname,
      description: document.querySelector('meta[name="description"]')?.content || '',
      language: document.documentElement.lang || '',
      capturedAt: new Date().toISOString()
    };
  }

  function downloadText(filename, content, mime) {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.documentElement.appendChild(anchor);
    anchor.click();
    setTimeout(() => { URL.revokeObjectURL(url); anchor.remove(); }, 1000);
  }

  function formatLabel(format) {
    return ({
      'native-json': 'Native JSON', 'snapshot-html': 'Evidence snapshot', 'trace-json': 'Trace package',
      'critique-md': 'Critique review', 'design-md': 'Design report appendix',
      'training-html': 'Training document', 'reliquary-json': 'Reliquary record'
    })[format] || 'File';
  }

  function objectSummary(object) {
    const entries = Object.entries(object || {}).sort((a, b) => b[1] - a[1]);
    return entries.length ? entries.map(([key, value]) => `${key}: ${value}`).join(' · ') : 'None';
  }

  function simpleHash(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  function utf8ToBase64(value) {
    const bytes = new TextEncoder().encode(String(value || ''));
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
  }

  function formatCompactDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'saved';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
  }

  function option(label, current, value = label) {
    return `<option value="${escapeAttr(value)}" ${String(current).toLowerCase() === String(value).toLowerCase() ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }

  function el(tag, attrs = {}) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'class') node.className = value;
      else node.setAttribute(key, value);
    }
    return node;
  }

  function svgEl(tag, attrs = {}) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  }

  function findOccurrences(text, quote) {
    const found = [];
    let from = 0;
    while (from <= text.length) {
      const index = text.indexOf(quote, from);
      if (index < 0) break;
      found.push(index);
      from = index + Math.max(1, quote.length);
    }
    return found;
  }

  function commonPrefixLength(a, b) {
    let count = 0;
    while (count < a.length && count < b.length && a[count] === b[count]) count++;
    return count;
  }

  function commonSuffixLength(a, b) {
    let count = 0;
    while (count < a.length && count < b.length && a[a.length - 1 - count] === b[b.length - 1 - count]) count++;
    return count;
  }

  function isNearViewport(point, pad = 100) {
    return point.x > -pad && point.x < window.innerWidth + pad && point.y > -pad && point.y < window.innerHeight + pad;
  }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function truncate(value, length) { const text = String(value || ''); return text.length > length ? `${text.slice(0, length - 1)}…` : text; }
  function capitalize(value) { const text = String(value || ''); return text.charAt(0).toUpperCase() + text.slice(1); }
  function nl2br(value) { return value.replace(/\n/g, '<br>'); }
  function sanitizeFilename(value) { return String(value || 'annotations').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 120); }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[char]); }
  function escapeAttr(value) { return escapeHtml(value).replace(/`/g, '&#96;'); }
  function escapeMd(value) { return String(value || '').replace(/\|/g, '\\|').replace(/\n/g, ' '); }
  function cssEscape(value) { return window.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, char => `\\${char}`); }

  function getStyles() {
    return `
      :host{--ink:#17202a;--muted:#6d7884;--panel:#f6f4ee;--paper:#fffdf8;--line:#d8d4ca;--accent:#df562f;--accent2:#1d6d75;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink)}
      *{box-sizing:border-box}.hidden{display:none!important}button,input,textarea,select{font:inherit}.fi-overlay{position:fixed;inset:0;pointer-events:none;overflow:hidden}.fi-svg{position:absolute;inset:0;overflow:visible;pointer-events:none}.fi-shell{position:fixed;inset:0;pointer-events:none}.fi-launcher{pointer-events:auto;position:absolute;right:18px;bottom:18px;width:54px;height:54px;border:2px solid #fff;border-radius:16px;background:#17202a;color:#fff;box-shadow:0 8px 26px #0005;cursor:pointer;display:grid;place-items:center;transition:.18s transform}.side-left .fi-launcher{left:18px;right:auto}.fi-launcher:hover{transform:translateY(-2px)}.fi-launcher-mark{font:900 25px/1 Georgia,serif}.fi-count{position:absolute;right:-6px;top:-7px;min-width:23px;height:23px;padding:0 6px;border-radius:999px;background:var(--accent);display:grid;place-items:center;font-size:11px;font-weight:800;border:2px solid #fff}.fi-dock{pointer-events:auto;position:absolute;right:18px;bottom:82px;width:386px;max-height:calc(100vh - 104px);background:var(--panel);border:1px solid #bcb7aa;border-radius:18px;box-shadow:0 18px 50px #0005;overflow:visible}.side-left .fi-dock{left:18px;right:auto}.fi-header{display:flex;align-items:center;justify-content:space-between;padding:15px 16px 10px;background:#17202a;color:#fff;border-radius:17px 17px 0 0}.fi-kicker{font-size:9px;letter-spacing:.18em;color:#a9bac7;font-weight:800}.fi-title{font:800 21px/1.2 Georgia,serif}.fi-header-actions{display:flex;gap:6px}.fi-icon-btn{border:0;background:transparent;color:inherit;width:29px;height:29px;border-radius:9px;cursor:pointer;font-weight:900}.fi-icon-btn:hover{background:#ffffff18}.fi-version-row{height:28px;padding:0 16px;display:flex;align-items:center;justify-content:space-between;font-size:10px;color:var(--muted);border-bottom:1px solid var(--line)}.fi-save-status{display:flex;gap:6px;align-items:center}.fi-save-status i{width:7px;height:7px;border-radius:50%;background:#40a56d;box-shadow:0 0 0 3px #40a56d22}.fi-save-status.saving i{background:#e6a23c;animation:pulse 1s infinite}.fi-workspace-row{display:grid;grid-template-columns:minmax(0,1fr) 34px 116px;gap:7px;align-items:end;padding:10px 12px 0}.fi-collection-control{display:flex;flex-direction:column;gap:3px;min-width:0}.fi-collection-control span,.fi-export-scope span{font-size:9px;font-weight:850;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}.fi-collection-control select,.fi-export-scope select{width:100%;height:34px;border:1px solid var(--line);border-radius:9px;background:var(--paper);color:var(--ink);padding:0 8px;font-size:11px;font-weight:700}.fi-mini-btn,.fi-snapshot-btn{height:34px;border:1px solid var(--line);border-radius:9px;background:var(--paper);color:var(--ink);cursor:pointer}.fi-mini-btn{font-size:18px}.fi-snapshot-btn{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;padding:3px 8px;overflow:hidden}.fi-snapshot-btn b{font-size:10px}.fi-snapshot-btn small{display:block;max-width:100%;font-size:8px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fi-snapshot-btn.captured{border-color:#40a56d;background:#e8f5ed}.fi-tools{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;padding:12px}.fi-tool{border:1px solid var(--line);border-radius:12px;background:var(--paper);padding:9px 5px 8px;min-height:75px;cursor:pointer;color:var(--ink);display:flex;flex-direction:column;align-items:center;gap:2px}.fi-tool:hover,.fi-tool.active{border-color:var(--accent2);box-shadow:0 0 0 2px #1d6d7525}.fi-tool.primary{background:#fff9d9}.fi-tool span{font-size:21px;line-height:1}.fi-tool b{font-size:11px}.fi-tool small{font-size:9px;color:var(--muted)}.fi-modebar{display:flex;align-items:center;justify-content:space-between;min-height:31px;padding:4px 13px;background:#ebe8df;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:11px}.fi-link-btn{border:0;background:transparent;color:#a42c18;text-decoration:underline;cursor:pointer}.fi-command-row{display:grid;grid-template-columns:1.2fr .8fr 1fr .5fr;gap:6px;padding:10px 12px}.fi-command-row button{height:34px;border:1px solid var(--line);background:var(--paper);border-radius:9px;cursor:pointer;font-size:11px;font-weight:750;color:var(--ink)}.fi-command-row button:hover{border-color:#89939e}.fi-review-count{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 4px;border-radius:999px;background:#dfe4e8;font-size:9px}.fi-panel{border-top:1px solid var(--line);max-height:420px;overflow:hidden;background:#f1eee6}.fi-panel-head{display:flex;gap:8px;padding:10px;border-bottom:1px solid var(--line)}.fi-filter{flex:1;min-width:0;border:1px solid var(--line);border-radius:9px;background:#fff;padding:8px 10px;color:var(--ink);font-size:12px}.fi-list{max-height:345px;overflow:auto;padding:8px}.fi-empty{padding:28px 18px;color:var(--muted);text-align:center;font-size:12px;line-height:1.5}.fi-list-item{background:#fff;border:1px solid var(--line);border-radius:11px;margin-bottom:7px;overflow:hidden}.fi-item-main{width:100%;border:0;background:transparent;text-align:left;display:flex;gap:9px;padding:10px;cursor:pointer;color:var(--ink)}.fi-item-main:hover{background:#faf8f2}.fi-item-icon{flex:0 0 28px;height:28px;border-radius:8px;display:grid;place-items:center;font-weight:900}.color-yellow{background:${COLOR_MAP.yellow.solid};color:${COLOR_MAP.yellow.ink}}.color-pink{background:${COLOR_MAP.pink.solid};color:${COLOR_MAP.pink.ink}}.color-blue{background:${COLOR_MAP.blue.solid};color:${COLOR_MAP.blue.ink}}.color-green{background:${COLOR_MAP.green.solid};color:${COLOR_MAP.green.ink}}.color-orange{background:${COLOR_MAP.orange.solid};color:${COLOR_MAP.orange.ink}}.fi-item-copy{min-width:0;display:flex;flex-direction:column}.fi-item-copy b{font-size:12px}.fi-item-copy small{font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:2px 0}.fi-item-copy em{font-size:11px;color:#4c5660;font-style:normal;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fi-item-actions{display:flex;justify-content:flex-end;gap:4px;padding:5px 8px;border-top:1px solid #ece8df}.fi-item-actions button{border:0;background:transparent;color:#53616d;font-size:10px;cursor:pointer}.fi-item-actions button:last-child{color:#a42c18}.fi-popover{position:absolute;right:8px;bottom:51px;width:270px;background:#fff;border:1px solid #bcb7aa;border-radius:13px;box-shadow:0 12px 30px #0004;padding:7px;z-index:5}.side-left .fi-popover{left:8px;right:auto}.fi-popover-title{font-size:10px;font-weight:850;text-transform:uppercase;letter-spacing:.08em;padding:7px;color:var(--muted)}.fi-export-scope{display:flex;flex-direction:column;gap:4px;padding:4px 7px 8px;border-bottom:1px solid var(--line);margin-bottom:4px}.fi-popover button{width:100%;border:0;background:transparent;border-radius:8px;text-align:left;padding:8px 9px;cursor:pointer;color:var(--ink);display:flex;flex-direction:column}.fi-popover button:hover{background:#f1eee6}.fi-popover button b{font-size:11px}.fi-popover button small{font-size:9px;color:var(--muted);margin-top:2px}.fi-popover button.danger b{color:#a42c18}.fi-footer{height:29px;padding:0 13px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--line);color:var(--muted);font-size:9px;border-radius:0 0 17px 17px}.fi-toast{position:absolute;right:20px;bottom:148px;background:#17202a;color:#fff;padding:9px 13px;border-radius:9px;font-size:11px;box-shadow:0 8px 24px #0004;opacity:0;transform:translateY(8px);transition:.18s;pointer-events:none}.side-left .fi-toast{left:20px;right:auto}.fi-toast.show{opacity:1;transform:none}.fi-visual{position:fixed;pointer-events:none}.fi-highlight{border-radius:2px;mix-blend-mode:multiply}.fi-page-label,.fi-arrow-label,.fi-margin-note{pointer-events:auto;cursor:pointer;border:0;font-family:Inter,ui-sans-serif,system-ui,sans-serif}.fi-page-label{transform:translate(-8px,-50%);padding:5px 9px;border-radius:6px;font-size:11px;font-weight:800;box-shadow:0 3px 9px #0004;white-space:nowrap}.fi-page-label:before{content:"";position:absolute;left:5px;top:100%;border:5px solid transparent;border-top-color:inherit}.fi-arrow-label{transform:translate(-50%,-50%);background:#fff;color:#17202a;border:2px solid;padding:4px 8px;border-radius:999px;font-size:10px;font-weight:800;box-shadow:0 2px 8px #0003;white-space:nowrap}.fi-arrow-line{stroke-width:4;stroke-linecap:round;filter:drop-shadow(0 1px 1px #fff) drop-shadow(0 2px 2px #0005)}.fi-draft-line{stroke-dasharray:8 6;opacity:.8}.fi-note-leader{stroke-width:2;stroke-dasharray:3 3;opacity:.85}.fi-margin-note{width:320px;min-height:84px;background:#fffdf8;color:#17202a;border:1px solid #aaa398;border-radius:11px;text-align:left;padding:11px 12px 10px 17px;box-shadow:0 8px 24px #0004;display:flex;flex-direction:column}.fi-note-bar{position:absolute;left:0;top:0;bottom:0;width:7px;border-radius:10px 0 0 10px}.fi-margin-note b{font-size:12px}.fi-margin-note small{font-size:9px;color:#707b86;text-transform:uppercase;letter-spacing:.05em;margin:2px 0 5px}.fi-margin-note em{font-size:11px;line-height:1.35;font-style:normal;color:#3f4a54}.flash{animation:flash 1.4s ease}.flash-stroke{animation:flashStroke 1.4s ease}.fi-modal-layer{position:fixed;inset:0;pointer-events:auto;display:grid;place-items:center}.fi-modal-backdrop{position:absolute;inset:0;background:#10182080;backdrop-filter:blur(2px)}.fi-editor{position:relative;width:min(570px,calc(100vw - 34px));max-height:calc(100vh - 34px);overflow:auto;background:#f8f6f0;color:var(--ink);border:1px solid #aaa398;border-radius:17px;box-shadow:0 24px 70px #0007}.fi-editor>header{position:sticky;top:0;z-index:1;background:#17202a;color:#fff;display:flex;justify-content:space-between;align-items:center;padding:14px 17px;border-radius:16px 16px 0 0}.fi-editor>header div{display:flex;flex-direction:column}.fi-editor>header span{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#a9bac7}.fi-editor>header b{font:800 19px/1.2 Georgia,serif}.fi-editor>header button{border:0;background:transparent;color:#fff;font-size:22px;cursor:pointer}.fi-editor label{display:flex;flex-direction:column;gap:5px;margin:14px 17px;font-size:10px;font-weight:850;text-transform:uppercase;letter-spacing:.06em;color:#5e6974}.fi-editor input,.fi-editor textarea,.fi-editor select{width:100%;border:1px solid #c9c4b9;background:#fff;color:#17202a;border-radius:9px;padding:10px 11px;font-size:13px;text-transform:none;letter-spacing:0;font-weight:500}.fi-editor textarea{resize:vertical;line-height:1.45}.fi-form-grid{display:grid;grid-template-columns:1fr 1fr}.fi-quote{margin:15px 17px 0;background:#fff8cf;border-left:5px solid ${COLOR_MAP.yellow.solid};padding:11px 13px}.fi-quote span{font-size:9px;font-weight:850;text-transform:uppercase;color:#756a38}.fi-quote blockquote{margin:5px 0 0;font:italic 13px/1.45 Georgia,serif}.fi-editor>footer{position:sticky;bottom:0;background:#ebe8df;border-top:1px solid #d0cbc0;padding:11px 17px;display:flex;justify-content:space-between;align-items:center}.fi-editor>footer>div{display:flex;gap:8px}.fi-editor>footer button{border:1px solid #aaa398;border-radius:9px;padding:9px 13px;cursor:pointer;font-size:11px;font-weight:800}.fi-editor .ghost{background:#fff}.fi-editor .save{background:var(--accent2);border-color:var(--accent2);color:#fff}.fi-editor .danger{color:#a42c18}.fi-collection-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;padding:16px 17px}.fi-collection-summary div{background:var(--paper);border:1px solid var(--line);border-radius:11px;padding:12px;text-align:center}.fi-collection-summary b{display:block;font-size:22px}.fi-collection-summary span{font-size:9px;text-transform:uppercase;color:var(--muted)}.fi-collection-description{margin:0 17px 12px;color:var(--muted)}.fi-collection-pages{padding:0 17px 18px;max-height:48vh;overflow:auto}.fi-collection-page{display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:10px;margin:7px 0}.fi-collection-page div{min-width:0}.fi-collection-page b,.fi-collection-page small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fi-collection-page small{color:var(--muted);font-size:10px;margin-top:3px}.fi-collection-page button{border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--ink);padding:6px 9px;cursor:pointer}@keyframes pulse{50%{opacity:.35}}@keyframes flash{0%,100%{filter:none}30%{filter:drop-shadow(0 0 8px #fff) drop-shadow(0 0 13px #e43);transform:scale(1.05)}}@keyframes flashStroke{30%{stroke-width:8;filter:drop-shadow(0 0 8px #fff) drop-shadow(0 0 12px #e43)}}
      @media(max-width:620px){.fi-dock{left:10px!important;right:10px!important;width:auto;bottom:76px}.fi-tools{grid-template-columns:repeat(2,1fr)}.fi-tool{min-height:62px}.fi-margin-note{width:min(280px,calc(100vw - 30px))}.fi-form-grid{grid-template-columns:1fr}}
      @media(prefers-color-scheme:dark){:host{--ink:#edf1f4;--muted:#aeb7c0;--panel:#20262c;--paper:#2a3239;--line:#46515b}.fi-snapshot-btn.captured{background:#173b29}.fi-dock{border-color:#56616a}.fi-version-row,.fi-modebar,.fi-footer{background:#232b31}.fi-modebar{background:#2b343b}.fi-tool.primary{background:#554b18}.fi-panel{background:#1e252a}.fi-list-item,.fi-filter,.fi-editor input,.fi-editor textarea,.fi-editor select{background:#2a3239;color:#edf1f4}.fi-item-main:hover,.fi-popover button:hover{background:#303941}.fi-item-copy em{color:#c5ccd2}.fi-item-actions{border-color:#414b54}.fi-popover{background:#252d34;border-color:#56616a}.fi-editor{background:#20272d;border-color:#56616a}.fi-editor label{color:#b7c0c8}.fi-quote{background:#4a4118}.fi-editor>footer{background:#293138;border-color:#46515b}.fi-editor .ghost{background:#303940;color:#edf1f4}.fi-margin-note{background:#252d34;color:#edf1f4;border-color:#6d7881}.fi-margin-note em{color:#d5dbe0}.fi-arrow-label{background:#252d34;color:#fff}}
    `;
  }
})();
