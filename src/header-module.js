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
