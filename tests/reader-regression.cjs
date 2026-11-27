const fs = require('node:fs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const { launchOptions, writeResults } = require('./helpers.cjs');
const sourcePath = process.argv[2] || `${__dirname}/../dist/x-text-reader.user.js`;
const source = fs.readFileSync(sourcePath, 'utf8');
const filter = process.argv[3] ? new RegExp(process.argv[3], 'i') : null;
const pixel = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="blue"/></svg>';
const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const post = (id, options = {}) => ({
  id_str: String(id), full_text: options.preview || options.text || `Post ${id}.`,
  conversation_id_str: String(options.conversation || '101'),
  user: {id_str: String(options.authorId || '10'), screen_name: options.handle || 'alice', name: options.name || 'Alice'},
  ...(options.parent ? {in_reply_to_status_id_str:String(options.parent),in_reply_to_user_id_str:String(options.parentAuthor || '10')} : {}),
  ...(options.full ? {note_tweet:{id:`note-${id}`,is_expandable:true,text:options.full,entity_set:{urls:options.links || []}}} : {}),
  ...(options.media ? {extended_entities:{media:[{type:'photo',media_url_https:'https://pbs.twimg.com/media/test.jpg',ext_alt_text:'Example photo'}]}} : {}),
  entities:{urls:options.links || []}, created_at:'Fri Nov 27 00:00:00 +0000 2026', reply_count:options.replyCount ?? 0,
});
function article(raw, index, options = {}) {
  const actual = raw.retweeted_status || raw;
  return `<article data-testid="tweet" id="post-${actual.id_str}-${index}" data-fixture="${index}"><div data-testid="User-Name"><a href="/${actual.user.screen_name}">${escape(actual.user.name)}</a><a href="/${actual.user.screen_name}/status/${actual.id_str}"><time datetime="2026-11-27T00:00:00Z">1h</time></a></div><div data-testid="tweetText">${escape(actual.full_text)}</div>${actual.note_tweet ? '<button data-testid="tweet-text-show-more-link">Show more</button>' : ''}${options.media ? `<div data-testid="tweetPhoto" style="width:320px;height:180px"><img src='${pixel}' width="320" height="180" alt="Example photo"></div>` : ''}<div role="group"><button data-testid="reply">Reply</button><button data-testid="like">Like</button></div></article>`;
}
function html(rows) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;color:#eee;background:#000;font:17px/1.4 Arial}#app{display:flex;width:100%}header[role=banner]{width:275px;flex:0 0 275px}main{display:flex;flex:1;min-width:0}#native-wrapper{width:100%}[data-testid=primaryColumn]{width:600px;max-width:600px}article{padding:16px;border-bottom:1px solid #444;box-sizing:border-box}button{padding:5px}[data-testid=sidebarColumn]{width:300px}</style></head><body><div id="app"><header role="banner"><div><div><div><nav role="navigation"><a href="/home" aria-label="Home"><div><div><svg width="24" height="24"></svg></div><div>Home</div></div></a></nav></div></div></div></header><main><div id="native-wrapper"><div data-testid="primaryColumn"><section aria-label="Timeline"><div id="feed">${rows.map((r,i)=>article(r,i,{media:!!(r.retweeted_status||r).extended_entities})).join('')}</div></section></div></div><aside data-testid="sidebarColumn">Trends</aside></main></div></body></html>`;
}
async function attach(page, rows) {
  await page.evaluate(rows => {
    window.__fixtureRows = rows;
    // X handles status links as in-page navigation; preserve the document just
    // as its native router does while the reader dialog remains mounted.
    document.addEventListener('click', event => {
      const anchor = event.target.closest?.('article a[href*="/status/"]');
      if (!anchor) return;
      event.preventDefault();
      history.pushState({}, '', new URL(anchor.href).pathname + location.hash);
    });
    for (const el of document.querySelectorAll('article[data-fixture]')) {
      const raw = rows[Number(el.dataset.fixture)];
      let fiber = {memoizedProps:{tweet:raw},return:null};
      for (let depth=0;depth<14;depth++) fiber={memoizedProps:{children:null},return:fiber};
      el.__reactFiber$fixture = fiber;
    }
  }, rows);
}
async function setup(browser, rows, pathname = '/home', {init,viewport} = {}) {
  const context = await browser.newContext({viewport:viewport||{width:1440,height:900}});
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>route.fulfill({status:200,contentType:'text/html',body:html(rows)}));
  await page.goto(`https://x.com${pathname}`);
  await attach(page,rows);
  if(init) await page.evaluate(init);
  await page.addScriptTag({content:source});
  await page.locator('.xt6-reading-controls').first().waitFor();
  return {context,page,errors};
}
const tests=[];
const test=(name,run)=>tests.push({name,run});
const readControls=(page,id)=>page.locator(`article[id^="post-${id}-"]`).first().locator('.xt6-reading-controls');
const expansion=(page,id)=>readControls(page,id).locator('[data-xt6-action="expand-text"]');
async function stopLoading(page) {
  const stop=page.getByRole('button',{name:'Stop loading',exact:true});
  if(await stop.count()&&await stop.isVisible()) await stop.click();
}

