// ==UserScript==
// @name         X / Twitter — Text-Only Mode + Speed
// @namespace    yoddha.x-text-only
// @version      6.1.1
// @license      MIT
// @homepageURL  https://github.com/nikhilrsharma/x-text-reader
// @supportURL   https://github.com/nikhilrsharma/x-text-reader/issues
// @description  Full-width text-first X with a thread reader, long-post expansion, local reading settings, and optional media. No external services.
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

  /* SETTINGS_MODULE */
  /* READER_DATA */
  /* READER_UI */
  /* HEADER_MODULE */

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
    /* HEADER_STYLE */
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
