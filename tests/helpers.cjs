const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
class Element {
  constructor() {
    this.listeners = {}; this.style = {}; this.dataset = {}; this.hidden = false;
    this.textContent = ''; this.innerHTML = ''; this.value = ''; this.checked = false;
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  removeEventListener(name, fn) { this.listeners[name] = (this.listeners[name] || []).filter(x => x !== fn); }
  dispatch(name, event = {}) { for (const fn of this.listeners[name] || []) fn(event); }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  focus() {} close() {} showModal() {} scrollIntoView() {}
}
class Player extends Element {
  constructor() { super(); this.paused = true; this.currentTime = 0; this.src = ''; this.plays = []; this.resets = 0; this.playImpl = null; }
  play() {
    this.plays.push(this.src); this.paused = false;
    return this.playImpl ? this.playImpl() : Promise.resolve();
  }
  pause() { const changed = !this.paused; this.paused = true; if (changed) this.dispatch('pause'); }
  load() { this.resets++; this.currentTime = 0; }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
}
function harness({ source = fs.readFileSync(path.join(root, 'app.js'), 'utf8'), storage = new Map(), metadata = false } = {}) {
  let now = 1_800_000_000_000, nextTimer = 0;
  const timers = new Map(), elements = new Map(), document = new Element(), window = new Element();
  for (const id of ['audio', 'eqAudio']) elements.set(id, new Player());
  document.getElementById = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  document.visibilityState = 'visible';
  window.location = { href: 'https://example.test/Radio/', protocol: 'https:' };
  const makeTimer = (fn, delay, interval) => { const id = ++nextTimer; timers.set(id, { fn, at: now + (delay || 0), interval }); return id; };
  const sandbox = {
    document, window, navigator: { onLine: true }, console: { log() {}, warn() {}, error() {} },
    URL, URLSearchParams, AbortController, DOMException, AggregateError, Promise, Image: Element,
    performance: { now: () => now }, Date: class extends Date { static now() { return now; } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
    setTimeout: (fn, delay) => makeTimer(fn, delay, 0), clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => makeTimer(fn, delay, delay), clearInterval: id => timers.delete(id),
    fetch: async () => ({ ok: true, json: async () => [] })
  };
  // Keep the fetch function stable, just as in a browser with routed responses.
  // Tests replace its implementation rather than a reference captured by Tracker.
  let request = sandbox.fetch;
  const routedFetch = (...args) => request(...args);
  Object.defineProperty(sandbox, 'fetch', {get:()=>routedFetch,set:value=>request=value});
  vm.createContext(sandbox);
  if (metadata) {
    vm.runInContext(fs.readFileSync(path.join(root, 'metadata.js'), 'utf8'), sandbox);
    window.RadioMetadata = sandbox.RadioMetadata;
  }
  // Keep real handlers; only skip automatic network requests at app startup.
  source = source.replace(/discoverApiServers\(\)\.catch\(\(\) => \{\}\);\s*Promise\.allSettled\(\[loadFeatured\(\), loadStations\(\)\]\);\s*$/, '');
  vm.runInContext(source + '\n;globalThis.radio = {playStation,pauseRadio,togglePlay,loadStations,setMode,apiFetch,discoverApiServers,recoverInterruptedPlayback,startProgressWatchdog,startSleepTimer, get snapshot(){return {station:currentStation,attempt:playbackAttemptId,userPaused,reconnectAttempts,stations:visibleStations,offset,history:[...history]}}};', sandbox);
  async function advance(ms) {
    const end = now + ms;
    let iterations = 0;
    while (true) {
      const eligible = [...timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at);
      if (!eligible.length) break;
      if (++iterations > 2000) throw Error('Timer loop');
      const [id, timer] = eligible[0]; now = timer.at;
      if (timer.interval) timer.at += timer.interval; else timers.delete(id);
      timer.fn(); await flush();
    }
    now = end; await flush();
  }
  return { api: sandbox.radio, sandbox, elements, storage, timers, document, window, advance,
    jump(ms) { now += ms; }, get now() { return now; },
    get audio() { return elements.get('audio'); }, get eqAudio() { return elements.get('eqAudio'); } };
}
const station = id => ({ stationuuid: `custom-${id}`, name: id, url: `https://streams.test/${id}.mp3`, favicon: '', custom: true });
module.exports = { harness, deferred, flush, station, root };
