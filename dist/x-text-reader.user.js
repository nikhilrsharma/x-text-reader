// ==UserScript==
// @name         X / Twitter — Text-Only Mode + Speed
// @namespace    yoddha.x-text-only
// @version      6.1.1
// @license      MIT
// @homepageURL  https://github.com/nikhilrsharma/x-text-reader
// @supportURL   https://github.com/nikhilrsharma/x-text-reader/issues
// @description  Full-width text-first X (Twitter) with a thread reader, long-post expansion, local reading settings, and optional media. No external services.
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://mobile.twitter.com/*
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

(() => {
  'use strict';
  // Replace the old script; do not run v5 and v6 together.
  // Reading preferences are saved locally. Media choices last until reload.
  const CONFIG = Object.freeze({
    pageWidth: 0, // 0 fills the available window; a positive number sets a pixel cap.
    navigationWidth: 72,
    mediaMaxHeight: 360,
    compactLists: true,
    hideListCover: true,
    hideSidebar: true,
    hideFloatingGrok: true,
    hideFloatingChat: true,
    reduceMotion: true,
    preventAutoplay: true,
    maxRememberedPosts: 1500,
  });
  if (document.getElementById('xt6-style')) return;
  const ARTICLE = 'article[data-testid="tweet"]';
  const COLUMN = '[data-testid="primaryColumn"]';
  const MEDIA = '[data-testid="tweetPhoto"], [data-testid="videoComponent"], [data-testid="videoPlayer"], [data-testid="article-cover-image"], [data-testid="card.wrapper"], [data-testid="birdwatch-pivot"] img, video';
  const QUOTE = 'div[role="link"], [data-testid="quoteTweet"], [data-testid="card.wrapper"]';
  const states = new WeakMap();
  const choices = new Map();
  const ownClasses = new WeakMap();
  const dirty = new Set();
  const pathNodes = new Set();
  const feedPaths = new WeakSet();
  let mainNode = null;
  let column = null, frame = 0, shellDirty = true, headerDirty = true;
  let sequence = 0, route = location.pathname, sleeping = false;
  let feedObserver, shellObserver;

  function mark(el, name, on = true) {
    if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
    ownClasses.set(el, el.getAttribute('class'));
  }
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }
  function attr(el, key, value) { if (el.getAttribute(key) !== value) el.setAttribute(key, value); }
  function makeButton(action) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'xt6-button'; b.dataset.xt6Action = action;
    return b;
  }
  function remember(key, value) {
    choices.delete(key); choices.set(key, value);
    if (choices.size > CONFIG.maxRememberedPosts) choices.delete(choices.keys().next().value);
  }
  function belongs(el, article) { return el.closest(ARTICLE) === article; }
  function outsideQuote(el, article) {
    const q = el.closest(QUOTE);
    return belongs(el, article) && (!q || !article.contains(q));
  }
  function postID(href) {
    try {
      const u = new URL(href, location.href);
      if (!['x.com', 'twitter.com', 'mobile.twitter.com'].includes(u.hostname)) return null;
      return u.pathname.match(/^\/(?:[^/]+\/status|i\/web\/status)\/(\d+)(?:\/|$)/)?.[1] || null;
    } catch { return null; }
  }
  function identity(article, previous) {
    // Never use the page URL for replies, nor a quoted post's timestamp.
    const anchors = [...article.querySelectorAll('a[href*="/status/"]')].filter(a =>
      outsideQuote(a, article) && !a.closest('[data-testid="tweetText"], .xt6-ui'));
    const anchor = anchors.find(a => a.querySelector('time')) ||
      anchors.find(a => /\/analytics(?:\?|$)/.test(a.getAttribute('href'))) ||
      anchors.find(a => /\/status\/\d+\/?$/.test(a.getAttribute('href')));
    const id = anchor && postID(anchor.href);
    if (id) return { key: `id:${id}`, href: new URL(anchor.href).origin + new URL(anchor.href).pathname.replace(/(\/status\/\d+).*$/, '$1') };
    // Unknown posts get per-element keys, never a truncated text fingerprint.
    const signature = [...article.querySelectorAll('[data-testid="User-Name"], [data-testid="tweetText"]')]
      .filter(e => outsideQuote(e, article)).map(e => e.textContent).join('|');
    const key = previous?.key.startsWith('tmp:') && previous.signature === signature
      ? previous.key : `tmp:${++sequence}`;
    return { key, signature, href: null };
  }

  function mediaShell(media, article) {
    let root = media;
    for (let depth = 0; depth < 5; depth++) {
      const p = root.parentElement;
      if (!p || p === article || !belongs(p, article) ||
          !p.matches('div, a') || p.matches('[data-testid], [role="link"]:not(a), [role="group"]') ||
          p.querySelector('[data-testid="tweetText"], [data-testid="User-Name"], time, .xt6-ui')) break;
      if (p.tagName === 'A' && !/\/status\/\d+\/(photo|video)\/\d+/.test(p.getAttribute('href') || '')) break;
      // X reserves photo space in a sibling padding spacer and a fixed-size box.
      // Only absorb empty, media-only shells; never an arbitrary labelled group.
      const otherChildren = [...p.children].filter(e => e !== root);
      if (otherChildren.some(e => e.childElementCount || e.textContent.trim() ||
          !e.matches('div[style]') || !/padding-(?:bottom|top)\s*:\s*[\d.]+%/.test(e.getAttribute('style')))) break;
      if ([...p.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) break;
      root = p;
    }
    return root;
  }
  function mediaOnlyCarousel(nav) {
    if (nav.querySelector('[data-testid="tweetText"], [data-testid="User-Name"], [data-testid="quoteTweet"], time, .xt6-ui')) return false;
    // Ignore player UI and native carousel arrows, but preserve any other prose.
    // Video durations can sit outside the preview node, even before a player loads.
    const walker = document.createTreeWalker(nav, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === 1 && node.matches(`${MEDIA}, [data-testid="ScrollSnap-prevButtonWrapper"], [data-testid="ScrollSnap-nextButtonWrapper"]`)) return NodeFilter.FILTER_REJECT;
        return node.nodeType === 3 && node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    for (let text; (text = walker.nextNode());) {
      if (!/^(?:\d{1,3}:[0-5]\d(?::[0-5]\d)?\s*)+$/.test(text.textContent.trim())) return false;
    }
    return true;
  }
  function mediaRoots(article) {
    const candidates = [...article.querySelectorAll(MEDIA)].filter(e => belongs(e, article));
    // Photo, video, and mixed carousels share a padding-sized outer box.
    // Collapse that whole media-only shell, including video-duration labels.
    for (const carousel of article.querySelectorAll('[data-testid="ScrollSnap-SwipeableList"]')) {
      const nav = carousel.closest('nav');
      if (nav && belongs(nav, article) && article.contains(nav) &&
          candidates.some(e => carousel.contains(e)) && mediaOnlyCarousel(nav)) candidates.push(nav);
    }
    // Exact media containers only. A surrounding aria-labelledby group may also
    // contain text, a quoted post, or the reveal button and must never be hidden.
    const containers = [...new Set(candidates.filter(e => !candidates.some(other => other !== e && other.contains(e)))
      .map(e => mediaShell(e, article)))];
    return containers.filter(e => !containers.some(other => other !== e && other.contains(e)));
  }
  function mediaLabel(roots) {
    const has = selector => roots.some(e => e.matches(selector) || e.querySelector(selector));
    const video = has('video, [data-testid="videoComponent"], [data-testid="videoPlayer"], [aria-label="Play this video"]');
    const photoSelector = '[data-testid="tweetPhoto"], [data-testid="article-cover-image"]';
    // A single carousel root may contain both photos and video previews.
    const photo = roots.some(root => [ ...(root.matches(photoSelector) ? [root] : []), ...root.querySelectorAll(photoSelector) ]
      .some(e => !e.closest('[data-testid="videoComponent"], [data-testid="videoPlayer"]') &&
        !e.querySelector('video, [data-testid="videoComponent"], [data-testid="videoPlayer"], [aria-label="Play this video"]')));
    const card = has('[data-testid="card.wrapper"]');
    if (card && (video || photo)) return 'media & previews';
    if (video && photo) return 'media';
    if (video) return 'video';
    if (photo) return 'photos';
    return card ? 'link preview' : 'media';
  }
  function harden(article) {
    for (const a of article.querySelectorAll('a[href]')) {
      if (!belongs(a, article)) continue;
      try {
        if (new URL(a.href).hostname !== 't.co') continue;
        // Preserve X's other rel values rather than overwriting them.
        if (!a.relList.contains('noopener')) a.relList.add('noopener');
        if (!a.relList.contains('noreferrer')) a.relList.add('noreferrer');
        attr(a, 'target', '_blank');
      } catch { /* Incomplete links can arrive while X is rendering. */ }
    }
  }
  function pause(video) { if (!video.paused) { try { video.pause(); } catch { /* Detached player. */ } } }
  function videosFor(article, shown) {
    for (const v of article.querySelectorAll('video')) {
      if (!belongs(v, article)) continue;
      if (CONFIG.preventAutoplay) { v.autoplay = false; v.removeAttribute('autoplay'); }
      if (!shown) pause(v);
    }
  }
  function syncArticle(article) {
    if (!article.isConnected || !article.matches(ARTICLE)) return;
    loosenFeedPath(article);
    let state = states.get(article);
    const next = identity(article, state);
    if (!state) state = { roots: [], controls: null, playAllowed: false };
    if (state.key !== next.key) {
      // Promote a temporary identity when the same element gets its real permalink.
      if (state.key?.startsWith('tmp:') && next.key.startsWith('id:') && choices.has(state.key)) {
        remember(next.key, choices.get(state.key)); choices.delete(state.key);
      }
      state.playAllowed = false;
    }
    Object.assign(state, next);
    states.set(article, state);
    const choice = choices.get(state.key) || { shown: false, full: false };
    const roots = mediaRoots(article);
    for (const old of state.roots) {
      if (!roots.includes(old)) for (const c of ['xt6-media', 'xt6-hidden', 'xt6-full']) mark(old, c, false);
    }
    state.roots = roots;
    mark(article, 'xt6-article');
    attr(article, 'data-xt6-key', state.key);
    for (const root of roots) {
      mark(root, 'xt6-media'); mark(root, 'xt6-hidden', !choice.shown); mark(root, 'xt6-full', choice.full);
    }
    harden(article);
    videosFor(article, choice.shown);
    if (!roots.length) { state.controls?.remove(); state.controls = null; syncReadingArticle(article); return; }

    if (!state.controls?.isConnected || !article.contains(state.controls)) {
      const controls = document.createElement('div');
      controls.className = 'xt6-controls xt6-ui';
      controls.append(makeButton('media'), makeButton('size'));
      const link = document.createElement('a');
      link.className = 'xt6-open'; link.textContent = 'Open post';
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      controls.append(link);
      controls.addEventListener('click', e => {
        e.stopPropagation();
        const button = e.target.closest('button[data-xt6-action]');
        if (!button) return;
        e.preventDefault();
        // Resolve identity again if X recycled this article immediately before a click.
        syncArticle(article);
        const current = states.get(article);
        const value = { ...(choices.get(current.key) || { shown: false, full: false }) };
        if (button.dataset.xt6Action === 'media') {
          value.shown = !value.shown;
          current.playAllowed = false;
        } else value.full = !value.full;
        remember(current.key, value);
        // Update all on-screen copies of this same post, including replies.
        for (const a of column.querySelectorAll(ARTICLE)) {
          if (a === article || states.get(a)?.key === current.key) syncArticle(a);
        }
      });
      state.controls = controls;
    }
    const controls = state.controls;
    const text = [...article.querySelectorAll('[data-testid="tweetText"]')]
      .find(e => outsideQuote(e, article) && !e.closest('.xt6-media'));
    if (text) { if (text.nextElementSibling !== controls) text.after(controls); }
    else if (controls.parentElement !== article) article.append(controls);
    const [reveal, size] = controls.querySelectorAll('button');
    setText(reveal, `${choice.shown ? 'Hide' : 'Show'} ${mediaLabel(roots)}`);
    attr(reveal, 'aria-expanded', String(choice.shown));
    setText(size, choice.full ? 'Compact media' : 'Full-size media');
    attr(size, 'aria-pressed', String(choice.full)); size.hidden = !choice.shown;
    const link = controls.querySelector('a');
    link.hidden = !choice.shown || !state.href;
    if (state.href) attr(link, 'href', state.href);
    syncReadingArticle(article);
  }

    // Reading preferences are local to this browser. No post content is saved.
  const READING_SETTINGS_KEY = 'xt6-reading-settings-v1';
  const READING_DEFAULTS = Object.freeze({
    fontSize: 0,
    lineHeight: 0,
    postSpacing: 'default',
    mediaHeight: 360,
    autoExpand: false,
  });
  function normalizeReadingSettings(input) {
    const value = input && typeof input === 'object' ? input : {};
    return {
      fontSize: Number.isInteger(value.fontSize) && value.fontSize >= 14 && value.fontSize <= 24 ? value.fontSize : 0,
      lineHeight: typeof value.lineHeight === 'number' && value.lineHeight >= 1.2 && value.lineHeight <= 1.9 ? Math.round(value.lineHeight * 10) / 10 : 0,
      postSpacing: ['compact', 'comfortable'].includes(value.postSpacing) ? value.postSpacing : 'default',
      mediaHeight: typeof value.mediaHeight === 'number' && Number.isFinite(value.mediaHeight) && value.mediaHeight >= 240 && value.mediaHeight <= 640 ? Math.round(value.mediaHeight / 20) * 20 : READING_DEFAULTS.mediaHeight,
      autoExpand: value.autoExpand === true,
    };
  }
  function loadReadingSettings() {
    try { return normalizeReadingSettings(JSON.parse(localStorage.getItem(READING_SETTINGS_KEY))); }
    catch { return { ...READING_DEFAULTS }; }
  }
  const readingSettings = loadReadingSettings();
  let readingSettingsRoot = null, readingSettingsDialog = null, readingSettingsStyle = null;
  let readingSettingsStatus = null, readingSettingsRestoreFocus = null;
  const readingSettingsInputs = new Map();
  let readingSettingsStarted = false;

  function applyReadingSettings(notify = false) {
    if (!readingSettingsStyle) {
      readingSettingsStyle = document.createElement('style');
      readingSettingsStyle.id = 'xt6-reading-preferences';
      readingSettingsStyle.className = 'xt6-ui';
    }
    const textSelector = 'article[data-testid="tweet"] [data-testid="tweetText"], .xt6-reader-text';
    const textRules = [
      readingSettings.fontSize ? `font-size:${readingSettings.fontSize}px !important;` : '',
      readingSettings.lineHeight ? `line-height:${readingSettings.lineHeight} !important;` : '',
    ].join('');
    const spacing = readingSettings.postSpacing === 'compact' ? 6 : 16;
    const rules = `:root { --xt6-media-height:${readingSettings.mediaHeight}px !important; }
      ${textRules ? `${textSelector} { ${textRules} }` : ''}
      ${readingSettings.postSpacing !== 'default' ? `article[data-testid="tweet"] { padding-top:${spacing}px !important; padding-bottom:${spacing}px !important; }` : ''}`;
    if (readingSettingsStyle.textContent !== rules) readingSettingsStyle.textContent = rules;
    if (!readingSettingsStyle.isConnected) (document.head || document.documentElement).append(readingSettingsStyle);
    if (notify) document.dispatchEvent(new CustomEvent('xt6-settings-changed', { detail: { ...readingSettings } }));
  }
  function saveReadingSettings() {
    let saved = true;
    try { localStorage.setItem(READING_SETTINGS_KEY, JSON.stringify(readingSettings)); }
    catch { saved = false; }
    if (readingSettingsStatus) readingSettingsStatus.textContent = saved
      ? 'Saved on this browser. Changes apply immediately.'
      : 'Changes apply to this page. Your browser could not save them.';
    applyReadingSettings(true);
  }
  function fillReadingSettings() {
    for (const [key, input] of readingSettingsInputs) {
      if (input.type === 'checkbox') input.checked = readingSettings[key];
      else input.value = String(readingSettings[key]);
    }
    const output = readingSettingsDialog?.querySelector('[data-reading-media-value]');
    if (output) output.textContent = `${readingSettings.mediaHeight} px`;
  }
  function openReadingSettings() {
    initReadingSettings();
    if (!readingSettingsDialog || readingSettingsDialog.open) return;
    readingSettingsRestoreFocus = document.activeElement;
    fillReadingSettings();
    const bodyStyle = getComputedStyle(document.body);
    const dark = bodyStyle.backgroundColor === 'rgb(0, 0, 0)' || bodyStyle.backgroundColor === 'rgb(21, 32, 43)' ||
      (bodyStyle.backgroundColor === 'rgba(0, 0, 0, 0)' && matchMedia('(prefers-color-scheme: dark)').matches);
    readingSettingsDialog.dataset.theme = dark ? 'dark' : 'light';
    readingSettingsDialog.showModal();
  }
  function syncReadingSettings() {
    if (!readingSettingsRoot || !document.body) return;
    if (!readingSettingsRoot.isConnected) document.body.append(readingSettingsRoot);
    if (readingSettingsStyle && !readingSettingsStyle.isConnected) (document.head || document.documentElement).append(readingSettingsStyle);
  }
  function initReadingSettings() {
    if (!document.body) return;
    if (readingSettingsStarted) { syncReadingSettings(); return; }
    readingSettingsStarted = true;
    applyReadingSettings();
    const root = document.createElement('div');
    root.id = 'xt6-reading-settings'; root.className = 'xt6-ui';
    readingSettingsRoot = root;
    const css = document.createElement('style');
    css.className = 'xt6-ui';
    css.textContent = `
      #xt6-reading-settings { font:14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
      #xt6-settings-launcher { position:fixed; right:14px; bottom:14px; z-index:900; width:42px; height:38px; padding:0; border:1px solid #71767b; border-radius:12px; background:#101820; color:#e7e9ea; font:600 16px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; cursor:pointer; box-shadow:0 2px 8px #0003; }
      #xt6-settings-launcher:hover { background:#1b2935; }
      #xt6-reading-settings button:focus-visible, #xt6-reading-settings select:focus-visible, #xt6-reading-settings input:focus-visible { outline:2px solid #1d9bf0; outline-offset:3px; }
      #xt6-settings-dialog { width:min(420px,calc(100vw - 32px)); max-width:none; max-height:calc(100dvh - 40px); box-sizing:border-box; padding:22px; border:1px solid #bec5ca; border-radius:16px; background:#fff; color:#0f1419; box-shadow:0 12px 60px #0005; overflow:auto; }
      #xt6-settings-dialog[data-theme="dark"] { color-scheme:dark; background:#15202b; color:#e7e9ea; border-color:#536471; }
      #xt6-settings-dialog::backdrop { background:rgb(0 0 0 / .55); }
      #xt6-settings-dialog .xt6-settings-heading { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:6px; }
      #xt6-settings-title { margin:0; font-size:20px; line-height:1.3; font-weight:700; }
      #xt6-settings-dialog p { margin:0 0 18px; font-size:13px; line-height:1.5; }
      #xt6-settings-dialog .xt6-settings-row { display:grid; grid-template-columns:1fr 160px; align-items:center; gap:14px; margin:16px 0; }
      #xt6-settings-dialog label { font:inherit; }
      #xt6-settings-dialog select { width:100%; min-height:34px; border:1px solid #71767b; border-radius:7px; padding:4px 7px; background:transparent; color:inherit; font:inherit; }
      #xt6-settings-dialog option { background:Canvas; color:CanvasText; }
      #xt6-settings-dialog input[type="range"] { width:100%; accent-color:#1d9bf0; }
      #xt6-settings-dialog output { display:block; font-size:12px; text-align:right; }
      #xt6-settings-dialog .xt6-settings-check { display:flex; align-items:flex-start; gap:9px; margin:20px 0 8px; }
      #xt6-settings-dialog input[type="checkbox"] { width:17px; height:17px; margin:2px 0 0; accent-color:#1d9bf0; flex:none; }
      #xt6-settings-dialog .xt6-settings-note { margin:4px 0 18px 26px; font-size:12px; opacity:.8; }
      #xt6-settings-dialog .xt6-settings-footer { display:flex; justify-content:space-between; gap:12px; margin-top:22px; }
      #xt6-settings-dialog button { border:1px solid #71767b; border-radius:16px; padding:6px 12px; background:transparent; color:inherit; font:inherit; cursor:pointer; }
      #xt6-settings-dialog button:hover { background:#1d9bf01a; }
      #xt6-settings-dialog button[data-settings-close] { padding:4px 9px; }
      #xt6-settings-dialog .xt6-settings-done { border-color:#1d9bf0; background:#1d9bf0; color:white; font-weight:600; }
      #xt6-settings-status { min-height:18px; margin:14px 0 0 !important; font-size:12px !important; opacity:.8; }
      @media(max-width:499px) { #xt6-settings-launcher { bottom:calc(66px + env(safe-area-inset-bottom)); right:10px; } }
      @media(max-width:360px) { #xt6-settings-dialog .xt6-settings-row { grid-template-columns:1fr; gap:5px; } }
      @media print { #xt6-reading-settings { display:none !important; } }
    `;
    const launcher = document.createElement('button');
    launcher.id = 'xt6-settings-launcher'; launcher.type = 'button'; launcher.textContent = 'Aa';
    launcher.title = 'Reading settings'; launcher.setAttribute('aria-label', 'Reading settings');
    launcher.setAttribute('aria-haspopup', 'dialog'); launcher.addEventListener('click', openReadingSettings);
    const dialog = document.createElement('dialog');
    dialog.id = 'xt6-settings-dialog'; dialog.className = 'xt6-ui';
    dialog.setAttribute('aria-labelledby', 'xt6-settings-title');
    dialog.setAttribute('aria-describedby', 'xt6-settings-description');
    readingSettingsDialog = dialog;
    dialog.innerHTML = `<div class="xt6-settings-heading"><h2 id="xt6-settings-title">Reading settings</h2><button type="button" data-settings-close aria-label="Close reading settings">Close</button></div>
      <p id="xt6-settings-description">Make posts easier to read. Your full-width layout stays on.</p>`;
    function selectRow(key, label, options) {
      const row = document.createElement('div'); row.className = 'xt6-settings-row';
      const caption = document.createElement('label'); caption.htmlFor = `xt6-setting-${key}`; caption.textContent = label;
      const select = document.createElement('select'); select.id = caption.htmlFor;
      for (const [value, text] of options) { const option = document.createElement('option'); option.value = String(value); option.textContent = text; select.append(option); }
      select.addEventListener('change', () => {
        readingSettings[key] = key === 'postSpacing' ? select.value : Number(select.value);
        saveReadingSettings();
      });
      readingSettingsInputs.set(key, select); row.append(caption, select); dialog.append(row);
    }
    selectRow('fontSize', 'Text size', [[0, 'Use X default'], ...Array.from({ length:11 }, (_, i) => [14+i, `${14+i} px`])]);
    selectRow('lineHeight', 'Line spacing', [[0, 'Use X default'], ...Array.from({ length:8 }, (_, i) => [(12+i)/10, `${((12+i)/10).toFixed(1)} ×`])]);
    selectRow('postSpacing', 'Post spacing', [['default', 'Use X default'], ['compact', 'Compact'], ['comfortable', 'Comfortable']]);
    const mediaRow = document.createElement('div'); mediaRow.className = 'xt6-settings-row';
    const mediaLabel = document.createElement('label'); mediaLabel.htmlFor = 'xt6-setting-mediaHeight'; mediaLabel.textContent = 'Media height';
    const mediaControl = document.createElement('div');
    const range = document.createElement('input'); range.type = 'range'; range.id = mediaLabel.htmlFor; range.min = '240'; range.max = '640'; range.step = '20';
    const mediaValue = document.createElement('output'); mediaValue.dataset.readingMediaValue = ''; mediaValue.htmlFor = range.id;
    range.setAttribute('aria-describedby', 'xt6-setting-mediaHeight-help');
    mediaValue.id = 'xt6-setting-mediaHeight-help';
    range.addEventListener('input', () => { readingSettings.mediaHeight = Number(range.value); mediaValue.textContent = `${range.value} px`; saveReadingSettings(); });
    readingSettingsInputs.set('mediaHeight', range); mediaControl.append(range, mediaValue); mediaRow.append(mediaLabel, mediaControl); dialog.append(mediaRow);
    const checkRow = document.createElement('label'); checkRow.className = 'xt6-settings-check';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.id = 'xt6-setting-autoExpand';
    const checkLabel = document.createElement('span'); checkLabel.textContent = 'Automatically expand long posts';
    checkbox.setAttribute('aria-describedby', 'xt6-auto-expand-help');
    checkbox.addEventListener('change', () => { readingSettings.autoExpand = checkbox.checked; saveReadingSettings(); });
    readingSettingsInputs.set('autoExpand', checkbox); checkRow.append(checkbox, checkLabel); dialog.append(checkRow);
    const note = document.createElement('p'); note.id = 'xt6-auto-expand-help'; note.className = 'xt6-settings-note';
    note.textContent = 'For loaded posts when their full text is available. Media stays hidden.'; dialog.append(note);
    const footer = document.createElement('div'); footer.className = 'xt6-settings-footer';
    const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = 'Reset defaults';
    reset.addEventListener('click', () => { Object.assign(readingSettings, READING_DEFAULTS); fillReadingSettings(); saveReadingSettings(); });
    const done = document.createElement('button'); done.type = 'button'; done.textContent = 'Done'; done.className = 'xt6-settings-done'; done.addEventListener('click', () => dialog.close());
    footer.append(reset, done); dialog.append(footer);
    const status = document.createElement('p'); status.id = 'xt6-settings-status'; status.setAttribute('role', 'status'); status.textContent = 'Preferences are saved only on this browser.';
    readingSettingsStatus = status; dialog.append(status);
    dialog.querySelector('[data-settings-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { if (readingSettingsRestoreFocus?.isConnected) readingSettingsRestoreFocus.focus({ preventScroll:true }); });
    root.append(css, launcher, dialog); document.body.append(root); fillReadingSettings();
    window.addEventListener('storage', event => {
      if (event.key !== READING_SETTINGS_KEY && event.key !== null) return;
      Object.assign(readingSettings, loadReadingSettings()); fillReadingSettings(); applyReadingSettings(true);
    });
  }

    // Reader data stays in this tab. Only post objects attached to rendered posts
  // are inspected; no global app store, request headers, or credentials are read.
  const readerData = (() => {
    const cache = new Map();
    let graphRevision = 0, threadRevision = -1;
    const threadIds = new Set();
    const LIMIT = 500;
    const POST_SELECTOR = 'article[data-testid="tweet"]';
    const QUOTE_SELECTOR = '[data-testid="quoteTweet"], div[role="link"], [data-testid="card.wrapper"]';
    const object = value => value && typeof value === 'object';
    const idString = value => typeof value === 'string' && /^\d+$/.test(value) ? value : null;
    const httpURL = value => {
      if (typeof value !== 'string') return null;
      try { const u = new URL(value); return /^(?:https?:)$/.test(u.protocol) ? u.href : null; } catch { return null; }
    };
    const decode = text => String(text || '').replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, value => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" })[value]);
    const permalink = (id, handle) => `https://x.com/${handle || 'i/web'}/status/${id}`;
    function statusID(href) {
      try {
        const url = new URL(href, location.href);
        if (!['x.com', 'twitter.com', 'mobile.twitter.com'].includes(url.hostname)) return null;
        return url.pathname.match(/^\/(?:[^/]+\/status|i\/web\/status)\/(\d+)(?:\/|$)/)?.[1] || null;
      } catch { return null; }
    }
    function unbox(value) {
      for (let depth = 0; object(value) && depth < 5; depth++) {
        if (object(value.retweeted_status)) value = value.retweeted_status;
        else if (object(value.retweeted_status_result?.result)) value = value.retweeted_status_result.result;
        else if (object(value.legacy?.retweeted_status_result?.result)) value = value.legacy.retweeted_status_result.result;
        else if (value.__typename === 'TweetWithVisibilityResults' && object(value.tweet)) value = value.tweet;
        else if (!value.legacy && !value.full_text && !value.text && object(value.result)) value = value.result;
        else return value;
      }
      return value;
    }
    function normalize(input, includeQuote = true) {
      const raw = unbox(input);
      if (!object(raw)) return null;
      const legacy = object(raw.legacy) ? raw.legacy : raw;
      const id = idString(raw.rest_id) || idString(raw.id_str) || idString(raw.id) || idString(legacy.id_str);
      const note = raw.note_tweet?.note_tweet_results?.result || raw.noteTweet?.noteTweetResults?.result || (typeof raw.note_tweet?.text === 'string' ? raw.note_tweet : null);
      const rawText = typeof note?.text === 'string' ? note.text : typeof legacy.full_text === 'string' ? legacy.full_text : legacy.text;
      if (!id || typeof rawText !== 'string') return null;
      const user = unbox(raw.core?.user_results?.result || raw.user_results?.result || raw.user || legacy.user);
      const userLegacy = user?.legacy || user || {};
      const userCore = user?.core || {};
      const authorId = idString(user?.rest_id) || idString(user?.id_str) || idString(user?.id) || idString(legacy.user_id_str);
      const rawHandle = userCore.screen_name || userLegacy.screen_name || raw.screen_name || '';
      const handle = /^[A-Za-z0-9_]{1,30}$/.test(rawHandle) ? rawHandle : '';
      if (!authorId && !handle) return null;
      const name = decode(userCore.name || userLegacy.name || handle);
      const entities = note?.entity_set || legacy.entities || {};
      const links = (entities.urls || []).map(link => ({ url: httpURL(link.url), expandedUrl: httpURL(link.expanded_url), displayUrl: link.display_url || '' })).filter(link => link.url);
      let text = decode(rawText);
      for (const link of links) if (link.expandedUrl) text = text.split(link.url).join(link.expandedUrl);
      const media = (legacy.extended_entities?.media || legacy.entities?.media || []).slice(0, 12).map(item => {
        const type = ['photo', 'video', 'animated_gif'].includes(item.type) ? item.type : 'photo';
        const variants = (item.video_info?.variants || []).filter(v => v.content_type === 'video/mp4' && httpURL(v.url)).sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));
        const reasonable = variants.filter(v => (v.bitrate || 0) <= 2200000);
        const video = (reasonable.length ? reasonable : variants).at(-1);
        return { type, url: type === 'photo' ? httpURL(item.media_url_https || item.media_url) : httpURL(video?.url), poster: httpURL(item.media_url_https || item.media_url), alt: item.ext_alt_text || '', width: item.original_info?.width || null, height: item.original_info?.height || null };
      }).filter(item => item.url || item.poster);
      const parentId = idString(legacy.in_reply_to_status_id_str) || idString(raw.in_reply_to_status_id_str);
      const parentAuthorId = idString(legacy.in_reply_to_user_id_str) || idString(raw.in_reply_to_user_id_str);
      const quoted = includeQuote ? normalize(raw.quoted_status_result?.result || raw.quoted_status || legacy.quoted_status, false) : null;
      return {
        id, authorId, handle, name, text, links, media, parentId, parentAuthorId,
        conversationId: idString(legacy.conversation_id_str) || idString(raw.conversation_id_str),
        href: permalink(id, handle), createdAt: legacy.created_at || '',
        fullText: typeof note?.text === 'string' || (!legacy.truncated && !raw.note_tweet && !raw.noteTweet),
        source: 'react', quote: quoted,
      };
    }
    function remember(post) {
      if (!post) return null;
      const old = cache.get(post.id);
      if (old) {
        // DOM text is often a preview. Never replace known full text with it.
        const preferOldText = (old.fullText && !post.fullText && old.source === 'react') || (old.source === 'react' && post.source === 'dom') || (old.fullText === post.fullText && old.text.length > post.text.length);
        const merged = { ...old, ...post };
        if (preferOldText) for (const key of ['text', 'links', 'media', 'fullText', 'quote']) merged[key] = old[key];
        if (post.source === 'dom' && old.source === 'react') for (const key of ['source', 'authorId', 'parentId', 'parentAuthorId', 'conversationId', 'createdAt']) merged[key] = old[key];
        post = merged;
      }
      if (!old || ['source', 'authorId', 'parentId', 'parentAuthorId'].some(key => old[key] !== post[key])) graphRevision++;
      cache.delete(post.id); cache.set(post.id, post);
      if (cache.size > LIMIT) { cache.delete(cache.keys().next().value); graphRevision++; }
      return post;
    }
    function ingest(raw) { return remember(normalize(raw)); }
    function get(id) { return cache.get(String(id)) || null; }
    function own(article, el) {
      const quote = el.closest(QUOTE_SELECTOR);
      return el.closest(POST_SELECTOR) === article && (!quote || !article.contains(quote));
    }
    function domText(node) {
      if (!node) return '';
      if (node.nodeType === 3) return node.textContent;
      if (node.nodeType !== 1) return '';
      if (node.tagName === 'BR') return '\n';
      if (node.tagName === 'IMG') return node.alt || '';
      return [...node.childNodes].map(domText).join('');
    }
    function fallback(article) {
      const anchors = [...article.querySelectorAll('a[href*="/status/"]')].filter(a => own(article, a) && !a.closest('[data-testid="tweetText"], .xt6-ui'));
      const a = anchors.find(a => a.querySelector('time')) || anchors.find(a => /\/analytics(?:\?|$)/.test(a.getAttribute('href'))) || anchors.find(a => /\/status\/\d+\/?$/.test(a.getAttribute('href')));
      const id = a && statusID(a.href);
      if (!id) return null;
      const textNode = [...article.querySelectorAll('[data-testid="tweetText"]')].find(el => own(article, el));
      const username = [...article.querySelectorAll('[data-testid="User-Name"]')].find(el => own(article, el));
      const profile = username?.querySelector('a[href]');
      let handle = '';
      try { handle = new URL(a.href).pathname.match(/^\/([^/]+)\/status\//)?.[1] || ''; } catch { /* incomplete link */ }
      if (handle === 'i' || !/^[A-Za-z0-9_]{1,30}$/.test(handle)) handle = '';
      const links = [...(textNode?.querySelectorAll('a[href]') || [])].map(link => ({ url: httpURL(link.href), expandedUrl: httpURL(link.getAttribute('title')) || httpURL(link.href), displayUrl: link.textContent })).filter(link => link.url);
      const more = [...article.querySelectorAll('[data-testid="tweet-text-show-more-link"], button, [role="button"]')].some(el => own(article, el) && !el.closest('.xt6-ui') && (el.matches('[data-testid="tweet-text-show-more-link"]') || /^show more$/i.test(el.textContent.trim())));
      return { id, authorId: null, handle, name: profile?.textContent || handle, text: domText(textNode), links, media: [], parentId: null, parentAuthorId: null, conversationId: null, href: permalink(id, handle), createdAt: a.querySelector('time')?.getAttribute('datetime') || '', fullText: !more, source: 'dom', quote: null };
    }
    const propKeys = ['tweet', 'post', 'status', 'retweeted_status', 'retweeted_status_result', 'tweetResult', 'tweet_results', 'result', 'item', 'itemContent', 'content', 'entry', 'data', 'props', 'children', 'items'];
    function findPost(roots, id) {
      const queue = roots.map(value => [value, 0]);
      const seen = new WeakSet();
      let best = null;
      for (let i = 0; i < queue.length && i < 500; i++) {
        const [value, depth] = queue[i];
        if (!object(value) || seen.has(value) || depth > 8) continue;
        seen.add(value);
        const post = normalize(value);
        if (post?.id === id) {
          if (!best || post.fullText || post.text.length > best.text.length) best = post;
          if (post.fullText) return post;
        }
        // React props may include functions and app state. Traverse only the
        // small set of post/element containers, never arbitrary property trees.
        if (Array.isArray(value)) {
          for (const item of value.slice(0, 40)) if (object(item)) queue.push([item, depth + 1]);
        } else for (const key of propKeys) {
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (descriptor && 'value' in descriptor && object(descriptor.value)) queue.push([descriptor.value, depth + 1]);
        }
      }
      return best;
    }
    function fromArticle(article) {
      if (!article?.matches?.(POST_SELECTOR)) return null;
      const dom = fallback(article);
      if (!dom) return null;
      const roots = [];
      const fibers = new Set();
      for (let node = article, level = 0; node && level < 5; node = node.parentElement, level++) {
        if (node.matches('body, main, [role="main"]')) break;
        for (const key of Object.keys(node)) {
          if (key.startsWith('__reactProps$')) roots.push(node[key]);
          if (key.startsWith('__reactFiber$')) {
            for (let f = node[key], depth = 0; f && depth < 24 && !fibers.has(f); f = f.return, depth++) {
              fibers.add(f);
              if (f.memoizedProps) roots.push(f.memoizedProps);
              if (f.pendingProps && f.pendingProps !== f.memoizedProps) roots.push(f.pendingProps);
            }
          }
        }
      }
      return remember(findPost(roots, dom.id) || dom);
    }
    function collect(scope = document) {
      const articles = scope.matches?.(POST_SELECTOR) ? [scope] : [...scope.querySelectorAll(POST_SELECTOR)];
      return articles.slice(0, 150).map(fromArticle).filter(Boolean);
    }
    const sameAuthor = (a, b) => a.authorId && b.authorId ? a.authorId === b.authorId : !!(a.handle && b.handle && a.handle.toLowerCase() === b.handle.toLowerCase());
    const chronological = (a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id);
    function isThread(id) {
      if (threadRevision !== graphRevision) {
        threadIds.clear();
        for (const post of cache.values()) {
          if (post.source !== 'react' || !post.authorId || !post.parentId || post.parentId === post.id) continue;
          const parent = get(post.parentId);
          const parentAuthor = parent?.source === 'react' ? parent.authorId : null;
          // Require an exact reply link and author identity. Text, reply counts,
          // and nearby posts alone cannot establish a thread.
          if (parentAuthor && parentAuthor !== post.authorId) continue;
          if (post.parentAuthorId ? post.parentAuthorId !== post.authorId : parentAuthor !== post.authorId) continue;
          threadIds.add(post.id); threadIds.add(post.parentId);
        }
        threadRevision = graphRevision;
      }
      return threadIds.has(String(id));
    }
    function chain(id) {
      const anchor = get(id);
      if (!anchor) return { posts: [], missingParentId: null, branches: [], verified: false, complete: false };
      const posts = [anchor], seen = new Set([anchor.id]);
      let missingParentId = null;
      let current = anchor;
      while (current.parentId && posts.length < LIMIT) {
        const parent = get(current.parentId);
        if (!parent) {
          if (!current.parentAuthorId || !current.authorId || current.parentAuthorId === current.authorId) missingParentId = current.parentId;
          break;
        }
        if (!sameAuthor(parent, anchor) || seen.has(parent.id)) break;
        posts.unshift(parent); seen.add(parent.id); current = parent;
      }
      current = anchor;
      const branches = [];
      while (posts.length < LIMIT) {
        const children = [...cache.values()].filter(post => post.parentId === current.id && sameAuthor(post, anchor) && !seen.has(post.id)).sort(chronological);
        if (children.length > 1) {
          // The author can branch a discussion. Do not silently splice two
          // different continuations into a single story.
          branches.push({ from: current.id, ids: children.map(post => post.id) });
          break;
        }
        if (!children.length) break;
        current = children[0]; posts.push(current); seen.add(current.id);
      }
      return { posts, missingParentId, branches, verified: posts.every(post => post.source === 'react' && !!post.authorId), complete: false };
    }
    return { collect, fromArticle, get, chain, isThread, normalize, ingest, revision: () => graphRevision, size: () => cache.size };
  })();
  function collectReaderPosts(scope = document) {
    const posts = readerData.collect(scope);
    queueReadingLabels();
    return posts;
  }

    const readingArticles = new WeakMap();
  let readingLabelsFrame = 0, readingGraphRevision = -1;
  function updateReadingButton(state) {
    const thread = readerData.isThread(state.id);
    setText(state.readButton, thread ? 'Read thread' : 'Read post');
    attr(state.readButton, 'title', thread
      ? 'Read connected posts in a new tab; your feed stays in place'
      : 'Read this post in a new tab; your feed stays in place');
    return thread ? 'thread' : 'post';
  }
  function queueReadingLabels() {
    if (readingLabelsFrame || readingGraphRevision === readerData.revision()) return;
    readingLabelsFrame = requestAnimationFrame(() => {
      readingLabelsFrame = 0; readingGraphRevision = readerData.revision();
      // A newly loaded reply can identify an earlier post as a thread starter.
      // Update existing buttons once per batch without rereading native data.
      for (const controls of (column || document).querySelectorAll('.xt6-reading-controls')) {
        const state = readingArticles.get(controls.closest(ARTICLE));
        if (state?.controls === controls) updateReadingButton(state);
      }
    });
  }
  let readerDialog = null, readerSession = null, readerBooted = false;
  const readerLaunch = new URLSearchParams(location.hash.slice(1)).get('xt6-reader');
  function readerElement(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function readerLink(href, text) {
    const link = readerElement('a', '', text);
    try {
      const url = new URL(href, location.href);
      if (!/^https?:$/.test(url.protocol)) return readerElement('span', '', text);
      link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    } catch { return readerElement('span', '', text); }
    return link;
  }
  function renderReaderText(target, post) {
    const fragment = document.createDocumentFragment();
    const text = post.text || '';
    // Text nodes only: post content is never interpreted as HTML.
    const tokens = /https?:\/\/[^\s<>]+|@[A-Za-z0-9_]{1,30}\b/g;
    let offset = 0;
    for (const match of text.matchAll(tokens)) {
      fragment.append(document.createTextNode(text.slice(offset, match.index)));
      let token = match[0], suffix = '';
      if (!token.startsWith('@')) {
        const trimmed = token.replace(/[.,!?;:)]+$/, '');
        suffix = token.slice(trimmed.length); token = trimmed;
      }
      fragment.append(readerLink(token.startsWith('@') ? `https://x.com/${token.slice(1)}` : token, token));
      if (suffix) fragment.append(document.createTextNode(suffix));
      offset = match.index + match[0].length;
    }
    fragment.append(document.createTextNode(text.slice(offset)));
    target.replaceChildren(fragment);
  }
  function nativeTextFor(article) {
    return [...article.querySelectorAll('[data-testid="tweetText"]')].find(el => outsideQuote(el, article) && !el.closest('.xt6-ui'));
  }
  function expandReadingArticle(article, state, expand) {
    const text = nativeTextFor(article);
    const post = readerData.get(state.id);
    if (!text || !post?.fullText) return;
    state.expanded = expand;
    if (expand) {
      if (!state.full?.isConnected) {
        state.full = readerElement('div', 'xt6-expanded-text xt6-reader-text xt6-ui');
        text.before(state.full);
      }
      if (state.full.dataset.content !== post.text) {
        renderReaderText(state.full, post); state.full.dataset.content = post.text;
      }
    } else { state.full?.remove(); state.full = null; }
    mark(text, 'xt6-native-text-hidden', expand);
    for (const more of article.querySelectorAll('[data-testid="tweet-text-show-more-link"]')) {
      if (outsideQuote(more, article)) mark(more, 'xt6-native-text-hidden', expand);
    }
    setText(state.expandButton, expand ? 'Collapse text' : 'Expand text');
    attr(state.expandButton, 'aria-expanded', String(expand));
  }
  function syncReadingArticle(article) {
    const post = readerData.fromArticle(article);
    if (!post) return;
    const text = nativeTextFor(article);
    let state = readingArticles.get(article);
    if (state && state.id !== post.id) {
      state.controls?.remove(); state.full?.remove();
      for (const more of article.querySelectorAll('.xt6-native-text-hidden')) mark(more, 'xt6-native-text-hidden', false);
      readingArticles.delete(article);
      state = null;
    }
    if (state && !text) { state.full?.remove(); state.full = null; state.expanded = false; }
    if (!state) {
      state = { id: post.id, expanded: false, manuallySet: false, controls: null, full: null };
      readingArticles.set(article, state);
    }
    if (!state.controls?.isConnected) {
      const controls = readerElement('div', 'xt6-reading-controls xt6-ui');
      const read = makeButton('thread');
      const expand = makeButton('expand-text'); expand.textContent = 'Expand text';
      controls.append(read, expand);
      controls.addEventListener('click', event => {
        event.stopPropagation(); event.preventDefault();
        const action = event.target.closest('button')?.dataset.xt6Action;
        const latest = readerData.fromArticle(article);
        if (!latest || latest.id !== state.id) { syncReadingArticle(article); return; }
        if (action === 'thread') {
          const mode = updateReadingButton(state);
          queueReadingLabels();
          window.open(`${latest.href}#xt6-reader=${mode}`, '_blank', 'noopener,noreferrer');
        } else if (action === 'expand-text') {
          state.manuallySet = true;
          if (latest.fullText) expandReadingArticle(article, state, !state.expanded);
          else window.open(`${latest.href}#xt6-reader=post`, '_blank', 'noopener,noreferrer');
        }
      });
      state.controls = controls; state.readButton = read; state.expandButton = expand;
    }
    updateReadingButton(state); queueReadingLabels();
    const mediaControls = states.get(article)?.controls;
    const anchor = mediaControls?.isConnected ? mediaControls : text;
    if (anchor) { if (anchor.nextElementSibling !== state.controls) anchor.after(state.controls); }
    else if (state.controls.parentElement !== article) article.append(state.controls);
    const nativeMore = [...article.querySelectorAll('[data-testid="tweet-text-show-more-link"]')].some(el => outsideQuote(el, article));
    const visiblyShorter = post.text.length > (text?.textContent?.length || 0) + 24;
    const isLong = !!text && (nativeMore || (post.fullText && visiblyShorter) || state.expanded);
    state.expandButton.hidden = !isLong;
    if (state.expanded && !state.manuallySet && !readingSettings.autoExpand) expandReadingArticle(article, state, false);
    if (state.expanded) expandReadingArticle(article, state, true);
    else if (readingSettings.autoExpand && !state.manuallySet && isLong && post.fullText) expandReadingArticle(article, state, true);
    if (readerSession && readerDialog?.open && !readerSession.refresh) {
      const active = readerSession;
      active.refresh = requestAnimationFrame(() => { active.refresh = 0; renderReader(active); });
    }
  }
  function appendReaderMedia(card, post) {
    const media = [...post.media, ...(post.quote?.media || [])];
    if (!media.length) return;
    const toggle = makeButton('reader-media'); toggle.textContent = 'Show media';
    toggle.setAttribute('aria-expanded', 'false');
    let container = null;
    toggle.addEventListener('click', () => {
      if (container) {
        for (const video of container.querySelectorAll('video')) video.pause();
        container.remove(); container = null;
        toggle.textContent = 'Show media'; toggle.setAttribute('aria-expanded', 'false'); return;
      }
      container = readerElement('div', 'xt6-reader-media');
      for (const item of media) {
        const url = item.url || item.poster;
        try {
          const host = new URL(url).hostname;
          if (!host.endsWith('.twimg.com') && host !== 'twimg.com') continue;
        } catch { continue; }
        if (item.type !== 'photo' && item.url) {
          const video = readerElement('video'); video.controls = true; video.preload = 'none';
          video.playsInline = true; video.src = item.url;
          if (item.poster) video.poster = item.poster;
          container.append(video);
        } else {
          const img = readerElement('img'); img.alt = item.alt || 'Post attachment'; img.loading = 'lazy'; img.src = url;
          container.append(img);
          if (item.type !== 'photo') container.append(readerLink(post.href, 'Play on original post'));
        }
      }
      toggle.after(container); toggle.textContent = 'Hide media'; toggle.setAttribute('aria-expanded', 'true');
    });
    card.append(toggle);
  }
  function readerPostCard(post, number) {
    const card = readerElement('section', 'xt6-reader-post'); card.dataset.postId = post.id;
    const caption = readerElement('div', 'xt6-reader-post-caption');
    caption.append(readerLink(post.href, `Post ${number}`));
    if (!post.fullText) caption.append(readerElement('span', '', 'Preview — full text may be unavailable'));
    const text = readerElement('div', 'xt6-reader-text'); renderReaderText(text, post);
    card.append(caption, text);
    if (post.quote) {
      const quote = readerElement('blockquote', 'xt6-reader-quote');
      quote.append(readerLink(post.quote.href, `Quoted: ${post.quote.name} @${post.quote.handle}`));
      const quotedText = readerElement('div', 'xt6-reader-text'); renderReaderText(quotedText, post.quote);
      quote.append(quotedText); card.append(quote);
    }
    appendReaderMedia(card, post);
    return card;
  }
  function renderReader(session) {
    if (readerSession !== session) return;
    const chain = readerData.chain(session.seed);
    const posts = session.mode === 'post' ? [readerData.get(session.seed)].filter(Boolean) : chain.posts;
    session.posts = posts; session.chain = chain;
    const seed = readerData.get(session.seed);
    if (seed) setText(session.author, `${seed.name} @${seed.handle}`);
    const signature = posts.map(p => `${p.id}:${p.text}:${p.fullText}:${p.media.length}`).join('|');
    if (signature !== session.signature) {
      session.signature = signature;
      const previous = new Map([...session.content.children].map(el => [el.dataset.postId, el]));
      posts.forEach((post, index) => {
        let card = previous.get(post.id);
        const key = `${post.text}:${post.fullText}:${post.media.length}`;
        if (!card || card.dataset.version !== key) { card?.remove(); card = readerPostCard(post, index + 1); card.dataset.version = key; }
        const label = card.querySelector('.xt6-reader-post-caption a'); setText(label, `Post ${index + 1}`);
        if (session.content.children[index] !== card) session.content.insertBefore(card, session.content.children[index] || null);
        previous.delete(post.id);
      });
      for (const card of previous.values()) card.remove();
    }
    const count = `${posts.length} ${posts.length === 1 ? 'post' : 'posts'} loaded`;
    let message = session.loading ? `${count} · Looking for connected posts…` : `${count} · More parts may be available on X.`;
    if (session.mode === 'post' && seed) message = seed.fullText ? 'Full post text' : 'Only the available preview could be loaded.';
    else if (chain.branches.length) message = `${count} · This thread branches. Open an original post to choose a continuation.`;
    else if (chain.missingParentId) message = `${count} · Earlier parts may be missing.`;
    else if (session.stopped) message = `${count} · Loading stopped. You can load more when ready.`;
    if (session.note) message = `${count} · ${session.note}`;
    setText(session.status, message);
    session.stop.hidden = !session.loading;
    session.more.hidden = session.loading || (session.mode === 'post' && seed?.fullText && seed?.source === 'react');
    session.copy.disabled = !posts.length; session.print.disabled = !posts.length;
    const query = session.search.value.trim().toLocaleLowerCase();
    for (const card of session.content.children) card.hidden = !!query && !card.textContent.toLocaleLowerCase().includes(query);
  }
  function stopReaderLoading(session, stopped = true) {
    session.abort?.abort(); session.abort = null; session.loading = false; session.stopped = stopped;
    renderReader(session);
  }
  function readerWait(ms, signal) {
    return new Promise(resolve => {
      if (signal.aborted) return resolve(false);
      const finish = value => { clearTimeout(timer); signal.removeEventListener('abort', cancel); resolve(value); };
      const cancel = () => finish(false);
      const timer = setTimeout(() => finish(true), ms);
      signal.addEventListener('abort', cancel, { once: true });
    });
  }
  function nativePostAnchor(id) {
    const links = [...(column || document).querySelectorAll('article[data-testid="tweet"] a[href*="/status/"]')];
    return links.find(a => !a.closest('.xt6-ui') && postID(a.href) === id && a.querySelector('time')) || null;
  }
  async function loadReaderThread(session) {
    if (session.loading || readerSession !== session) return;
    const abort = new AbortController(); session.abort = abort; session.loading = true; session.stopped = false; session.note = '';
    const signal = abort.signal, deadline = Date.now() + 45000;
    let idle = 0, lastSignature = '', passes = 0;
    renderReader(session);
    while (!signal.aborted && readerSession === session && Date.now() < deadline && passes++ < 45) {
      if (document.hidden) { session.note = 'Loading paused while this tab is in the background.'; break; }
      collectReaderPosts(column || document); renderReader(session);
      const posts = session.posts;
      if (!posts.length) { if (!await readerWait(700, signal)) break; continue; }
      if (session.mode === 'post') {
        if (posts[0].fullText && posts[0].source === 'react') break;
        const article = nativePostAnchor(session.seed)?.closest(ARTICLE);
        const more = article && [...article.querySelectorAll('[data-testid="tweet-text-show-more-link"]')].find(el => outsideQuote(el, article));
        if (more && !session.clicked.has(more)) { session.clicked.add(more); more.click(); }
        if (!await readerWait(700, signal)) break;
        continue;
      }
      if (session.chain.branches.length || posts.length >= 200) break;
      const signature = posts.map(p => `${p.id}:${p.text.length}`).join('|');
      if (signature !== lastSignature) { idle = 0; lastSignature = signature; } else idle++;
      const targetId = session.chain.missingParentId || posts.at(-1).id;
      const currentId = postID(location.href);
      const anchor = nativePostAnchor(targetId);
      // Follow X's own navigation handlers. No private API tokens or requests.
      if (anchor && currentId !== targetId && !session.visited.has(targetId)) {
        session.visited.add(targetId); idle = 0; anchor.click();
        if (!await readerWait(1100, signal)) break;
        continue;
      }
      const tail = nativePostAnchor(posts.at(-1).id)?.closest(ARTICLE);
      const tailBottom = tail?.getBoundingClientRect().bottom;
      const candidates = [...(column || document).querySelectorAll('button, [role="button"], a')].filter(el =>
        !el.closest('.xt6-ui') && /^(show (more replies|replies|this thread)|show more)$/i.test(el.textContent.trim()) &&
        !el.closest(ARTICLE) && !session.clicked.has(el));
      const continuation = candidates.find(el => {
        const box = el.getBoundingClientRect();
        return box.height > 0 && tailBottom !== undefined && box.top >= tailBottom - 20 && box.top < tailBottom + 600;
      });
      if (continuation && session.clicked.size < 12) {
        session.clicked.add(continuation); continuation.click(); idle = 0;
      } else {
        window.scrollBy({ top: Math.max(450, innerHeight * .75), behavior: 'instant' });
      }
      if (idle >= 4) break;
      if (!await readerWait(850, signal)) break;
    }
    if (!signal.aborted && readerSession === session) {
      session.loading = false; session.abort = null;
      if (!session.posts.length) session.note = 'X did not load this post. Try Load more or open the original.';
      else if (session.posts.length >= 200) session.note = 'Loading limit reached. Open an original post to continue.';
      renderReader(session);
    }
  }
  function openThreadReader(seed, mode = 'thread') {
    if (readerDialog?.open) return;
    const dialog = readerElement('dialog', 'xt6-ui'); dialog.id = 'xt6-reader-dialog';
    dialog.setAttribute('aria-labelledby', 'xt6-reader-title');
    const dark = ['rgb(0, 0, 0)', 'rgb(21, 32, 43)'].includes(getComputedStyle(document.body).backgroundColor);
    dialog.dataset.theme = dark ? 'dark' : 'light';
    const heading = readerElement('div', 'xt6-reader-heading');
    const title = readerElement('h2', '', mode === 'post' ? 'Read post' : 'Read thread'); title.id = 'xt6-reader-title';
    const author = readerElement('div', 'xt6-reader-author', 'Loading post…');
    const status = readerElement('p', 'xt6-reader-status', 'Loading…'); status.setAttribute('aria-live', 'polite');
    const toolbar = readerElement('div', 'xt6-reader-toolbar');
    const button = (label, fn) => { const el = readerElement('button', 'xt6-button', label); el.type = 'button'; el.addEventListener('click', fn); return el; };
    const session = { seed, mode, posts: [], signature: '', chain: {}, loading: false, visited: new Set(), clicked: new Set(), scroll: scrollY, closed: false };
    const stop = button('Stop loading', () => stopReaderLoading(session));
    const more = button('Load more', () => loadReaderThread(session));
    const copy = button('Copy thread', async () => {
      const text = `${author.textContent}\n\n` + session.posts.map((post, index) => `${index + 1}. ${post.text}\n${post.href}`).join('\n\n');
      try { await navigator.clipboard.writeText(text); setText(status, 'Thread copied with links to the originals.'); }
      catch { setText(status, 'Copy was unavailable. Select the text to copy it.'); }
    });
    const print = button('Print', () => window.print());
    const settings = button('Reading settings', () => openReadingSettings());
    const close = button('Close reader', () => dialog.close());
    const search = readerElement('input'); search.type = 'search'; search.placeholder = 'Find in thread'; search.setAttribute('aria-label', 'Find in thread');
    search.addEventListener('input', () => renderReader(session));
    const content = readerElement('div', 'xt6-reader-content');
    const original = readerLink(`https://x.com/i/web/status/${seed}`, 'Open original');
    heading.append(title, close); toolbar.append(stop, more, copy, print, settings, original, search);
    dialog.append(heading, author, toolbar, status, content); document.body.append(dialog);
    Object.assign(session, { dialog, author, status, content, stop, more, copy, print, search });
    readerDialog = dialog; readerSession = session;
    dialog.addEventListener('close', () => {
      stopReaderLoading(session); session.closed = true;
      if (session.refresh) cancelAnimationFrame(session.refresh);
      for (const video of dialog.querySelectorAll('video')) video.pause();
      readerSession = null; readerDialog = null; dialog.remove();
      window.scrollTo({ top: session.scroll, behavior: 'instant' });
      if (readerLaunch) window.close();
    }, { once: true });
    dialog.showModal(); collectReaderPosts(column || document); renderReader(session); loadReaderThread(session);
  }
  function initThreadReader() {
    const css = readerElement('style', 'xt6-ui');
    css.textContent = `
      .xt6-native-text-hidden { display:none !important; }
      .xt6-reading-controls { display:flex; flex-wrap:wrap; align-items:center; gap:6px 10px; margin:3px 0 6px; font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
      .xt6-reader-text { white-space:pre-wrap; overflow-wrap:anywhere; font:inherit; line-height:1.55; }
      .xt6-reader-text a { color:rgb(29,155,240); text-decoration:none; }
      .xt6-reader-text a:hover { text-decoration:underline; }
      .xt6-expanded-text { margin:3px 0; font-size:15px; }
      #xt6-reader-dialog { width:calc(100vw - 28px); max-width:none; height:calc(100dvh - 28px); max-height:none; box-sizing:border-box; padding:24px 28px; border:1px solid #bec5ca; border-radius:16px; background:#fff; color:#0f1419; overflow:auto; font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
      #xt6-reader-dialog[data-theme="dark"] { color-scheme:dark; background:#10171d; color:#e7e9ea; border-color:#536471; }
      #xt6-reader-dialog::backdrop { background:rgb(0 0 0 / .7); }
      #xt6-reader-dialog .xt6-reader-heading { display:flex; justify-content:space-between; align-items:center; gap:16px; }
      #xt6-reader-title { font-size:24px; margin:0; }
      .xt6-reader-author { font-size:16px; font-weight:600; margin:6px 0 14px; }
      .xt6-reader-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
      .xt6-reader-toolbar input { flex:1 1 150px; min-width:100px; max-width:300px; padding:6px 10px; border:1px solid #71767b; border-radius:8px; background:transparent; color:inherit; font:inherit; }
      #xt6-reader-dialog a { color:#1d9bf0; }
      .xt6-reader-status { font-size:13px; opacity:.8; min-height:20px; margin:12px 0; }
      .xt6-reader-post { padding:18px 0; border-top:1px solid #71767b66; }
      .xt6-reader-post-caption { display:flex; gap:14px; margin-bottom:10px; font-size:12px; opacity:.8; }
      .xt6-reader-quote { margin:16px 0; border-left:3px solid #71767b; padding:8px 16px; }
      .xt6-reader-quote > a { display:block; font-size:13px; margin-bottom:8px; }
      .xt6-reader-media { display:flex; flex-wrap:wrap; gap:12px; margin-top:10px; }
      .xt6-reader-media img,.xt6-reader-media video { max-width:100%; max-height:var(--xt6-media-height); object-fit:contain; }
      .xt6-reader-post > button { margin-top:12px; }
      #xt6-reader-dialog [hidden] { display:none !important; }
      @media(max-width:500px) { #xt6-reader-dialog { padding:16px; width:calc(100vw - 12px); height:calc(100dvh - 12px); } }
      @media print { body:has(#xt6-reader-dialog[open]) > :not(#xt6-reader-dialog) { display:none !important; } #xt6-reader-dialog[open] { position:static; display:block; width:100%; height:auto; overflow:visible; border:0; padding:0; background:white!important; color:black!important; } #xt6-reader-dialog::backdrop,.xt6-reader-toolbar,.xt6-reader-heading button,.xt6-reader-status,.xt6-reader-post>button { display:none!important; } .xt6-reader-post { break-inside:auto; } }
    `;
    (document.head || document.documentElement).append(css);
    document.addEventListener('xt6-settings-changed', () => {
      for (const article of column?.querySelectorAll(ARTICLE) || []) syncReadingArticle(article);
    });
    if (readerLaunch === 'thread' || readerLaunch === 'post') {
      const id = postID(location.href);
      if (id && !readerBooted) { readerBooted = true; setTimeout(() => openThreadReader(id, readerLaunch), 300); }
    }
  }

    // List headers: recognise the list's own member/follower links, never a tweet.
  // Original X nodes stay in place so React retains its controls and event handlers.
  const xt6ListPreferences = new Map();
  let xt6ListHeader = null;

  function clearListHeader() {
    if (!xt6ListHeader) return;
    for (const [node, classes] of xt6ListHeader.marked) {
      node.classList.remove(...classes);
    }
    xt6ListHeader.controls.remove();
    xt6ListHeader = null;
  }

  function findListHeader(column, id) {
    const listPath = `/i/lists/${id}`;
    const members = [...column.querySelectorAll('a[href]')].find(a => {
      if (a.closest('article, [role="dialog"]')) return false;
      try { return new URL(a.getAttribute('href'), location.href).pathname === `${listPath}/members`; }
      catch { return false; }
    });
    if (!members) return null;

    // The statistics row contains both links. Stop well before the timeline.
    let stats = members.parentElement;
    let foundStats = false;
    for (let depth = 0; stats && depth < 3; depth++, stats = stats.parentElement) {
      if (stats === column || stats.querySelector('article')) return null;
      if ([...stats.querySelectorAll('a[href]')].some(a => {
        try { return new URL(a.getAttribute('href'), location.href).pathname === `${listPath}/followers`; }
        catch { return false; }
      })) {
        foundStats = true;
        break;
      }
    }
    if (!foundStats || !stats || stats === column) return null;
    const info = stats.parentElement;
    if (!info || info === column || info.closest('article, [role="dialog"]') ||
        info.querySelector('article, [role="textbox"], [contenteditable="true"]')) return null;
    const children = [...info.children].filter(el => !el.classList.contains('xt6-ui'));
    const title = children[0];
    // Fail open on unfamiliar layouts instead of risking hidden feed content.
    if (children.length < 3 || children.length > 9 || !title || title === stats ||
        !title.textContent.trim() || title.textContent.trim().length > 160 ||
        title.querySelector('a[href], button')) return null;
    const outer = info.parentElement;
    if (!outer || outer === column || outer.querySelector('article') || outer.children.length > 3) return null;
    const cell = outer.closest('[data-testid="cellInnerDiv"]');
    if (cell && cell.querySelector('article')) return null;
    const siblings = [...outer.children].filter(el => el !== info);
    const cover = siblings.find(el => !el.textContent.trim() &&
      el.querySelector('img, [style*="background-image"]')) || null;
    const actions = children.filter(el => el !== title && el !== stats &&
      (el.matches('a[href], button, [role="button"]') ||
       el.querySelector(`a[href="${listPath}/info"], button, [role="button"]`)));
    const details = children.filter(el => el !== title && el !== stats && !actions.includes(el));
    return { outer, info, title, stats, cover, actions, details };
  }

  function syncListHeader(column) {
    const match = location.pathname.match(/^\/i\/lists\/(\d+)\/?$/);
    if (!CONFIG.compactLists || !match || !column) {
      clearListHeader();
      return;
    }
    const id = match[1];
    const parts = findListHeader(column, id);
    if (!parts) {
      clearListHeader();
      return;
    }
    const same = xt6ListHeader && xt6ListHeader.id === id &&
      xt6ListHeader.info === parts.info && xt6ListHeader.title === parts.title &&
      xt6ListHeader.stats === parts.stats && xt6ListHeader.cover === parts.cover &&
      xt6ListHeader.controls.parentElement === parts.info &&
      parts.outer.classList.contains('xt6-list-header') &&
      parts.info.classList.contains('xt6-list-info') &&
      parts.title.classList.contains('xt6-list-title') &&
      parts.stats.classList.contains('xt6-list-stats') &&
      (!parts.cover || parts.cover.classList.contains('xt6-list-cover')) &&
      parts.details.every(el => el.classList.contains('xt6-list-detail')) &&
      parts.actions.every(el => el.classList.contains('xt6-list-action')) &&
      parts.details.length === xt6ListHeader.details.length &&
      parts.details.every((el, i) => el === xt6ListHeader.details[i]) &&
      parts.actions.length === xt6ListHeader.actions.length &&
      parts.actions.every((el, i) => el === xt6ListHeader.actions[i]);
    if (same) return;
    clearListHeader();
    if (!xt6ListPreferences.has(id)) {
      xt6ListPreferences.set(id, { details: false, cover: !CONFIG.hideListCover });
      if (xt6ListPreferences.size > 100) xt6ListPreferences.delete(xt6ListPreferences.keys().next().value);
    }
    const preferences = xt6ListPreferences.get(id);
    const marked = [];
    function mark(node, ...classes) {
      if (!node) return;
      node.classList.add(...classes);
      marked.push([node, classes]);
    }
    mark(parts.outer, 'xt6-list-header');
    mark(parts.info, 'xt6-list-info');
    mark(parts.title, 'xt6-list-title');
    mark(parts.stats, 'xt6-list-stats');
    mark(parts.cover, 'xt6-list-cover');
    parts.actions.forEach(el => mark(el, 'xt6-list-action'));
    parts.details.forEach(el => mark(el, 'xt6-list-detail'));

    const controls = document.createElement('div');
    controls.className = 'xt6-ui xt6-list-controls';
    const detailsButton = document.createElement('button');
    detailsButton.type = 'button';
    detailsButton.dataset.xt6Action = 'list-details';
    const coverButton = document.createElement('button');
    coverButton.type = 'button';
    coverButton.dataset.xt6Action = 'list-cover';
    if (parts.details.length) controls.appendChild(detailsButton);
    if (parts.cover) controls.appendChild(coverButton);
    function update() {
      parts.outer.classList.toggle('xt6-list-details-open', preferences.details);
      parts.outer.classList.toggle('xt6-list-cover-open', preferences.cover);
      detailsButton.textContent = preferences.details ? 'Hide list details' : 'List details';
      detailsButton.setAttribute('aria-expanded', String(preferences.details));
      coverButton.textContent = preferences.cover ? 'Hide cover' : 'Show cover';
      coverButton.setAttribute('aria-expanded', String(preferences.cover));
    }
    detailsButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      preferences.details = !preferences.details;
      update();
    });
    coverButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      preferences.cover = !preferences.cover;
      update();
    });
    parts.info.appendChild(controls);
    // Include state classes in cleanup, even when initially absent.
    marked.push([parts.outer, ['xt6-list-details-open', 'xt6-list-cover-open']]);
    xt6ListHeader = { ...parts, id, controls, marked };
    update();
  }


  const style = document.createElement('style');
  style.id = 'xt6-style';
  style.textContent = `
    :root { --xt6-width: ${CONFIG.pageWidth > 0 ? `${CONFIG.pageWidth}px` : 'none'}; --xt6-media-height: ${CONFIG.mediaMaxHeight}px; }
    /* A slim icon rail; keep X's native bottom navigation on small phones. */
    @media (min-width: 500px) {
      header[role="banner"] {
        flex: 0 0 ${CONFIG.navigationWidth}px !important;
        width: ${CONFIG.navigationWidth}px !important;
        min-width: 0 !important;
        align-items: center !important;
      }
      header[role="banner"] > div,
      header[role="banner"] > div > div,
      header[role="banner"] > div > div > div {
        width: ${CONFIG.navigationWidth}px !important;
        max-width: ${CONFIG.navigationWidth}px !important;
        box-sizing: border-box !important;
      }
      header[role="banner"] > div > div > div { padding-left: 4px !important; padding-right: 4px !important; align-items: center !important; }
      header[role="banner"] nav[role="navigation"] { align-items: center !important; }
      header[role="banner"] nav[role="navigation"] :is(a, [role="button"]) { align-items: center !important; }
      header[role="banner"] nav[role="navigation"] :is(a, [role="button"]) > div > div + div {
        display: none !important;
      }
      header[role="banner"] [data-testid="SideNav_NewTweet_Button"] {
        width: 48px !important; min-width: 48px !important; height: 48px !important; min-height: 48px !important;
        padding: 0 !important; margin-inline: auto !important; border-radius: 50% !important;
        align-items: center !important; justify-content: center !important;
      }
      header[role="banner"] [data-testid="SideNav_NewTweet_Button"] > div { display: flex !important; align-items: center !important; justify-content: center !important; width: 100% !important; height: 100% !important; }
      header[role="banner"] [data-testid="SideNav_NewTweet_Button"] > div > * { display: none !important; }
      header[role="banner"] [data-testid="SideNav_NewTweet_Button"] > div::before {
        content: '+'; font: 400 30px/1 -apple-system, sans-serif;
      }
      header[role="banner"] [data-testid="SideNav_AccountSwitcher_Button"] {
        width: 56px !important; min-width: 0 !important; padding: 8px !important; margin-inline: auto !important;
      }
      header[role="banner"] [data-testid="SideNav_AccountSwitcher_Button"] > :not(:first-child) { display: none !important; }
    }
    ${CONFIG.hideSidebar ? '[data-testid="sidebarColumn"] { display: none !important; }' : ''}
    .xt6-main { flex: 1 1 ${CONFIG.pageWidth > 0 ? `${CONFIG.pageWidth}px` : '0%'} !important; width: ${CONFIG.pageWidth > 0 ? `${CONFIG.pageWidth}px` : 'auto'} !important; min-width: 0 !important; max-width: none !important; }
    ${COLUMN}, .xt6-column-path { width: 100% !important; max-width: var(--xt6-width) !important; min-width: 0 !important; box-sizing: border-box !important; }
    ${COLUMN} section, ${COLUMN} article, ${COLUMN} [data-testid="cellInnerDiv"] { max-width: 100% !important; min-width: 0 !important; }
    .xt6-feed-path { max-width: 100% !important; min-width: 0 !important; }
    .xt6-hidden { display: none !important; }
    .xt6-media:not(.xt6-full) { max-height: min(var(--xt6-media-height), 65vh) !important; overflow: auto !important; }
    .xt6-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin: 5px 0; min-height: 28px; font: 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .xt6-button { appearance: none; cursor: pointer; color: rgb(29,155,240); background: transparent; border: 1px solid rgba(113,118,123,.65); border-radius: 14px; padding: 3px 10px; min-height: 28px; font: inherit; }
    .xt6-button:hover { background: rgba(29,155,240,.12); }
    .xt6-button:focus-visible, .xt6-open:focus-visible { outline: 2px solid rgb(29,155,240); outline-offset: 3px; }
    .xt6-ui [hidden] { display: none !important; }
    .xt6-open { color: rgb(29,155,240); font: inherit; text-decoration: none; }
    .xt6-open:hover { text-decoration: underline; }
    ${CONFIG.reduceMotion ? `
      html { scroll-behavior: auto !important; }
      body *, body *::before, body *::after { transition: none !important; }
      body *:not([role="progressbar"]):not([role="progressbar"] *), body *::before, body *::after { animation: none !important; }
    ` : ''}
    ${CONFIG.hideFloatingGrok ? '[data-testid="GrokDrawer"], [data-testid="grok-drawer"], .xt6-floating-grok { display:none !important; }' : ''}
    ${CONFIG.hideFloatingChat ? '[data-testid="DMDrawer"], .xt6-floating-chat { display:none !important; }' : ''}
        .xt6-list-header .xt6-list-info {
      display: flex !important;
      flex-flow: row wrap !important;
      align-items: center !important;
      justify-content: flex-start !important;
      gap: 8px 12px !important;
      padding: 10px 16px !important;
      min-height: 0 !important;
    }
    .xt6-list-info > * { margin: 0 !important; }
    .xt6-list-info > .xt6-list-title {
      order: 0;
      flex: 1 1 180px;
      text-align: left !important;
      justify-content: flex-start !important;
      font-size: 17px !important;
      line-height: 1.3 !important;
    }
    .xt6-list-title * { font-size: inherit !important; line-height: inherit !important; }
    .xt6-list-info > .xt6-list-stats {
      order: 1;
      flex: 0 1 auto !important;
      display: flex !important;
      flex-flow: row wrap !important;
      gap: 8px;
      font-size: 13px !important;
    }
    .xt6-list-stats * { font-size: inherit !important; }
    .xt6-list-info > .xt6-list-action {
      order: 2;
      min-height: 28px !important;
      padding: 3px 10px !important;
      font-size: 13px !important;
    }
    .xt6-list-action * { font-size: inherit !important; }
    .xt6-list-info > .xt6-list-detail {
      order: 4;
      flex: 1 0 100%;
      max-width: 100%;
      text-align: left !important;
      font-size: 14px !important;
      line-height: 1.4 !important;
    }
    .xt6-list-detail * { font-size: inherit !important; }
    .xt6-list-header:not(.xt6-list-details-open) .xt6-list-detail,
    .xt6-list-header:not(.xt6-list-cover-open) .xt6-list-cover {
      display: none !important;
    }
    .xt6-list-header.xt6-list-cover-open .xt6-list-cover {
      display: block !important;
      height: 100px !important;
      max-height: 100px !important;
      min-height: 0 !important;
      overflow: hidden !important;
    }
    .xt6-list-cover img { object-fit: cover !important; }
    .xt6-list-info > .xt6-list-controls {
      order: 3;
      flex: 1 0 100%;
      display: flex;
      flex-flow: row wrap;
      gap: 6px 12px;
    }
    .xt6-list-controls button {
      appearance: none;
      border: 0;
      border-radius: 4px;
      padding: 3px 0;
      min-height: 24px;
      background: transparent;
      color: rgb(29, 155, 240);
      font: 500 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
    }
    .xt6-list-controls button:hover { text-decoration: underline; }
    .xt6-list-controls button:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }

  `;

  function fixColumnPath() {
    const nextMain = column?.closest('main, [role="main"]') || null;
    if (mainNode && mainNode !== nextMain) mark(mainNode, 'xt6-main', false);
    mainNode = nextMain;
    if (mainNode) mark(mainNode, 'xt6-main');
    for (const el of pathNodes) { if (!column || !el.contains(column)) { mark(el, 'xt6-column-path', false); pathNodes.delete(el); } }
    // Only the known column path, no per-post measurement or computed-style loop.
    for (let el = column?.parentElement; el && !el.matches('main, [role="main"], body'); el = el.parentElement) {
      mark(el, 'xt6-column-path'); pathNodes.add(el);
    }
  }
  function labelNavigation() {
    const header = document.querySelector('header[role="banner"]');
    if (!header) return;
    for (const control of header.querySelectorAll('nav :is(a, [role="button"]), [data-testid="SideNav_NewTweet_Button"], [data-testid="SideNav_AccountSwitcher_Button"]')) {
      const label = control.getAttribute('aria-label') || control.textContent.trim();
      if (label && !control.hasAttribute('title')) attr(control, 'title', label);
    }
  }
  function loosenFeedPath(node) {
    // Mark each shared feed wrapper once. No layout reads are required.
    for (let el = node.parentElement; el && el !== column && column?.contains(el); el = el.parentElement) {
      if (feedPaths.has(el) && el.classList.contains('xt6-feed-path')) break;
      mark(el, 'xt6-feed-path'); feedPaths.add(el);
    }
  }
  function floatingButtons(root = document) {
    for (const b of root.querySelectorAll('button[aria-label="Grok"], [role="button"][aria-label="Grok"], button[aria-label="Chat"], [role="button"][aria-label="Chat"]')) {
      // Only standalone launchers, never post actions, navigation, or dialog controls.
      if (b.closest('article, main, nav, [role="dialog"], header')) continue;
      const grok = b.getAttribute('aria-label') === 'Grok';
      if (grok ? CONFIG.hideFloatingGrok : CONFIG.hideFloatingChat) mark(b, grok ? 'xt6-floating-grok' : 'xt6-floating-chat');
    }
  }
  function enqueueTree(node) {
    if (!(node instanceof Element) || node.closest('.xt6-ui')) return;
    const owner = node.closest(ARTICLE);
    if (owner) dirty.add(owner);
    for (const a of node.querySelectorAll(ARTICLE)) dirty.add(a);
  }
  function schedule() {
    if (!document.hidden && !frame) frame = requestAnimationFrame(flush);
  }
  function checkRoute() {
    if (route === location.pathname) return;
    route = location.pathname; shellDirty = headerDirty = true;
    if (column) enqueueTree(column);
  }
  function onFeedMutations(records) {
    checkRoute();
    for (const r of records) {
      const target = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      if (!target || target.closest('.xt6-ui')) continue;
      if (r.type === 'attributes' && r.attributeName === 'class' && ownClasses.get(target) === target.getAttribute('class')) continue;
      if (feedPaths.has(target) && !target.classList.contains('xt6-feed-path')) mark(target, 'xt6-feed-path');
      if (r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].length &&
        [...r.addedNodes, ...r.removedNodes].every(n => n.nodeType === 1 && n.classList.contains('xt6-ui'))) continue;
      const article = target.closest(ARTICLE);
      if (article) dirty.add(article);
      else headerDirty = true;
      for (const node of r.addedNodes || []) enqueueTree(node);
    }
    if (dirty.size || headerDirty || shellDirty) schedule();
  }
  function onShellMutations(records) {
    checkRoute();
    if (!column?.isConnected) { shellDirty = true; schedule(); return; }
    for (const r of records) {
      if (column.contains(r.target)) continue;
      if (r.target instanceof Element && r.target.closest('.xt6-ui')) continue;
      if ([...r.addedNodes, ...r.removedNodes].every(n => n.nodeType === 1 && n.classList.contains('xt6-ui'))) continue;
      shellDirty = true; break;
    }
    if (shellDirty) schedule();
  }
  function onPlay(event) {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement)) return;
    const article = video.closest(ARTICLE);
    if (!article) return;
    const state = states.get(article);
    if (!state || !choices.get(state.key)?.shown || (CONFIG.preventAutoplay && !state.playAllowed)) pause(video);
  }
  function onPlayerGesture(event) {
    if (!event.isTrusted || (event.type === 'keydown' && ![' ', 'Enter', 'k'].includes(event.key))) return;
    const root = event.target.closest?.('.xt6-media:not(.xt6-hidden)');
    if (!root) return;
    const state = states.get(root.closest(ARTICLE));
    if (state && choices.get(state.key)?.shown) state.playAllowed = true;
  }
  function observeFeed() {
    if (!column) return;
    feedObserver.observe(column, { subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['class', 'href', 'src', 'data-testid'] });
  }
  function bindColumn(next) {
    if (column === next) return;
    feedObserver.disconnect();
    if (column) {
      column.removeEventListener('play', onPlay, true);
      column.removeEventListener('pointerdown', onPlayerGesture, true);
      column.removeEventListener('keydown', onPlayerGesture, true);
    }
    column = next; dirty.clear();
    if (column) {
      column.addEventListener('play', onPlay, true);
      column.addEventListener('pointerdown', onPlayerGesture, true);
      column.addEventListener('keydown', onPlayerGesture, true);
      observeFeed(); enqueueTree(column);
    }
    headerDirty = true;
  }
  function flush() {
    frame = 0;
    if (document.hidden) return;
    checkRoute();
    if (shellDirty) {
      shellDirty = false;
      bindColumn(document.querySelector(COLUMN));
      fixColumnPath(); labelNavigation(); floatingButtons(); syncReadingSettings();
    }
    if (headerDirty) {
      headerDirty = false; syncListHeader(column);
      const header = column?.querySelector('.xt6-list-header');
      if (header) loosenFeedPath(header);
    }
    // Bound a burst of new posts so a long thread doesn't monopolise a frame.
    const batch = [...dirty].slice(0, 24);
    for (const article of batch) { dirty.delete(article); if (column?.contains(article)) syncArticle(article); }
    if (dirty.size) schedule();
  }
  function start() {
    (document.head || document.documentElement).append(style);
    initReadingSettings(); initThreadReader();
    feedObserver = new MutationObserver(onFeedMutations);
    shellObserver = new MutationObserver(onShellMutations);
    shellObserver.observe(document.body, { childList: true, subtree: true });
    schedule();
    // A few startup recovery checks; no permanent polling interval.
    for (const delay of [600, 1800, 5000]) setTimeout(() => {
      if (document.hidden) return;
      shellDirty = headerDirty = true; if (column) enqueueTree(column); schedule();
    }, delay);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        sleeping = true; feedObserver.disconnect(); shellObserver.disconnect();
        if (frame) cancelAnimationFrame(frame); frame = 0; dirty.clear();
      } else if (sleeping) {
        sleeping = false; observeFeed(); shellObserver.observe(document.body, { childList: true, subtree: true });
        shellDirty = headerDirty = true; if (column) enqueueTree(column); schedule();
      }
    });
    const navigate = () => { checkRoute(); shellDirty = headerDirty = true; schedule(); };
    window.addEventListener('popstate', navigate);
    window.addEventListener('pageshow', navigate);
    if (window.navigation) window.navigation.addEventListener('currententrychange', navigate);
    if (document.hidden) {
      sleeping = true; feedObserver.disconnect(); shellObserver.disconnect();
    }
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
