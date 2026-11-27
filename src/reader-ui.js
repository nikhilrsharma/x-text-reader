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