test('Long post expands original full text and links without revealing media; collapse restores native preview',async browser=>{
  const full='A much longer original post.\n\nRead https://t.co/reader-test for the complete explanation. The final sentence must be visible.';
  const rows=[post('101',{preview:'A much longer original post…',full,media:true,links:[{url:'https://t.co/reader-test',expanded_url:'https://example.com/guide',display_url:'example.com/guide'}]})];
  const {page,context,errors}=await setup(browser,rows);
  try{
    assert.equal(await page.locator('[data-testid="tweetPhoto"]').isVisible(),false);
    await expansion(page,'101').click();
    const expanded=page.locator('.xt6-expanded-text');
    assert.equal(await expanded.isVisible(),true);
    assert.match(await expanded.innerText(),/The final sentence must be visible/);
    assert.equal(await expanded.locator('a[href="https://example.com/guide"]').count(),1);
    assert.equal(await page.locator('article [data-testid="tweetText"]').isVisible(),false);
    assert.equal(await page.locator('[data-testid="tweetPhoto"]').isVisible(),false);
    await expansion(page,'101').click();
    assert.equal(await expanded.isVisible(),false);
    assert.equal(await page.locator('article [data-testid="tweetText"]').isVisible(),true);
    assert.equal(await page.locator('[data-testid="tweetPhoto"]').isVisible(),false);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('Hydrated and recycled posts keep one reading control and use the current full text',async browser=>{
  const rows=[post('101',{parent:'100',preview:'Before hydration…',full:'Before hydration complete text.'})];
  const {page,context,errors}=await setup(browser,rows);
  try{
    assert.equal(await readControls(page,'101').locator('[data-xt6-action="thread"]').innerText(),'Read thread');
    const next=post('102',{preview:'New post preview…',full:'New post entire text after native element recycling.'});
    await page.locator('article').evaluate((article,next)=>{
      article.querySelector('a[href*="/status/"]').href=`/${next.user.screen_name}/status/${next.id_str}`;
      article.querySelector('[data-testid="tweetText"]').textContent=next.full_text;
      let fiber={memoizedProps:{tweet:next},return:null};
      for(let depth=0;depth<14;depth++) fiber={memoizedProps:{children:null},return:fiber};
      article.__reactFiber$fixture=fiber;
      article.classList.add('native-recycled');
    },next);
    await page.waitForFunction(()=>document.querySelector('article').getAttribute('data-xt6-key')==='id:102');
    await page.locator('article .xt6-reading-controls [data-xt6-action="expand-text"]').click();
    assert.match(await page.locator('.xt6-expanded-text').innerText(),/New post entire text/);
    assert.doesNotMatch(await page.locator('.xt6-expanded-text').innerText(),/Before hydration complete/);
    assert.equal(await page.locator('.xt6-reading-controls').count(),1);
    assert.equal(await page.locator('.xt6-reading-controls [data-xt6-action="thread"]').count(),1);
    assert.equal(await page.locator('.xt6-reading-controls [data-xt6-action="thread"]').innerText(),'Read post');
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('Thread reader orders and deduplicates self replies and excludes author replies to commenters',async browser=>{
  const rows=[post('103',{parent:'102',text:'Third connected paragraph.'}),post('110',{parent:'200',parentAuthor:'20',text:'AUTHOR ANSWER TO COMMENTER MUST BE EXCLUDED'}),post('101',{text:'First connected paragraph.'}),post('200',{authorId:'20',handle:'bob',parent:'101',parentAuthor:'10',text:'COMMENT MUST BE EXCLUDED'}),post('102',{parent:'101',text:'Second connected paragraph.'}),post('102',{parent:'101',text:'Second connected paragraph.'})];
  const {page,context,errors}=await setup(browser,rows,'/alice/status/101#xt6-reader=thread');
  try{
    const dialog=page.locator('#xt6-reader-dialog');
    await dialog.waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelectorAll('#xt6-reader-dialog .xt6-reader-post').length>=3);
    await stopLoading(page);
    assert.deepEqual(await dialog.locator('.xt6-reader-post').evaluateAll(posts=>posts.map(p=>p.dataset.postId)),['101','102','103']);
    const text=await dialog.innerText();
    for(const paragraph of ['First connected paragraph.','Second connected paragraph.','Third connected paragraph.'])assert.ok(text.includes(paragraph));
    assert.doesNotMatch(text,/AUTHOR ANSWER TO COMMENTER MUST BE EXCLUDED|COMMENT MUST BE EXCLUDED/);
    assert.doesNotMatch(text,/3\s*\/\s*3\s*(?:complete|posts)|entire thread loaded/i);
    const viewport=await page.evaluate(()=>document.documentElement.clientWidth);
    const box=await dialog.boundingBox();
    assert.ok(box.width>=viewport-100,`Reader should keep wide layout; got ${box.width} of ${viewport}`);
    await page.getByRole('button',{name:'Close reader',exact:true}).click();
    if(!page.isClosed())assert.equal(await dialog.isVisible(),false);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('On-demand continuation loading adds connected parts while excluding ordinary comments',async browser=>{
  const rows=[post('101',{text:'Opening paragraph.'})];
  const {page,context,errors}=await setup(browser,rows,'/alice/status/101#xt6-reader=thread',{init:()=>{
    window.__continuationClicks=0;
    const continuation=document.createElement('button');
    continuation.id='native-continuation';continuation.textContent='Show more replies';
    document.getElementById('feed').append(continuation);
    continuation.addEventListener('click',()=>{
      window.__continuationClicks++;
      if(window.__continuationClicks>1)return;
      for(const info of [{id:'102',author:'10',handle:'alice',text:'Connected continuation loaded on demand.'},{id:'200',author:'20',handle:'bob',text:'Ordinary reply should remain outside the reader.'}]){
        const article=document.createElement('article');article.dataset.testid='tweet';article.id=`loaded-${info.id}`;
        article.innerHTML=`<div data-testid="User-Name"><a href="/${info.handle}">${info.handle}</a><a href="/${info.handle}/status/${info.id}"><time>1h</time></a></div><div data-testid="tweetText">${info.text}</div><div role="group"><button>Reply</button></div>`;
        let fiber={memoizedProps:{tweet:{id_str:info.id,full_text:info.text,user:{id_str:info.author,screen_name:info.handle,name:info.handle},in_reply_to_status_id_str:'101',in_reply_to_user_id_str:'10',conversation_id_str:'101'}},return:null};
        for(let depth=0;depth<14;depth++)fiber={memoizedProps:{children:null},return:fiber};
        article.__reactFiber$fixture=fiber;
        continuation.before(article);
      }
      continuation.remove();
    });
  }});
  try{
    await page.locator('#xt6-reader-dialog').waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelectorAll('#xt6-reader-dialog .xt6-reader-post').length===2);
    await stopLoading(page);
    assert.equal(await page.evaluate(()=>window.__continuationClicks),1);
    assert.deepEqual(await page.locator('#xt6-reader-dialog .xt6-reader-post').evaluateAll(posts=>posts.map(p=>p.dataset.postId)),['101','102']);
    assert.match(await page.locator('#xt6-reader-dialog').innerText(),/Connected continuation loaded on demand/);
    assert.doesNotMatch(await page.locator('#xt6-reader-dialog').innerText(),/Ordinary reply should remain outside/);
    const y=await page.evaluate(()=>scrollY);
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(()=>scrollY),y,'Stopping should cancel later loader scrolling');
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('Read thread opens a detected thread in a separate reader tab without moving the feed',async browser=>{
  const {page,context,errors}=await setup(browser,[post('101',{text:'A post that starts a thread.'}),post('102',{parent:'101'})]);
  try{
    await page.waitForFunction(()=>document.querySelector('#post-101-0 [data-xt6-action="thread"]')?.textContent==='Read thread');
    const original=page.url();
    const popupWait=page.waitForEvent('popup');
    await readControls(page,'101').locator('[data-xt6-action="thread"]').click();
    const popup=await popupWait;
    await popup.waitForLoadState('domcontentloaded');
    assert.equal(page.url(),original);
    assert.equal(new URL(popup.url()).pathname,'/alice/status/101');
    assert.match(new URL(popup.url()).hash,/xt6-reader=thread/);
    assert.deepEqual(errors,[]);
    await popup.close();
  }finally{await context.close();}
});

test('Read post opens a standalone post reader while text hints and other-author replies stay unclassified',async browser=>{
  const rows=[post('101',{text:'Thread 1/5',replyCount:50}),post('102',{text:'2/5 Same author but no reply link.'}),post('200',{authorId:'20',handle:'bob',parent:'101',parentAuthor:'10'}),post('110',{parent:'200',parentAuthor:'20'})];
  const {page,context,errors}=await setup(browser,rows);
  try{
    await page.waitForFunction(()=>document.querySelectorAll('.xt6-reading-controls [data-xt6-action="thread"]').length===4);
    assert.deepEqual(await page.locator('.xt6-reading-controls [data-xt6-action="thread"]').allTextContents(),['Read post','Read post','Read post','Read post']);
    const original=page.url(),popupWait=page.waitForEvent('popup');
    await readControls(page,'101').getByRole('button',{name:'Read post',exact:true}).click();
    const popup=await popupWait;
    await popup.waitForLoadState('domcontentloaded');
    assert.equal(page.url(),original);
    assert.equal(new URL(popup.url()).pathname,'/alice/status/101');
    assert.equal(new URL(popup.url()).hash,'#xt6-reader=post');
    await popup.close();
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('A late same-author child updates the existing parent label and click target without reprocessing the parent',async browser=>{
  const {page,context,errors}=await setup(browser,[post('101')]);
  try{
    assert.equal(await readControls(page,'101').locator('[data-xt6-action="thread"]').innerText(),'Read post');
    const child=post('102',{parent:'101'});
    await page.evaluate(({markup,raw})=>{
      const template=document.createElement('template');template.innerHTML=markup;
      const child=template.content.firstElementChild;
      let fiber={memoizedProps:{tweet:raw},return:null};
      for(let depth=0;depth<14;depth++)fiber={memoizedProps:{children:null},return:fiber};
      child.__reactFiber$fixture=fiber;
      document.getElementById('feed').append(child);
    },{markup:article(child,1),raw:child});
    await page.waitForFunction(()=>document.querySelector('#post-101-0 [data-xt6-action="thread"]')?.textContent==='Read thread');
    assert.equal(await readControls(page,'102').locator('[data-xt6-action="thread"]').innerText(),'Read thread');
    const popupWait=page.waitForEvent('popup');
    await readControls(page,'101').getByRole('button',{name:'Read thread',exact:true}).click();
    const popup=await popupWait;
    await popup.waitForLoadState('domcontentloaded');
    assert.equal(new URL(popup.url()).hash,'#xt6-reader=thread');
    await popup.close();
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('A self-reply with an unloaded parent is labeled Read thread while DOM-only posts remain Read post',async browser=>{
  const {page,context,errors}=await setup(browser,[post('102',{parent:'101'}),post('104',{parent:'103'})],'/home',{init:()=>{
    delete document.querySelector('#post-104-1').__reactFiber$fixture;
  }});
  try{
    await page.waitForFunction(()=>document.querySelectorAll('.xt6-reading-controls [data-xt6-action="thread"]').length===2);
    assert.equal(await readControls(page,'102').locator('[data-xt6-action="thread"]').innerText(),'Read thread');
    assert.equal(await readControls(page,'104').locator('[data-xt6-action="thread"]').innerText(),'Read post');
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('Reader clicks recheck newly hydrated self-reply metadata before the next label refresh',async browser=>{
  const {page,context,errors}=await setup(browser,[post('102')]);
  try{
    assert.equal(await readControls(page,'102').locator('[data-xt6-action="thread"]').innerText(),'Read post');
    const popupWait=page.waitForEvent('popup');
    await page.locator('article').evaluate((article,raw)=>{
      let fiber={memoizedProps:{tweet:raw},return:null};
      for(let depth=0;depth<14;depth++)fiber={memoizedProps:{children:null},return:fiber};
      article.__reactFiber$fixture=fiber;
      article.querySelector('[data-xt6-action="thread"]').click();
    },post('102',{parent:'101'}));
    const popup=await popupWait;
    await popup.waitForLoadState('domcontentloaded');
    assert.equal(new URL(popup.url()).hash,'#xt6-reader=thread');
    await popup.close();
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('Automatic long-post expansion is optional and settings retain the full-width feed',async browser=>{
  const {page,context,errors}=await setup(browser,[post('101',{preview:'Short preview…',full:'Full original text visible after enabling automatic expansion.'})]);
  try{
    assert.equal(await page.locator('.xt6-expanded-text').isVisible(),false);
    const column=page.locator('[data-testid="primaryColumn"]');
    const before=await column.boundingBox();
    assert.ok(Math.abs(before.width-1368)<1,`Expected full width beside72px rail, got ${before.width}`);
    await page.getByRole('button',{name:'Reading settings',exact:true}).click();
    await page.locator('#xt6-setting-autoExpand').check();
    await page.locator('#xt6-setting-fontSize').selectOption('20');
    await page.getByRole('button',{name:'Done',exact:true}).click();
    await page.locator('.xt6-expanded-text').waitFor({state:'visible'});
    assert.match(await page.locator('.xt6-expanded-text').innerText(),/Full original text/);
    assert.equal(await page.locator('.xt6-expanded-text').evaluate(el=>getComputedStyle(el).fontSize),'20px');
    assert.ok(Math.abs((await column.boundingBox()).width-before.width)<1);
    assert.equal(await page.locator('[data-xt6-action="thread"]').count(),1);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('Retweeted long post expands the original author text rather than the wrapper',async browser=>{
  const original=post('101',{preview:'Original author preview…',full:'Original author full text, all the way to the final line.'});
  const wrapper={...post('901',{authorId:'30',handle:'reposter',text:'RT @alice Original author preview…'}),retweeted_status:original};
  const {page,context,errors}=await setup(browser,[wrapper]);
  try{
    await expansion(page,'101').click();
    assert.match(await page.locator('.xt6-expanded-text').innerText(),/Original author full text/);
    assert.doesNotMatch(await page.locator('.xt6-expanded-text').innerText(),/^RT @alice/);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('Post reader waits for native long-text hydration instead of stopping at a DOM preview',async browser=>{
  const raw=post('101',{preview:'Only the preview is initially loaded…',full:'The native expansion supplied this complete long post and its final sentence.'});
  const {page,context,errors}=await setup(browser,[raw],'/alice/status/101#xt6-reader=post',{init:()=>{
    const article=document.querySelector('article');
    delete article.__reactFiber$fixture;
    window.__nativeExpandClicks=0;
    article.querySelector('[data-testid="tweet-text-show-more-link"]').addEventListener('click',()=>{
      window.__nativeExpandClicks++;
      setTimeout(()=>{
        let fiber={memoizedProps:{tweet:window.__fixtureRows[0]},return:null};
        for(let depth=0;depth<14;depth++)fiber={memoizedProps:{children:null},return:fiber};
        article.__reactFiber$fixture=fiber;
        article.querySelector('[data-testid="tweetText"]').textContent=window.__fixtureRows[0].note_tweet.text;
        article.querySelector('[data-testid="tweet-text-show-more-link"]').remove();
      },200);
    });
  }});
  try{
    await page.locator('#xt6-reader-dialog').waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('#xt6-reader-dialog .xt6-reader-text')?.textContent.includes('final sentence.'));
    assert.equal(await page.evaluate(()=>window.__nativeExpandClicks),1);
    assert.match(await page.locator('.xt6-reader-status').innerText(),/Full post text/);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('An open reader updates hydrated full text even after loading is stopped',async browser=>{
  const {page,context,errors}=await setup(browser,[post('101',{text:'A short initial post preview.'})],'/alice/status/101#xt6-reader=thread');
  try{
    await page.locator('#xt6-reader-dialog').waitFor({state:'visible'});
    await stopLoading(page);
    const next=post('101',{preview:'A short initial post preview.',full:'Later hydration delivered the complete post, including this distinctive ending.'});
    await page.locator('article').evaluate((article,next)=>{
      let fiber={memoizedProps:{tweet:next},return:null};
      for(let depth=0;depth<14;depth++)fiber={memoizedProps:{children:null},return:fiber};
      article.__reactFiber$fixture=fiber;article.classList.add('native-hydrated');
    },next);
    await page.waitForFunction(()=>document.querySelector('#xt6-reader-dialog .xt6-reader-text')?.textContent.includes('distinctive ending.'));
    assert.equal(await page.locator('#xt6-reader-dialog .xt6-reader-post').count(),1);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('Recycling into media-only content removes old text and retains the current post reader control',async browser=>{
  const {page,context,errors}=await setup(browser,[post('101',{preview:'Old preview…',full:'Old complete text that must never remain on a new media-only post.',media:true})]);
  try{
    await expansion(page,'101').click();
    const next=post('102',{text:'',media:true});
    await page.locator('article').evaluate((article,next)=>{
      article.querySelector('a[href*="/status/"]').href='/alice/status/102';
      article.querySelector('[data-testid="tweetText"]').remove();
      article.querySelector('[data-testid="tweet-text-show-more-link"]').remove();
      let fiber={memoizedProps:{tweet:next},return:null};
      for(let depth=0;depth<14;depth++)fiber={memoizedProps:{children:null},return:fiber};
      article.__reactFiber$fixture=fiber;article.classList.add('native-media-only');
    },next);
    await page.waitForFunction(()=>document.querySelector('article').getAttribute('data-xt6-key')==='id:102');
    assert.equal(await page.locator('.xt6-expanded-text').count(),0);
    assert.equal(await page.locator('.xt6-reading-controls').count(),1);
    assert.equal(await page.locator('.xt6-reading-controls [data-xt6-action="expand-text"]').isVisible(),false);
    const popupWait=page.waitForEvent('popup');
    await page.locator('.xt6-reading-controls [data-xt6-action="thread"]').click();
    const popup=await popupWait;
    await popup.waitForLoadState('domcontentloaded');
    assert.equal(new URL(popup.url()).pathname,'/alice/status/102');
    assert.equal(new URL(popup.url()).hash,'#xt6-reader=post');
    await popup.close();
    assert.equal(await page.locator('[data-testid="tweetPhoto"]').isVisible(),false);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('Disabling automatic expansion collapses automatic posts and preserves manually expanded posts',async browser=>{
  const rows=[post('101',{preview:'Manual preview…',full:'Manually expanded full text should remain expanded.'}),post('102',{preview:'Automatic preview…',full:'Automatically expanded full text should return to its preview.'})];
  const {page,context,errors}=await setup(browser,rows);
  try{
    await expansion(page,'101').click();
    await page.getByRole('button',{name:'Reading settings',exact:true}).click();
    await page.locator('#xt6-setting-autoExpand').check();
    await page.getByRole('button',{name:'Done',exact:true}).click();
    assert.equal(await page.locator('.xt6-expanded-text').count(),2);
    await page.getByRole('button',{name:'Reading settings',exact:true}).click();
    await page.locator('#xt6-setting-autoExpand').uncheck();
    await page.getByRole('button',{name:'Done',exact:true}).click();
    assert.equal(await page.locator('article[id^="post-101-"] .xt6-expanded-text').isVisible(),true);
    assert.equal(await page.locator('article[id^="post-102-"] .xt6-expanded-text').isVisible(),false);
    assert.equal(await page.locator('article[id^="post-102-"] [data-testid="tweetText"]').isVisible(),true);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

(async()=>{
  const browser=await chromium.launch(launchOptions());
  const results=[];
  try{
    for(const {name,run} of tests.filter(t=>!filter||filter.test(t.name))){
      try{await run(browser);results.push({name,pass:true});console.log(`PASS ${name}`);}
      catch(error){results.push({name,pass:false,error:error.stack});console.log(`FAIL ${name}\n${error.stack}`);}
    }
  }finally{await browser.close();}
  writeResults('reader-regression-results.json', {sourcePath,sourceSHA256:crypto.createHash('sha256').update(source).digest('hex'),results});
  console.log(`${results.filter(r=>r.pass).length}/${results.length} reader integration cases passed.`);
  if(results.some(r=>!r.pass))process.exitCode=1;
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
