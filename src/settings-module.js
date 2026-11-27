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
