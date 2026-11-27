const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { launchOptions } = require('./helpers.cjs');
const source = fs.readFileSync(`${__dirname}/../src/reader-data.js`, 'utf8');
(async()=>{
  const browser=await chromium.launch(launchOptions());
  try {
    const page=await browser.newPage();
    await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8"><main><article data-testid="tweet" id="a"><div data-testid="User-Name"><a href="/alice">Alice</a><a href="/alice/status/100"><time>1h</time></a></div><div data-testid="tweetText">Short preview</div><button data-testid="tweet-text-show-more-link">Show more</button><div role="link"><div data-testid="User-Name"><a href="/bob/status/900"><time>2h</time></a></div><div data-testid="tweetText">Quoted content</div></div></article><article data-testid="tweet" id="b"><div data-testid="User-Name"><a href="/alice">Alice</a><a href="/alice/status/101"><time>1h</time></a></div><div data-testid="tweetText">Plain text <img alt="🌱"><br>Next line</div></article></main>`}));
    await page.goto('https://x.com/home');
    await page.evaluate(()=>{
      let top={memoizedProps:{tweet:{id_str:'200',full_text:'Repost preview',user:{id_str:'22',screen_name:'bob',name:'Bob'},retweeted_status:{id_str:'100',full_text:'Short preview',user:{id_str:'11',screen_name:'alice',name:'Alice'},note_tweet:{is_expandable:true,text:'The entire long post from the observed native React data.',entity_set:{urls:[]}}}}}};
      for(let n=0;n<14;n++)top={memoizedProps:{children:null},return:top};
      document.getElementById('a').__reactFiber$readerTest=top;
    });
    await page.addScriptTag({content:source+';globalThis.rd=readerData;'});
    const posts=await page.evaluate(()=>rd.collect());
    assert.equal(posts.length,2);
    assert.equal(posts[0].id,'100');
    assert.equal(posts[0].text,'The entire long post from the observed native React data.');
    assert.equal(posts[0].source,'react');
    assert.equal(posts[0].fullText,true);
    assert.equal(posts[1].text,'Plain text 🌱\nNext line');
    assert.equal(posts[1].source,'dom');
    assert.equal(await page.evaluate(()=>rd.chain('100').posts.length),1);
    assert.equal(await page.evaluate(()=>rd.get('900')),null);
    console.log('PASS Native fiber 14 levels up yields original full note; quote excluded; DOM fallback preserves emoji/newlines and does not infer same-author thread');
    // Native data replaces an earlier DOM-only copy even if the DOM looked complete.
    await page.evaluate(()=>{
      document.getElementById('b').__reactProps$readerTest={tweet:{id_str:'101',full_text:'Still truncated native note',user:{id_str:'11',screen_name:'alice',name:'Alice'},note_tweet:{is_expandable:true}}};
      rd.collect(document.getElementById('b'));
    });
    assert.equal(await page.evaluate(()=>rd.get('101').fullText),false);
    assert.equal(await page.evaluate(()=>rd.get('101').text),'Still truncated native note');
    console.log('PASS Native truncation metadata overrides uncertain DOM completeness');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
