const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(`${__dirname}/../src/reader-data.js`, 'utf8');
function instance() {
  const context = { URL, location: { href: 'https://x.com/home' } };
  vm.createContext(context);
  vm.runInContext(`${source};globalThis.rd = readerData;`, context);
  return context.rd;
}
const tweet = (id, parentId = null, authorId = '11', extra = {}) => ({ rest_id: id, legacy: { full_text: `Post ${id}`, user_id_str: authorId, in_reply_to_status_id_str: parentId, in_reply_to_user_id_str: parentId ? authorId : null, conversation_id_str: '100', ...extra }, core: { user_results: { result: { rest_id: authorId, core: { screen_name: authorId === '11' ? 'alice' : 'bob', name: authorId === '11' ? 'Alice' : 'Bob' } } } } });
const pass = name => console.log(`PASS ${name}`);
{
  const rd = instance();
  const raw = tweet('100');
  raw.note_tweet = { note_tweet_results: { result: { text: 'A longer note &amp; link https://t.co/abc', entity_set: { urls: [{ url: 'https://t.co/abc', expanded_url: 'https://example.com/read', display_url: 'example.com/read' }] } } } };
  const post = rd.ingest(raw);
  assert.equal(post.text, 'A longer note & link https://example.com/read');
  assert.equal(post.fullText, true);
  assert.equal(post.authorId, '11');
  assert.equal(post.handle, 'alice');
  assert.equal(post.href, 'https://x.com/alice/status/100');
  pass('Full note text, entities, and current user core fields normalize');
}
{
  const rd = instance();
  for (const t of [tweet('100'), tweet('101','100'), tweet('102','101'), tweet('200','100','22'), tweet('201','200','11')]) rd.ingest(t);
  const c = rd.chain('101');
  assert.equal(c.posts.map(p=>p.id).join(','), '100,101,102');
  assert.equal(c.verified, true);
  assert.equal(c.complete, false);
  pass('Exact self-reply chain excludes author replies to other people');
}
{
  const rd = instance();
  rd.ingest(tweet('101','100'));
  assert.equal(rd.chain('101').missingParentId, '100');
  rd.ingest(tweet('100',null,'22'));
  assert.equal(rd.chain('101').posts.map(p=>p.id).join(','), '101');
  pass('Missing parent is surfaced but a different author is not merged');
}
{
  const rd = instance();
  for (const t of [tweet('100'),tweet('101','100'),tweet('102','100')]) rd.ingest(t);
  const c=rd.chain('100');
  assert.equal(c.posts.length, 1);
  assert.equal(c.branches[0].ids.join(','),'101,102');
  assert.equal(rd.chain('102').posts.map(p=>p.id).join(','),'100,102');
  pass('Ambiguous branches remain separate; selected branch keeps its ancestry');
}
{
  const rd=instance();
  const raw=tweet('100',null,'11',{truncated:true});
  raw.note_tweet={is_expandable:true};
  assert.equal(rd.normalize(raw).fullText,false);
  raw.note_tweet.note_tweet_results={result:{text:'Full available long post'}};
  rd.ingest(raw);
  rd.ingest(tweet('100',null,'11',{truncated:true,full_text:'Short preview'}));
  assert.equal(rd.get('100').text,'Full available long post');
  assert.equal(rd.get('100').fullText,true);
  pass('Full text survives later truncated copies');
}
{
  const rd=instance();
  const raw=tweet('100');
  raw.quoted_status_result={result:tweet('900',null,'22')};
  raw.legacy.extended_entities={media:[{type:'photo',media_url_https:'https://pbs.twimg.com/media/photo.jpg',ext_alt_text:'Photo description'}, {type:'video',media_url_https:'https://pbs.twimg.com/media/poster.jpg',video_info:{variants:[{content_type:'application/x-mpegURL',url:'https://video.twimg.com/video.m3u8'},{content_type:'video/mp4',bitrate:256000,url:'https://video.twimg.com/small.mp4'},{content_type:'video/mp4',bitrate:2176000,url:'https://video.twimg.com/medium.mp4'},{content_type:'video/mp4',bitrate:8000000,url:'https://video.twimg.com/large.mp4'}]}}]};
  const post=rd.ingest(raw);
  assert.equal(post.quote.id,'900');
  assert.equal(rd.get('900'),null);
  assert.equal(post.media[0].alt,'Photo description');
  assert.equal(post.media[1].url,'https://video.twimg.com/medium.mp4');
  pass('Quote remains quoted and media retains safe bounded choices');
}
{
  const rd=instance();
  for(let n=1000;n<1520;n++) rd.ingest(tweet(String(n)));
  assert.equal(rd.size(),500);
  assert.equal(rd.get('1000'),null);
  assert.equal(rd.get('1519').id,'1519');
  assert.equal(rd.normalize({rest_id:'5',legacy:{description:'A user'}}),null);
  pass('Cache is bounded and unrelated objects are rejected');
}
{
  const rd=instance();
  const original={id_str:'100',full_text:'Short preview',user:{id_str:'11',screen_name:'alice',name:'Alice'},note_tweet:{id:'9999',is_expandable:true,text:'Full flattened note text https://t.co/note',entity_set:{urls:[{url:'https://t.co/note',expanded_url:'https://example.com/note'}]}}};
  const repost={id_str:'200',full_text:'RT @alice Short preview',user:{id_str:'22',screen_name:'bob',name:'Bob'},retweeted_status:original};
  const post=rd.ingest(repost);
  assert.equal(post.id,'100');
  assert.equal(post.handle,'alice');
  assert.equal(post.fullText,true);
  assert.equal(post.text,'Full flattened note text https://example.com/note');
  pass('Observed native flattened notes and repost wrappers normalize to original content');
}
{
  const rd=instance();
  rd.ingest(tweet('100',null,'11',{full_text:'My thread, part 1/5',reply_count:99}));
  rd.ingest(tweet('101',null,'11',{full_text:'Part 2/5'}));
  assert.equal(rd.isThread('100'),false);
  assert.equal(rd.isThread('101'),false);
  assert.equal(rd.isThread('999'),false);
  pass('Text, reply counts, conversation ID, and same-author adjacency do not imply a thread');
}
{
  const rd=instance();
  rd.ingest(tweet('101','100'));
  assert.equal(rd.isThread('101'),true);
  rd.ingest(tweet('201','200','11',{in_reply_to_user_id_str:'22'}));
  assert.equal(rd.isThread('201'),false);
  rd.ingest(tweet('202','200','11',{in_reply_to_user_id_str:null}));
  assert.equal(rd.isThread('202'),false);
  pass('Only an explicit self-reply identifies a thread before its parent loads');
}
{
  const rd=instance();
  rd.ingest(tweet('100'));
  assert.equal(rd.isThread('100'),false);
  rd.ingest(tweet('200','100','22',{in_reply_to_user_id_str:'11'}));
  assert.equal(rd.isThread('100'),false);
  rd.ingest(tweet('101','100','11',{in_reply_to_user_id_str:null}));
  assert.equal(rd.isThread('100'),true);
  assert.equal(rd.isThread('101'),true);
  rd.ingest(tweet('102','100'));
  assert.equal(rd.chain('100').posts.length,1);
  assert.equal(rd.isThread('100'),true);
  pass('An exact same-author child updates its root and branch roots remain detected threads');
}
{
  const rd=instance();
  const root=tweet('100'),child=tweet('101','100');
  for(const raw of [root,child]){
    delete raw.legacy.user_id_str;
    delete raw.core.user_results.result.rest_id;
    rd.ingest(raw);
  }
  assert.equal(rd.isThread('100'),false);
  assert.equal(rd.isThread('101'),false);
  pass('Matching handles without verified author IDs do not produce thread labels');
}
console.log('12/12 reader data unit cases passed.');
