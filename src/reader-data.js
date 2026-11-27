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
