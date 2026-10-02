const {test} = require('node:test');
const assert = require('node:assert/strict');
const {harness, deferred, flush, station} = require('./helpers.cjs');
const fixture = (now, title='Test Track') => ({now_playing:{song:{id:'fixture',artist:'Test Artist',title},played_at:Math.floor(now/1000)-30,duration:180,elapsed:30}});

test('AzuraCast title, artist and time appear only when its matching station plays', async () => {
  const stored = new Map([['radioFavorites','["custom-existing"]'],['radioCustomStations','[]']]);
  const h = harness({metadata:true,storage:stored});
  const s = {...station('one'),url:'https://streams.test/listen/one/radio.mp3'};
  const metadataRequests = [];
  h.sandbox.fetch = async url => { metadataRequests.push(url); return {ok:true,json:async()=>fixture(h.now)}; };
  await h.api.playStation(s); assert.equal(metadataRequests.length,0);
  h.audio.dispatch('playing'); await flush();
  assert.equal(h.elements.get('nowTrackTitle').textContent,'Test Track');
  assert.equal(h.elements.get('nowTrackArtist').textContent,'Test Artist');
  assert.equal(h.elements.get('nowTrackTime').textContent,'0:30 / 3:00');
  assert.equal(h.elements.get('miniStatus').textContent,'В эфире · 0:30 / 3:00');
  h.audio.currentTime=2; await h.advance(2000);
  assert.equal(h.elements.get('nowTrackTime').textContent,'0:32 / 3:00');
  assert.equal(h.elements.get('miniStatus').textContent,'В эфире · 0:32 / 3:00');
  assert.equal(stored.get('radioFavorites'),'["custom-existing"]');
  const count=metadataRequests.length;h.api.pauseRadio();await h.advance(60000);
  assert.equal(metadataRequests.length,count,'pause stops all metadata polling');
  assert.equal(h.timers.size,0,'pause leaves no playback or metadata timers');
});

test('Icecast stream_start never becomes an invented song timestamp or duration', () => {
  const h=harness({metadata:true}), model=h.sandbox.RadioMetadata, s=station('one');
  const row=model.normalize({icestats:{source:{listenurl:s.url,title:'Artist - Title',stream_start_iso8601:'2020-01-01T00:00:00Z'}}},{type:'icecast'},s,h.now);
  assert.equal(row.artist,'Artist');assert.equal(row.title,'Title');
  assert.equal(row.elapsed,null);assert.equal(row.duration,null);assert.equal(row.startedAt,null);
  assert.equal(model.position(row,h.now+60000),null);
});

test('a shared server cannot supply another station\'s song', () => {
  const h=harness({metadata:true}),model=h.sandbox.RadioMetadata,s=station('one');
  const foreign={station:{listen_url:station('two').url},...fixture(h.now,'Other song')};
  assert.equal(model.normalize([foreign],{type:'azuracast'},s,h.now),null);
  assert.equal(model.normalize({icestats:{source:{listenurl:station('two').url,title:'Wrong artist - Wrong title'}}},{type:'icecast'},s,h.now),null);
});

test('a late metadata response cannot overwrite the newly selected station', async () => {
  const h=harness({metadata:true}),old=deferred();
  h.sandbox.fetch=async()=>({ok:true,json:()=>old.promise});
  await h.api.playStation({...station('one'),url:'https://streams.test/listen/one/radio.mp3'});
  h.audio.dispatch('playing');await flush();
  h.sandbox.fetch=async()=>({ok:true,json:async()=>fixture(h.now,'New song')});
  await h.api.playStation({...station('two'),url:'https://streams.test/listen/two/radio.mp3'});
  h.audio.dispatch('playing');await flush();
  old.resolve(fixture(h.now,'Old song'));await flush();
  assert.equal(h.elements.get('nowTrackTitle').textContent,'New song');
});

