const {test} = require('node:test');
const assert = require('node:assert/strict');
const {harness, deferred, flush, station} = require('./helpers.cjs');

test('DnB resume calls play during the original button action, without a delayed start', async () => {
  const h = harness(), s = {...station('DnB'), stationuuid:'curated-dnbradio'};
  await h.api.playStation(s); h.api.pauseRadio();
  const count = h.audio.plays.length;
  const resumed = h.api.playStation(s);
  assert.equal(h.audio.plays.length, count + 1, 'play must occur synchronously before user activation can expire');
  await resumed;
});
test('an obsolete play rejection cannot change the new station or schedule its reconnect', async () => {
  const h = harness(), old = deferred(); h.audio.playImpl = () => old.promise;
  const pending = h.api.playStation(station('old'));
  h.audio.playImpl = null; await h.api.playStation(station('new'));
  h.audio.dispatch('playing'); old.reject(new DOMException('Source changed', 'AbortError'));
  await pending; await flush();
  assert.equal(h.elements.get('nowStatus').textContent, 'В эфире');
  assert.equal(h.api.snapshot.reconnectAttempts, 0);
  assert.deepEqual([...h.api.snapshot.history], ['custom-new']);
});
test('a late playing event after user Pause cannot restart watchdogs or label it playing', async () => {
  const h = harness(); await h.api.playStation(station('one')); h.api.pauseRadio();
  h.audio.dispatch('playing');
  assert.equal(h.elements.get('nowStatus').textContent, 'Пауза');
  assert.equal(h.timers.size, 0);
});
test('progress that advanced without timeupdate stays healthy after background throttling', async () => {
  const h = harness(); await h.api.playStation(station('one')); h.audio.dispatch('playing');
  const resets = h.audio.resets;
  h.jump(11000); h.audio.currentTime = 11;
  const tick = [...h.timers.values()].find(t => t.interval === 2000).fn;
  tick(); await flush();
  assert.equal(h.audio.resets, resets, 'a healthy decoder must not reconnect');
});
test('manual start gets a fresh retry budget after an unavailable station', async () => {
  const h = harness(); h.audio.playImpl = () => Promise.reject(new Error('network'));
  await h.api.playStation(station('bad'));
  await h.advance(9000);
  assert.equal(h.api.snapshot.reconnectAttempts, 4);
  await h.api.playStation(station('another'));
  assert.equal(h.api.snapshot.reconnectAttempts, 1, 'new explicit start has its own budget');
});
test('autoplay denial asks for a tap and does not loop background retries', async () => {
  const h = harness(); h.audio.playImpl = () => Promise.reject(new DOMException('Tap required', 'NotAllowedError'));
  await h.api.playStation(station('one'));
  assert.equal(h.api.snapshot.reconnectAttempts, 0);
  assert.equal(h.api.snapshot.userPaused, true);
});

test('repeated long pauses leave no stream or timer open and resume exactly once',async()=>{
  const h=harness(),s={...station('DnB'),stationuuid:'curated-dnbradio'};
  for(let i=0;i<6;i++){
    await h.api.playStation(s);h.audio.dispatch('playing');h.api.pauseRadio();
    assert.equal(h.audio.src,'');assert.equal(h.eqAudio.src,'');assert.equal(h.timers.size,0);
    await h.advance(20*60*1000);assert.equal(h.audio.plays.length,i+1);
  }
  await h.api.playStation(s);assert.equal(h.audio.plays.length,7);
});

test('playing events without real audio progress cannot reset the retry limit forever',async()=>{
  const h=harness();h.audio.playImpl=()=>{h.audio.dispatch('playing');return Promise.resolve();};
  await h.api.playStation(station('silent'));
  await h.advance(60000);
  assert.equal(h.audio.plays.length,5,'initial start plus four bounded recovery attempts');
  assert.equal(h.elements.get('nowStatus').textContent,'Поток временно недоступен');
});
