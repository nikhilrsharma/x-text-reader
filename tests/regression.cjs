const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { launchOptions, writeResults } = require('./helpers.cjs');

const sourcePath = process.argv[2] || `${__dirname}/../dist/x-text-reader.user.js`;
const source = fs.readFileSync(sourcePath, 'utf8');
const filter = process.argv[3] ? new RegExp(process.argv[3], 'i') : null;
const pixel = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="blue"/></svg>';
const photo = (id = 'photo') => `<div data-testid="tweetPhoto" id="${id}" style="width:320px;height:180px"><img src='${pixel}' width="320" height="180" alt="Test photograph"></div>`;
const header = (id, handle = 'alice', time = true) => `<div data-testid="User-Name"><a href="/${handle}">${handle}</a><span>@${handle}</span>${time ? `<a href="/${handle}/status/${id}"><time datetime="2026-11-13T00:00:00Z">1h</time></a>` : ''}</div>`;
const quoted = (id = '900', body = 'Quoted words') => `<div role="link" data-testid="quoteTweet" tabindex="0" data-quote="true">${header(id, 'quoted')}<div data-testid="tweetText">${body}</div>${photo(`quote-photo-${id}`)}</div>`;
const article = ({ id = '101', body = 'A useful post.', media = photo(), quote = '', time = true, tab = '0', extra = '', domId = `post-${id}` } = {}) => `<article data-testid="tweet" tabindex="${tab}" id="${domId}" ${extra}>${header(id, 'alice', time)}<div data-testid="tweetText" data-own-text="true">${body}</div>${media}${quote}<div role="group" aria-label="1 reply, 2 likes"><button data-testid="reply">Reply</button><button data-testid="like">Like</button></div></article>`;
const pageHTML = (content) => `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font-family:Arial}main{display:flex}article{padding:16px;border:1px solid #ccc}button{padding:5px} [data-testid="primaryColumn"]{width:600px;max-width:600px} [data-testid="sidebarColumn"]{width:300px} [data-testid="quoteTweet"]{border:1px solid gray;padding:8px}</style></head><body><main><div data-testid="primaryColumn"><section aria-label="Timeline"><div id="feed">${content}</div></section></div><aside data-testid="sidebarColumn">Trends</aside></main></body></html>`;
const listHeader = (id = '123') => `<div data-testid="cellInnerDiv" id="list-cell"><div id="list-outer"><div id="list-banner"><img src='${pixel}' width="600" height="180" alt=""></div><div id="list-info"><div id="list-title">Quiet reading list</div><div id="list-description">A list description.</div><div id="list-owner"><a href="/alice">Alice @alice</a></div><div id="list-stats"><div><a href="/i/lists/${id}/members">12 members</a></div><div><a href="/i/lists/${id}/followers">3 followers</a></div></div><a id="edit-list" href="/i/lists/${id}/info">Edit List</a></div></div></div>`;
const button = (page, scope = 'article') => page.locator(scope).locator('.xt6-controls button[data-xt6-action="media"]');
const tests = [];
const test = (name, run) => tests.push({ name, run });

async function setup(browser, content, pathname = '/home', init, options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: options.html || pageHTML(content) }));
  await page.goto(`https://x.com${pathname}`);
  await page.evaluate(() => {
    window.__intervals = [];
    const original = window.setInterval;
    window.setInterval = function (fn, delay, ...args) {
      window.__intervals.push(delay);
      return original(fn, delay, ...args);
    };
  });
  if (init) await page.evaluate(init);
  await page.addScriptTag({ content: source });
  await page.waitForTimeout(180);
  return { page, context, errors };
}

