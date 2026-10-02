const {test} = require('node:test');
const assert = require('node:assert/strict');
const {harness, deferred, flush, station} = require('./helpers.cjs');

test('an old catalogue response cannot overwrite the DnB category', async () => {
  const h = harness(), old = deferred();
  h.sandbox.fetch = url => Promise.resolve({ok:true,json:()=>String(url).includes('/json/servers') ? Promise.resolve([{name:'de1.api.radio-browser.info'}]) : old.promise});
  const pending = h.api.loadStations(); await flush(); h.api.setMode('dnb');
  old.resolve([station('old')]); await pending; await flush();
  assert(h.api.snapshot.stations.every(s => s.stationuuid.startsWith('curated-')));
  assert.equal(h.elements.get('listTitle').textContent, 'Drum & Bass — лучшие станции');
});
test('clearing search cancels the pending debounced query', async () => {
  const h = harness(), queries = [];
  h.sandbox.fetch = async url => {
    if (String(url).includes('/json/stations/search')) queries.push(new URL(url).searchParams.get('name'));
    return {ok:true,json:async()=>String(url).includes('/json/servers') ? [{name:'de1.api.radio-browser.info'}] : []};
  };
  h.elements.get('searchInput').value='old query'; h.elements.get('searchInput').dispatch('input');
  h.elements.get('clearSearch').dispatch('click'); await h.advance(450);
  assert(!queries.includes('old query'));
});

test('an unusable fast mirror cannot beat a slower valid catalogue mirror', async () => {
  const h=harness();
  h.sandbox.fetch=async url=>({ok:true,json:async()=>{
    if(String(url).includes('/json/servers'))return [{name:'de1.api.radio-browser.info'}];
    return new URL(url).hostname.startsWith('de1.') ? {error:'invalid catalogue'} : [station('working')];
  }});
  const result=h.api.apiFetch('/json/stations/search');await flush();await h.advance(350);
  assert.equal((await result)[0].name,'working');
});

test('switching category aborts active catalogue network requests', async () => {
  const h=harness();let aborted=0;
  h.sandbox.fetch=(url,{signal}={})=>{
    if(String(url).includes('/json/servers'))return Promise.resolve({ok:true,json:async()=>[{name:'de1.api.radio-browser.info'}]});
    return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted++;reject(new DOMException('Cancelled','AbortError'));},{once:true}));
  };
  const pending=h.api.loadStations();await flush();h.api.setMode('dnb');await pending;
  assert.equal(aborted,1);assert.equal(h.elements.get('statusText').textContent,'4 станц.');
});

test('repeated searches reuse completed discovery instead of fetching the server list again', async () => {
  const h=harness();let discoveries=0;
  h.sandbox.fetch=async url=>({ok:true,json:async()=>{
    if(String(url).includes('/json/servers')){discoveries++;return [{name:'de1.api.radio-browser.info'}];}
    return [];
  }});
  await h.api.apiFetch('/json/stations/search',{name:'one'});
  await h.api.apiFetch('/json/stations/search',{name:'two'});
  assert.equal(discoveries,1);
});