test('metadata failure clears a stale title without resetting or pausing the stream', async () => {
  const h=harness({metadata:true});
  const s={...station('one'),url:'https://streams.test/listen/one/radio.mp3'};
  h.sandbox.fetch=async()=>({ok:true,json:async()=>fixture(h.now)});
  await h.api.playStation(s);h.audio.dispatch('playing');await flush();
  const resets=h.audio.resets;
  h.sandbox.fetch=async()=>({ok:false,status:503});
  for(let i=0;i<3;i++){h.audio.currentTime+=5;await h.advance(5000);}
  assert.equal(h.elements.get('nowTrackTitle').textContent,'Данные о треке недоступны');
  assert.equal(h.audio.resets,resets);assert.equal(h.audio.paused,false);
});

test('background stops metadata requests and a visible return refreshes once', async () => {
  const h=harness({metadata:true});
  let requests=0;h.sandbox.fetch=async()=>{requests++;return {ok:true,json:async()=>fixture(h.now)};};
  await h.api.playStation({...station('one'),url:'https://streams.test/listen/one/radio.mp3'});
  h.audio.dispatch('playing');await flush();
  h.document.visibilityState='hidden';h.document.dispatch('visibilitychange');
  assert.equal(h.elements.get('miniTrack').textContent,'Название трека недоступно','background does not keep an indefinitely stale song');
  const before=requests;h.audio.currentTime=120;h.jump(120000);
  assert.equal(requests,before);
  h.document.visibilityState='visible';h.document.dispatch('visibilitychange');await flush();
  assert.equal(requests,before+1);assert.equal(h.audio.plays.length,1,'healthy audio keeps its original stream');
});

test('song clock ticks do not repeatedly replace lock-screen metadata and artwork', async () => {
  const h=harness({metadata:true});
  const metadata=[];
  h.sandbox.MediaMetadata=class {constructor(value){metadata.push(value);}};
  h.sandbox.navigator.mediaSession={};
  h.sandbox.fetch=async()=>({ok:true,json:async()=>fixture(h.now)});
  await h.api.playStation({...station('one'),url:'https://streams.test/listen/one/radio.mp3'});
  h.audio.dispatch('playing');await flush();
  const count=metadata.length;
  h.audio.currentTime=5;await h.advance(5000);
  assert.equal(metadata.length,count,'time updates keep the same song metadata');
  assert.equal(metadata.at(-1).title,'Test Track');
  assert.equal(h.sandbox.navigator.mediaSession.playbackState,'playing');
});

test('a provided duration without a song timestamp stays visible without an invented zero position', async () => {
  const h=harness({metadata:true});
  h.sandbox.fetch=async()=>({ok:true,json:async()=>({now_playing:{song:{title:'Known title'},duration:180}})});
  await h.api.playStation({...station('one'),url:'https://streams.test/listen/one/radio.mp3'});
  h.audio.dispatch('playing');await flush();
  assert.equal(h.elements.get('nowTrackTime').textContent,'— / 3:00 · время начала не передано');
  assert.equal(h.elements.get('nowTrackArtist').textContent,'Исполнитель не передан');
  assert.equal(h.elements.get('miniStatus').textContent,'В эфире · — / 3:00');
  assert.equal(h.elements.get('nowTrackProgress').hidden,true);
});

test('a refreshed stream URL for the same station reads metadata from the new server', async () => {
  const h=harness({metadata:true}),requests=[];
  h.sandbox.fetch=async url=>{requests.push(url);return {ok:true,json:async()=>fixture(h.now)};};
  await h.api.playStation({...station('one'),url:'https://old.test/listen/one/radio.mp3'});
  h.audio.dispatch('playing');await flush();
  requests.length=0;
  await h.api.playStation({...station('one'),url:'https://new.test/listen/one/radio.mp3'});
  h.audio.dispatch('playing');await flush();
  assert.deepEqual(requests,['https://new.test/api/nowplaying/one']);
});