test('Reply wrapper and its text remain visible; media toggle is reachable', async browser => {
  const content = article({ media: '' }).replace('<div data-testid="tweetText"', '<div aria-labelledby="reply-text"><div id="reply-text" data-testid="tweetText"').replace('<div role="group"', `${photo('reply-photo')}</div><div role="group"`);
  const { page, context, errors } = await setup(browser, content);
  assert.equal(await page.locator('[data-own-text]').isVisible(), true);
  assert.equal(await page.locator('#reply-photo').isVisible(), false);
  await button(page).click();
  assert.equal(await page.locator('#reply-photo').isVisible(), true);
  await button(page).click();
  assert.equal(await page.locator('#reply-photo').isVisible(), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('X photo shell reserves no collapsed space and respects compact media height', async browser => {
  const shell = `<a href="/alice/status/101/photo/1" id="photo-link" style="display:block"><div style="width:253px;height:510px"><div style="padding-bottom:200%"></div><div>${photo('shelled-photo')}</div></div></a>`;
  const { page, context } = await setup(browser, article({ media: shell }));
  assert.equal(await page.locator('#photo-link').evaluate(el => el.getBoundingClientRect().height), 0);
  assert.equal(await page.locator('#shelled-photo').isVisible(), false);
  assert.ok((await page.locator('article').boundingBox()).height < 200, 'Collapsed article must not keep its 510px media gap');
  await button(page).click();
  assert.equal(await page.locator('#shelled-photo').isVisible(), true);
  const compactHeight = await page.locator('#photo-link').evaluate(el => el.getBoundingClientRect().height);
  assert.ok(compactHeight > 0 && compactHeight <= 360, `Expected compact shell height <=360, got ${compactHeight}`);
  await page.locator('button[data-xt6-action="size"]').click();
  assert.ok(await page.locator('#photo-link').evaluate(el => el.getBoundingClientRect().height > 360));
  await button(page).click();
  assert.equal(await page.locator('#photo-link').evaluate(el => el.getBoundingClientRect().height), 0);
  await context.close();
});

test('X multi-photo gallery collapses its padding shell and preserves native controls and quote text', async browser => {
  const gallery = `<div id="gallery-outer"><div id="gallery-padding" style="position:relative;padding-bottom:calc(33.2362% - 1.329px)"><nav id="gallery-nav" style="position:absolute;inset:0"><div style="display:flex;height:100%"><div data-testid="ScrollSnap-prevButtonWrapper" style="width:30px;flex:none"><button id="gallery-prev" aria-label="Previous image" style="width:24px;height:24px"><svg width="12" height="12"><path d="M10 1L1 6L10 11"/></svg></button></div><div data-testid="ScrollSnap-SwipeableList" style="flex:1;min-width:0"><div data-testid="ScrollSnap-List" role="tablist" style="display:flex"><div role="presentation"><div style="aspect-ratio:16/9">${photo('gallery-photo-1')}</div></div><div role="presentation"><div style="aspect-ratio:16/9">${photo('gallery-photo-2')}</div></div></div></div><div data-testid="ScrollSnap-nextButtonWrapper" style="width:30px;flex:none"><button id="gallery-next" aria-label="Next image" style="width:24px;height:24px"><svg width="12" height="12"><path d="M1 1L10 6L1 11"/></svg></button></div></div></nav></div></div>`;
  const quote = `<div role="link" data-testid="quoteTweet">${header('999', 'quoted')}<div data-testid="tweetText" id="gallery-quote-caption">A quoted caption that must remain readable.</div>${gallery}</div>`;
  const { page, context } = await setup(browser, article({ media: '', quote }), '/home', () => {
    window.__galleryClicks = 0;
    document.getElementById('gallery-next').addEventListener('click', event => { event.preventDefault(); window.__galleryClicks++; });
  });
  assert.equal(await page.locator('#gallery-padding').evaluate(el => el.getBoundingClientRect().height), 0);
  assert.equal(await page.locator('#gallery-quote-caption').isVisible(), true);
  assert.equal(await page.locator('#gallery-next').isVisible(), false);
  await button(page).click();
  assert.ok(await page.locator('#gallery-padding').evaluate(el => el.getBoundingClientRect().height > 0));
  for (const id of ['gallery-photo-1', 'gallery-photo-2', 'gallery-prev', 'gallery-next', 'gallery-quote-caption']) assert.equal(await page.locator(`#${id}`).isVisible(), true, `${id} should be visible after reveal`);
  await page.locator('#gallery-next').click();
  assert.equal(await page.evaluate(() => window.__galleryClicks), 1);
  await button(page).click();
  assert.equal(await page.locator('#gallery-padding').evaluate(el => el.getBoundingClientRect().height), 0);
  assert.equal(await page.locator('#gallery-quote-caption').isVisible(), true);
  await context.close();
});

// X leaves duration badges outside the individual video preview containers.
// This reproduces the two-video carousel reported on 2026-11-25, including its
// absolutely positioned navigation and percentage-sized outer padding shell.
const durationCarousel = ({ mixed = false, caption = '' } = {}) => {
  const videoPreview = (index, duration) => `<div role="presentation"><div style="position:relative;aspect-ratio:16/9"><div data-testid="tweetPhoto" id="duration-video-${index}" style="width:320px;height:180px"><button aria-label="Play this video" style="width:320px;height:180px"><img src='${pixel}' width="320" height="180" alt="Video preview"></button></div><span id="duration-badge-${index}">${duration}</span></div></div>`;
  const second = mixed ? `<div role="presentation">${photo('duration-photo')}</div>` : videoPreview(2, '1:00');
  return `<div id="duration-outer"><div id="duration-padding" style="position:relative;padding-bottom:calc(73.3945% - 2.936px)"><nav id="duration-nav" role="navigation" style="position:absolute;inset:0"><div style="display:flex;height:100%"><div data-testid="ScrollSnap-prevButtonWrapper" style="width:30px;flex:none"><button id="duration-prev" aria-label="Previous" style="width:24px;height:24px"><svg width="12" height="12"><path d="M10 1L1 6L10 11"/></svg></button></div><div data-testid="ScrollSnap-SwipeableList" style="flex:1;min-width:0"><div data-testid="ScrollSnap-List" role="tablist" style="display:flex">${videoPreview(1, '0:15')}${second}</div></div><div data-testid="ScrollSnap-nextButtonWrapper" style="width:30px;flex:none"><button id="duration-next" aria-label="Next" style="width:24px;height:24px"><svg width="12" height="12"><path d="M1 1L10 6L1 11"/></svg></button></div></div>${caption}</nav></div></div>`;
};

for (const mixed of [false, true]) {
  test(`X ${mixed ? 'mixed photo/video' : 'multi-video'} duration carousel collapses completely and restores media, badges, and native controls`, async browser => {
    const quote = `<div role="link" data-testid="quoteTweet">${header('999', 'quoted')}<div data-testid="tweetText" id="duration-quote-caption">Quoted words must stay readable when media is hidden.</div>${durationCarousel({ mixed })}</div>`;
    const { page, context, errors } = await setup(browser, article({ media: '', quote }), '/home', () => {
      window.__durationNextClicks = 0;
      document.getElementById('duration-next').addEventListener('click', event => { event.preventDefault(); window.__durationNextClicks++; });
    });
    const height = () => page.locator('#duration-padding').evaluate(el => el.getBoundingClientRect().height);
    assert.equal(await height(), 0, 'Hidden video carousel must not retain percentage-based padding');
    assert.equal(await button(page).textContent(), mixed ? 'Show media' : 'Show video');
    assert.equal(await page.locator('#duration-quote-caption').isVisible(), true);
    assert.equal(await page.locator('[data-own-text]').isVisible(), true);
    assert.equal(await page.locator('#duration-badge-1').isVisible(), false);
    assert.equal(await page.locator('#duration-next').isVisible(), false);
    await button(page).click();
    assert.ok(await height() > 0, 'Revealing must restore the native carousel dimensions');
    assert.equal(await button(page).textContent(), mixed ? 'Hide media' : 'Hide video');
    const visibleIds = ['duration-video-1', 'duration-badge-1', 'duration-prev', 'duration-next', 'duration-quote-caption'];
    visibleIds.push(...(mixed ? ['duration-photo'] : ['duration-video-2', 'duration-badge-2']));
    for (const id of visibleIds) assert.equal(await page.locator(`#${id}`).isVisible(), true, `${id} should be restored`);
    await page.locator('#duration-next').click();
    assert.equal(await page.evaluate(() => window.__durationNextClicks), 1, 'Native navigation handler must survive');
    await page.locator('#duration-video-1').evaluate(preview => {
      const player = document.createElement('div');
      player.dataset.testid = 'videoPlayer';
      player.textContent = 'Pause Mute Playback speed 0:14 / 0:15';
      preview.append(player);
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('#duration-video-1').isVisible(), true, 'Late native player controls must not disrupt the revealed carousel');
    await button(page).click();
    assert.equal(await height(), 0, 'Hiding again must remove the entire media gap');
    assert.equal(await button(page).textContent(), mixed ? 'Show media' : 'Show video');
    assert.equal(await page.locator('#duration-quote-caption').isVisible(), true);
    assert.equal(await page.locator('.xt6-controls').count(), 1);
    assert.deepEqual(errors, []);
    await context.close();
  });
}

test('Carousel with nonmedia text keeps that text visible while its previews are hidden', async browser => {
  const media = durationCarousel({ caption: '<p id="duration-extra-caption">A plain caption outside the media previews must not disappear.</p>' });
  const { page, context, errors } = await setup(browser, article({ media }));
  assert.equal(await page.locator('#duration-extra-caption').isVisible(), true);
  assert.equal(await page.locator('#duration-video-1').isVisible(), false);
  assert.equal(await page.locator('[data-own-text]').isVisible(), true);
  await button(page).click();
  assert.equal(await page.locator('#duration-extra-caption').isVisible(), true);
  assert.equal(await page.locator('#duration-video-1').isVisible(), true);
  await button(page).click();
  assert.equal(await page.locator('#duration-extra-caption').isVisible(), true);
  assert.equal(await page.locator('#duration-video-1').isVisible(), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Fluid feed fills the space beside a slim native navigation rail at desktop and mobile widths', async browser => {
  const content = article();
  const navigation = `<header id="nav" role="banner"><div><div><div><nav role="navigation"><a href="/home" aria-label="Home" id="native-home"><div style="display:flex"><div><svg id="home-icon" width="24" height="24"><path d="M1 12L12 1L23 12V23H1Z"/></svg></div><div id="home-label">Home</div></div></a></nav><a href="/compose/post" aria-label="Post" id="native-post" data-testid="SideNav_NewTweet_Button" style="display:flex;background:rgb(29,155,240);color:white"><div><span>Post</span></div></a><div id="native-account" role="button" aria-label="Account menu" data-testid="SideNav_AccountSwitcher_Button" style="display:flex;box-sizing:border-box"><div><img src='${pixel}' width="40" height="40" alt="Alice"></div><div>Alice @alice</div><div>...</div></div></div></div></div></header>`;
  const html = pageHTML(content)
    .replace('</style>', '#app{display:flex;width:100%} #nav{display:flex;flex:1 1 auto;min-width:275px} #nav>div,#nav>div>div,#nav>div>div>div{width:275px} #nav>div>div{position:fixed} #nav>div>div>div{display:flex;flex-direction:column} main{flex:1 1 auto;width:auto} #main-inner{width:1050px} @media(max-width:499px){#nav{display:none}}</style>')
    .replace('<section aria-label="Timeline">', '<div id="native-cap" style="max-width:600px"><section aria-label="Timeline">')
    .replace('</section>', '</section></div>')
    .replace('<body><main>', `<body><div id="app">${navigation}<main><div id="main-inner">`)
    .replace('</main></body>', '</div></main></div></body>');
  const { page, context } = await setup(browser, content, '/home', undefined, { html, viewport: { width: 1440, height: 900 } });
  async function checkWidth(viewportWidth, expectedRail) {
    await page.setViewportSize({ width: viewportWidth, height: 900 });
    const column = await page.locator('[data-testid="primaryColumn"]').boundingBox();
    const expected = viewportWidth - expectedRail;
    assert.ok(Math.abs(column.width - expected) < 1, `Expected feed width${expected} at viewport${viewportWidth}, got ${column.width}`);
    assert.ok(Math.abs(column.x - expectedRail) < 1, `Expected feed to start after ${expectedRail}px rail, got ${column.x}`);
    assert.ok(Math.abs((await page.locator('#native-cap').boundingBox()).width - expected) < 1, 'Shared native 600px cap should be lifted');
    assert.ok(Math.abs((await page.locator('article').boundingBox()).width - expected) < 1, 'Posts should fill the available column');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at viewport${viewportWidth}`);
    if (expectedRail) {
      assert.ok(Math.abs((await page.locator('#nav').boundingBox()).width - 72) < 1);
      for (const selector of ['#nav>div', '#nav>div>div', '#nav>div>div>div']) assert.ok(Math.abs((await page.locator(selector).boundingBox()).width - 72) < 1, `${selector} must fit the rail`);
      assert.equal(await page.locator('#home-label').isVisible(), false);
      assert.equal(await page.locator('#home-icon').isVisible(), true);
    }
  }
  await checkWidth(1440, 72);
  assert.equal(await page.locator('#native-home').getAttribute('aria-label'), 'Home');
  assert.equal(await page.locator('#native-home').getAttribute('title'), 'Home');
  assert.equal(await page.locator('#native-post>div').evaluate(el => getComputedStyle(el, '::before').content), '"+"');
  await page.locator('#native-cap').evaluate(el => { el.className = 'native-rerender'; });
  await page.waitForFunction(() => document.getElementById('native-cap').classList.contains('xt6-feed-path'));
  await checkWidth(1440, 72);
  await checkWidth(500, 72);
  await checkWidth(390, 0);
  await context.close();
});

test('Media-only parent with quoted text keeps its reveal control outside hidden media', async browser => {
  const content = `<article data-testid="tweet" id="post-110" tabindex="0">${header('110')}<div aria-labelledby="quote-label"><div role="link" data-testid="quoteTweet">${header('990','quoted')}<div data-testid="tweetText" id="quote-label">Quoted caption</div>${photo('quoted-only-photo')}</div></div></article>`;
  const { page, context } = await setup(browser, content);
  assert.equal(await page.locator('#quote-label').isVisible(), true);
  await button(page).click();
  assert.equal(await page.locator('#quoted-only-photo').isVisible(), true);
  await context.close();
});

test('Own post identity takes precedence over quoted timestamp', async browser => {
  const content = article({ id: '111', media: photo('own-photo'), quote: quoted('999') }) + article({ id: '999', media: photo('standalone-quote-photo') });
  const { page, context } = await setup(browser, content);
  await button(page, '#post-111').click();
  assert.equal(await page.locator('#own-photo').isVisible(), true);
  assert.equal(await page.locator('#standalone-quote-photo').isVisible(), false);
  const keys = await page.locator('article').evaluateAll(items => items.map(item => item.getAttribute('data-xt6-key')));
  assert.notEqual(keys[0], keys[1]);
  await context.close();
});

test('Detail post without its own timestamp does not inherit quoted post identity', async browser => {
  const content = article({ id: '333', time: false, tab: '-1', media: photo('detail-photo'), quote: quoted('999') }) + article({ id: '999', media: photo('quote-as-reply-photo') });
  const { page, context } = await setup(browser, content, '/alice/status/333');
  await button(page, '#post-333').click();
  const key = await page.locator('#post-333').getAttribute('data-xt6-key');
  assert.ok(key && !key.includes('999'), `Must not borrow quoted status identity, got ${key}`);
  assert.equal(await page.locator('#quote-as-reply-photo').isVisible(), false);
  await context.close();
});

test('Same post remount preserves reveal and a different recycled post collapses', async browser => {
  const { page, context } = await setup(browser, article({ id: '201', media: photo('initial-photo') }));
  await button(page).click();
  await page.locator('#feed').evaluate((feed, html) => { feed.innerHTML = html; }, article({ id: '201', media: photo('remounted-photo') }));
  await page.waitForFunction(() => document.querySelector('#remounted-photo')?.classList.contains('xt6-media'));
  assert.equal(await page.locator('#remounted-photo').isVisible(), true);
  await page.locator('article').evaluate(post => { post.querySelector('a[href*="/status/"]').setAttribute('href', '/alice/status/202'); });
  await page.waitForFunction(() => document.querySelector('article')?.getAttribute('data-xt6-key')?.includes('202'));
  assert.equal(await page.locator('#remounted-photo').isVisible(), false);
  await context.close();
});

test('Recycled post without a new native permalink never borrows old Open post link', async browser => {
  const { page, context } = await setup(browser, article({ id: '601', media: photo('recycled-photo') }));
  await button(page).click();
  await page.locator('article').evaluate(post => {
    post.querySelector('[data-testid="User-Name"] a[href*="/status/"]').remove();
    post.querySelector('[data-own-text]').textContent = 'A different post is now mounted here.';
  });
  await page.waitForFunction(() => document.querySelector('article').getAttribute('data-xt6-key')?.startsWith('tmp:'));
  assert.equal(await page.locator('#recycled-photo').isVisible(), false);
  await context.close();
});

test('Starting in a hidden tab initializes correctly when the tab becomes visible', async browser => {
  const { page, context } = await setup(browser, article(), '/home', () => {
    window.__testHidden = true;
    Object.defineProperty(document, 'hidden', { get() { return window.__testHidden; } });
  });
  assert.equal(await button(page).count(), 0);
  await page.evaluate(() => {
    window.__testHidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await button(page).waitFor();
  assert.equal(await page.locator('#photo').isVisible(), false);
  await context.close();
});

test('Late media and entirely new posts are picked up incrementally', async browser => {
  const { page, context } = await setup(browser, article({ id: '301', media: '' }));
  await page.locator('#post-301').evaluate((post, html) => { post.insertAdjacentHTML('beforeend', html); }, photo('late-photo'));
  await button(page, '#post-301').waitFor();
  assert.equal(await page.locator('#late-photo').isVisible(), false);
  await button(page, '#post-301').click();
  assert.equal(await page.locator('#late-photo').isVisible(), true);
  await page.locator('#feed').evaluate((feed, html) => { feed.insertAdjacentHTML('beforeend', html); }, article({ id: '302', media: photo('new-post-photo') }));
  await button(page, '#post-302').waitFor();
  assert.equal(await page.locator('#new-post-photo').isVisible(), false);
  await context.close();
});

test('Inline links remain readable and hardened without a preview card', async browser => {
  const { page, context } = await setup(browser, article({ id: '401', body: 'Read <a id="inline-link" href="https://t.co/example" rel="ugc nofollow" target="_blank">this article</a>.', media: '' }));
  assert.equal(await page.locator('#inline-link').isVisible(), true);
  const rel = (await page.locator('#inline-link').getAttribute('rel')).split(/\s+/);
  for (const token of ['ugc', 'nofollow', 'noopener', 'noreferrer']) assert.ok(rel.includes(token), `Missing rel token ${token}`);
  await context.close();
});

test('Hidden video pauses; revealed video requires a player gesture before playback', async browser => {
  const video = '<div data-testid="videoComponent" id="video-wrap"><video id="video" width="320" height="180" controls></video></div>';
  const { page, context } = await setup(browser, article({ id: '501', media: video }), '/home', () => {
    const video = document.querySelector('video');
    video.__paused = false;
    video.__pauses = 0;
    Object.defineProperty(video, 'paused', { get() { return this.__paused; } });
    video.pause = function () { this.__pauses++; this.__paused = true; };
    video.__start = function () { this.__paused = false; this.dispatchEvent(new Event('play')); };
  });
  assert.ok(await page.locator('video').evaluate(video => video.__paused));
  await page.locator('video').evaluate(video => video.__start());
  assert.ok(await page.locator('video').evaluate(video => video.__paused));
  await button(page).click();
  await page.locator('video').evaluate(video => video.__start());
  assert.equal(await page.locator('video').evaluate(video => video.__paused), true);
  await page.locator('video').click({ position: { x: 20, y: 20 } });
  await page.locator('video').evaluate(video => video.__start());
  assert.equal(await page.locator('video').evaluate(video => video.__paused), false);
  await button(page).click();
  assert.equal(await page.locator('video').evaluate(video => video.__paused), true);
  await context.close();
});

test('Native controls retain handlers and media toggle does not trigger post navigation', async browser => {
  const { page, context } = await setup(browser, article(), '/home', () => {
    window.__nativeClicks = 0;
    window.__postClicks = 0;
    document.querySelector('[data-testid="like"]').addEventListener('click', () => window.__nativeClicks++);
    document.querySelector('article').addEventListener('click', () => window.__postClicks++);
  });
  await button(page).click();
  assert.equal(await page.evaluate(() => window.__postClicks), 0);
  await page.locator('[data-testid="like"]').click();
  assert.equal(await page.evaluate(() => window.__nativeClicks), 1);
  assert.equal(await page.evaluate(() => window.__postClicks), 1);
  await context.close();
});

test('Media and list controls settle without an idle animation-frame loop', async browser => {
  const { page, context } = await setup(browser, listHeader() + article(), '/i/lists/123', () => {
    window.__frames = 0;
    const original = window.requestAnimationFrame;
    window.requestAnimationFrame = function (callback) { window.__frames++; return original.call(window, callback); };
  });
  await page.waitForTimeout(5300);
  await button(page).click();
  await page.locator('button[data-xt6-action="list-details"]').click();
  await page.waitForTimeout(200);
  await page.evaluate(() => { window.__frames = 0; });
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.__frames), 0);
  await context.close();
});

test('No permanent interval scan and no duplicate controls after ordinary updates', async browser => {
  const { page, context, errors } = await setup(browser, article());
  await page.locator('article').evaluate(post => {
    for (let i = 0; i < 20; i++) {
      post.classList.toggle('x-native-change');
      post.querySelector('[data-testid="like"]').textContent = `Like ${i}`;
    }
  });
  await page.waitForTimeout(250);
  assert.equal(await button(page).count(), 1);
  assert.deepEqual(await page.evaluate(() => window.__intervals), []);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Unrelated sidebar updates do not rescan every post', async browser => {
  const { page, context } = await setup(browser, article(), '/home', () => {
    window.__documentArticleScans = 0;
    const original = Document.prototype.querySelectorAll;
    Document.prototype.querySelectorAll = function (selector) {
      if (/article/.test(selector)) window.__documentArticleScans++;
      return original.call(this, selector);
    };
  });
  await page.evaluate(() => { window.__documentArticleScans = 0; });
  await page.locator('[data-testid="sidebarColumn"]').evaluate(sidebar => { sidebar.innerHTML = '<div class="native-update">A new trend</div>'; });
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__documentArticleScans), 0);
  await context.close();
});

test('List header keeps title, counts, and Edit; details and cover toggle independently', async browser => {
  const { page, context } = await setup(browser, listHeader() + article(), '/i/lists/123');
  for (const id of ['list-title', 'list-stats', 'edit-list']) assert.equal(await page.locator(`#${id}`).isVisible(), true, `${id} should remain visible`);
  for (const id of ['list-description', 'list-owner', 'list-banner']) assert.equal(await page.locator(`#${id}`).isVisible(), false, `${id} should start hidden`);
  const details = page.locator('button[data-xt6-action="list-details"]');
  const cover = page.locator('button[data-xt6-action="list-cover"]');
  await details.click();
  assert.equal(await page.locator('#list-description').isVisible(), true);
  assert.equal(await page.locator('#list-banner').isVisible(), false);
  await cover.click();
  assert.equal(await page.locator('#list-banner').isVisible(), true);
  await details.click();
  assert.equal(await page.locator('#list-description').isVisible(), false);
  assert.equal(await page.locator('#list-banner').isVisible(), true);
  const hierarchy = await page.locator('#list-info').evaluate(info => [...info.children].filter(child => !child.classList.contains('xt6-ui')).map(child => child.id));
  assert.deepEqual(hierarchy, ['list-title', 'list-description', 'list-owner', 'list-stats', 'edit-list']);
  await page.locator('#list-cell').evaluate((cell, html) => { cell.outerHTML = html; }, listHeader());
  await page.locator('button[data-xt6-action="list-cover"]').waitFor();
  assert.equal(await page.locator('#list-banner').isVisible(), true);
  assert.equal(await page.locator('#list-description').isVisible(), false);
  await context.close();
});

test('Links to list member/follower pages inside posts are never treated as a list header', async browser => {
  const body = 'Read about <a href="/i/lists/123/members">members</a> and <a href="/i/lists/123/followers">followers</a>.';
  const { page, context } = await setup(browser, article({ body, media: '' }), '/i/lists/123');
  assert.equal(await page.locator('[data-own-text]').isVisible(), true);
  assert.equal(await page.locator('.xt6-list-header').count(), 0);
  await context.close();
});

(async () => {
  const browser = await chromium.launch(launchOptions());
  const results = [];
  try {
    for (const { name, run } of tests.filter(test => !filter || filter.test(test.name))) {
      try { await run(browser); results.push({ name, pass: true }); console.log(`PASS ${name}`); }
      catch (error) { results.push({ name, pass: false, error: error.stack }); console.log(`FAIL ${name}\n${error.stack}`); }
    }
  } finally { await browser.close(); }
  writeResults('regression-results.json', { sourcePath, sourceSHA256: require('node:crypto').createHash('sha256').update(source).digest('hex'), results });
  const failures = results.filter(result => !result.pass);
  console.log(`${results.length - failures.length}/${results.length} regression cases passed.`);
  if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
