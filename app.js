const FALLBACK_API_SERVERS = [
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://fi1.api.radio-browser.info'
];
const API_DISCOVERY_URLS = [
  'https://all.api.radio-browser.info/json/servers',
  ...FALLBACK_API_SERVERS.map(server => `${server}/json/servers`)
];
const API_SERVER_CACHE_KEY = 'radioApiServers';
const API_SERVER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const API_TIMEOUT_MS = 5000;
const API_RACE_DELAY_MS = 300;
let API_SERVERS = loadCachedApiServers();

const $ = (id) => document.getElementById(id);
const audio = $('audio');
const eqAudio = $('eqAudio');
const stationList = $('stationList');
const statusText = $('statusText');
const listTitle = $('listTitle');
const searchInput = $('searchInput');
const clearSearch = $('clearSearch');
const favoritesToggle = $('favoritesToggle');
const loadMoreBtn = $('loadMoreBtn');
const playBtn = $('playBtn');
const miniPlayBtn = $('miniPlayBtn');
const prevBtn = $('prevBtn');
const nextBtn = $('nextBtn');
const nowName = $('nowName');
const nowDetails = $('nowDetails');
const nowStatus = $('nowStatus');
const nowCover = $('nowCover');
const trackPanel = $('trackPanel');
const nowTrackTitle = $('nowTrackTitle');
const nowTrackArtist = $('nowTrackArtist');
const nowTrackTime = $('nowTrackTime');
const nowTrackProgress = $('nowTrackProgress');
const miniPlayer = $('miniPlayer');
const miniName = $('miniName');
const miniStatus = $('miniStatus');
const miniCover = $('miniCover');
const miniTrack = $('miniTrack');
const featuredRail = $('featuredRail');
const featuredSection = $('featuredSection');
const historySection = $('historySection');
const historyRail = $('historyRail');
const sleepBadge = $('sleepBadge');
const settingsDialog = $('settingsDialog');
const addStationDialog = $('addStationDialog');
const eqToggle = $('eqToggle');
const eqHint = $('eqHint');
const cancelSleepBtn = $('cancelSleepBtn');
const toast = $('toast');

let stations = [];
let visibleStations = [];
let featuredStations = [];
let currentStation = null;
let currentIndex = -1;
let currentMode = 'popular';
let showFavoritesOnly = false;
let offset = 0;
let searchTimer = null;
let catalogRequestId = 0;
let catalogController = null;
let catalogLoading = false;
let activeServer = API_SERVERS[0];
let apiDiscoveryPromise = null;
let apiDiscoveryAt = 0;
let toastTimer = null;
let sleepTimeout = null;
let sleepInterval = null;
let sleepEndsAt = null;
let eqEnabled = false;
let eqGraphReady = false;
let audioContext = null;
let eqFilters = [];
let eqPreset = localStorage.getItem('radioEqPreset') || 'flat';
let activePlayer = audio;
let userPaused = true;
let switchingPlayer = false;
let interruptedPlayback = false;
let reconnectTimer = null;
let recoveryTimer = null;
let reconnectAttempts = 0;
let connectWatchdogTimer = null;
let progressWatchdogTimer = null;
let playbackAttemptId = 0;
let lastPlaybackProgressAt = 0;
let lastPlaybackTime = 0;
const MAX_RECONNECT_ATTEMPTS = 4;
const CONNECT_TIMEOUT_MS = 10000;
const PLAYBACK_STALL_TIMEOUT_MS = 9000;
const PLAYBACK_PROGRESS_CHECK_MS = 2000;
const pageSize = 30;
let trackSnapshot = {track:null,status:'idle',elapsed:null};
let mediaMetadataKey = '';
const trackTracker = window.RadioMetadata ? new window.RadioMetadata.Tracker({
  onChange: snapshot => { trackSnapshot = snapshot; renderTrack(); updateMediaMetadata(); }
}) : null;

const favorites = new Set(safeParse('radioFavorites', []));
const stationCache = safeParse('radioStationCache', {});
let history = safeParse('radioHistory', []);
let customStations = safeParse('radioCustomStations', []);

const CURATED_DNB_STATIONS = [
  {
    stationuuid: 'curated-bassdrive',
    name: 'Bassdrive',
    url: 'https://chi.bassdrive.co/stream',
    favicon: '',
    countrycode: 'US',
    country: 'Worldwide',
    language: 'English',
    tags: 'drum and bass,dnb,jungle,liquid',
    codec: 'MP3',
    bitrate: 192,
    custom: false,
  },
  {
    stationuuid: 'curated-dnbradio',
    name: 'DNBRADIO',
    url: 'https://azura.dnbradio.com/listen/dnbradio/dnbradio_main.mp3',
    favicon: '',
    countrycode: 'US',
    country: 'Worldwide',
    language: 'English',
    tags: 'drum and bass,dnb,jungle',
    codec: 'MP3',
    bitrate: 320,
    custom: false,
  },
  {
    stationuuid: 'curated-neurofunk-radio',
    name: 'Neurofunk Radio',
    url: 'https://s54.radiolize.com/radio/8120/radio.mp3',
    favicon: '',
    countrycode: 'US',
    country: 'Worldwide',
    language: 'English',
    tags: 'neurofunk,drum and bass,dnb,techstep',
    codec: 'MP3',
    bitrate: 0,
    custom: false,
  },
  {
    stationuuid: 'curated-dnb247',
    name: 'DnB247.FM',
    url: 'https://a6.asurahosting.com:8050/radio.mp3',
    favicon: '',
    countrycode: 'GB',
    country: 'United Kingdom',
    language: 'English',
    tags: 'drum and bass,dnb,liquid,neurofunk,jungle',
    codec: 'MP3',
    bitrate: 192,
    custom: false,
  },
];


const modeConfig = {
  popular: { title: 'Популярные станции', params: { order: 'clickcount', reverse: 'true' } },
  ru: { title: 'Радиостанции России', params: { countrycode: 'RU', order: 'clickcount', reverse: 'true' } },
  de: { title: 'Радиостанции Германии', params: { countrycode: 'DE', order: 'clickcount', reverse: 'true' } },
  rock: { title: 'Рок', params: { tag: 'rock', order: 'clickcount', reverse: 'true' } },
  electronic: { title: 'Электронная музыка', params: { tag: 'electronic', order: 'clickcount', reverse: 'true' } },
  jazz: { title: 'Джаз', params: { tag: 'jazz', order: 'clickcount', reverse: 'true' } },
  chillout: { title: 'Chillout', params: { tag: 'chillout', order: 'clickcount', reverse: 'true' } },
  news: { title: 'Новости', params: { tag: 'news', order: 'clickcount', reverse: 'true' } },
};

const EQ_PRESETS = {
  flat:   [0, 0, 0],
  bass:   [6, 1, -1],
  voice:  [-2, 4, 1],
  bright: [-1, 1, 5],
};

function safeParse(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}
function saveFavorites() { localStorage.setItem('radioFavorites', JSON.stringify([...favorites])); }
function saveCache() { localStorage.setItem('radioStationCache', JSON.stringify(stationCache)); }
function saveHistory() { localStorage.setItem('radioHistory', JSON.stringify(history)); }
function saveCustomStations() { localStorage.setItem('radioCustomStations', JSON.stringify(customStations)); }

function cleanStation(s) {
  return {
    stationuuid: String(s.stationuuid || ''),
    name: s.name?.trim() || 'Без названия',
    url: s.url_resolved || s.url || '',
    favicon: s.favicon || '',
    countrycode: s.countrycode || '',
    country: s.country || '',
    language: s.language || '',
    tags: s.tags || '',
    codec: s.codec || '',
    bitrate: Number(s.bitrate || 0),
    votes: Number(s.votes || 0),
    custom: Boolean(s.custom),
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeApiServers(items) {
  return [...new Set((Array.isArray(items) ? items : [])
    .map(item => typeof item === 'string' ? item : item?.name)
    .map(name => String(name || '').trim().replace(/^https?:\/\//i, ''))
    .filter(name => /^[a-z0-9.-]+\.api\.radio-browser\.info$/i.test(name))
    .map(name => `https://${name}`))];
}

function loadCachedApiServers() {
  try {
    const cached = JSON.parse(localStorage.getItem(API_SERVER_CACHE_KEY) || '{}');
    const valid = Date.now() - Number(cached.savedAt || 0) < API_SERVER_CACHE_TTL_MS;
    return [...new Set([...(valid ? normalizeApiServers(cached.servers) : []), ...FALLBACK_API_SERVERS])];
  } catch (_) {
    return [...FALLBACK_API_SERVERS];
  }
}

function saveApiServers(servers) {
  try {
    localStorage.setItem(API_SERVER_CACHE_KEY, JSON.stringify({
      savedAt: Date.now(),
      servers: normalizeApiServers(servers)
    }));
  } catch (_) {}
}

async function discoverApiServers({ force = false } = {}) {
  if (apiDiscoveryPromise) return apiDiscoveryPromise;
  if (!force && apiDiscoveryAt && Date.now() - apiDiscoveryAt < API_SERVER_CACHE_TTL_MS) return API_SERVERS;
  const controllers = API_DISCOVERY_URLS.map(() => new AbortController());
  const timeout = setTimeout(() => controllers.forEach(c => c.abort()), API_TIMEOUT_MS + API_DISCOVERY_URLS.length * API_RACE_DELAY_MS);

  apiDiscoveryPromise = Promise.any(API_DISCOVERY_URLS.map(async (url, index) => {
    const signal = controllers[index].signal;
    if (index) await waitForMirror(index * API_RACE_DELAY_MS, signal);
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store', signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const discovered = normalizeApiServers(await response.json());
    if (!discovered.length) throw new Error('Пустой список зеркал');
    return discovered;
  })).then(discovered => {
    API_SERVERS = [...new Set([...discovered, ...API_SERVERS, ...FALLBACK_API_SERVERS])];
    saveApiServers(API_SERVERS);
    apiDiscoveryAt = Date.now();
    return API_SERVERS;
  }).catch(err => {
    console.warn('Radio Browser discovery failed, using cached mirrors', err);
    return API_SERVERS;
  }).finally(() => {
    clearTimeout(timeout);
    controllers.forEach(c => c.abort());
    apiDiscoveryPromise = null;
  });

  return apiDiscoveryPromise;
}

function waitForMirror(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('Request cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, {once:true});
    if (signal.aborted) abort();
  });
}

async function fetchApiMirror(server, path, query, signal) {
  const response = await fetch(`${server}${path}${query}`, {
    headers: { 'Accept': 'application/json' },
    cache: 'no-store',
    signal
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('Некорректный ответ каталога');
  return { server, data };
}

async function apiFetch(path, params = {}, {signal} = {}) {
  if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
  discoverApiServers().catch(() => {});

  const qs = new URLSearchParams(params).toString();
  const query = qs ? `?${qs}` : '';
  const servers = [...new Set([activeServer, ...API_SERVERS])];
  const controllers = servers.map(() => new AbortController());
  const abort = () => controllers.forEach(controller => controller.abort());
  signal?.addEventListener('abort', abort, {once:true});
  const timeout = setTimeout(() => controllers.forEach(controller => controller.abort()), API_TIMEOUT_MS + servers.length * API_RACE_DELAY_MS);

  try {
    const result = await Promise.any(servers.map(async (server, index) => {
      if (index) await waitForMirror(index * API_RACE_DELAY_MS, controllers[index].signal);
      try {
        return await fetchApiMirror(server, path, query, controllers[index].signal);
      } catch (err) {
        console.warn('Radio Browser mirror failed:', server, err?.name || err?.message || err);
        throw err;
      }
    }));
    activeServer = result.server;
    API_SERVERS = [result.server, ...API_SERVERS.filter(server => server !== result.server)];
    saveApiServers(API_SERVERS);
    controllers.forEach(controller => controller.abort());
    return result.data;
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    discoverApiServers({ force: true }).catch(() => {});
    throw err instanceof AggregateError
      ? new Error('Все доступные зеркала каталога недоступны')
      : err;
  } finally {
    signal?.removeEventListener('abort', abort);
    clearTimeout(timeout);
    controllers.forEach(controller => controller.abort());
  }
}

async function loadFeatured() {
  featuredRail.innerHTML = '<div class="empty">Загружаем…</div>';
  try {
    const data = await apiFetch('/json/stations/search', {
      countrycode: 'RU', order: 'clickcount', reverse: 'true', hidebroken: 'true', limit: '10'
    });
    featuredStations = data.map(cleanStation).filter(validStation);
    featuredStations.forEach(cacheStation);
    renderRail(featuredRail, featuredStations, 'featured');
  } catch (err) {
    featuredSection.hidden = true;
  }
}

async function loadStations({ append = false, search = '' } = {}) {
  if (append && catalogLoading) return;
  cancelCatalogRequest();
  if (showFavoritesOnly) return renderFavorites();
  if (currentMode === 'custom') return renderCustomStations();
  if (currentMode === 'dnb') return renderDnbStations(search);

  const requestId = catalogRequestId;
  const controller = new AbortController();
  catalogController = controller;
  catalogLoading = true;
  loadMoreBtn.disabled = true;
  const requestedOffset = append ? offset : 0;

  statusText.textContent = 'Загрузка…';
  if (!append) {
    offset = 0;
    stationList.innerHTML = '<div class="empty">Ищем станции…</div>';
  }

  try {
    const config = modeConfig[currentMode] || modeConfig.popular;
    const params = {
      ...config.params,
      hidebroken: 'true',
      limit: String(pageSize),
      offset: String(requestedOffset),
    };
    if (search) {
      params.name = search;
      delete params.tag;
      delete params.countrycode;
      params.order = 'clickcount';
      params.reverse = 'true';
    }

    const data = await apiFetch('/json/stations/search', params, {signal: controller.signal});
    if (requestId !== catalogRequestId || controller.signal.aborted) return;
    const cleaned = data.filter(s => s && typeof s === 'object').map(cleanStation).filter(validStation);
    cleaned.forEach(cacheStation);
    saveCache();

    stations = append ? uniqueByUuid([...stations, ...cleaned]) : cleaned;
    visibleStations = stations;
    offset = requestedOffset + cleaned.length;
    listTitle.textContent = search ? `Поиск: ${search}` : config.title;
    statusText.textContent = `${stations.length} станц.`;
    loadMoreBtn.hidden = cleaned.length < pageSize || Boolean(search);
    renderStations();
  } catch (err) {
    if (requestId !== catalogRequestId || controller.signal.aborted) return;
    console.error(err);
    statusText.textContent = 'Ошибка';
    stationList.innerHTML = `
      <div class="error-card">
        Не удалось загрузить каталог. Проверьте интернет-соединение.<br>
        <button id="retryBtn">Повторить</button>
      </div>`;
    $('retryBtn')?.addEventListener('click', () => loadStations({ search: searchInput.value.trim() }));
  } finally {
    if (requestId === catalogRequestId) {
      catalogController = null;
      catalogLoading = false;
      loadMoreBtn.disabled = false;
    }
  }
}

function cancelCatalogRequest() {
  clearTimeout(searchTimer);
  catalogRequestId++;
  catalogController?.abort();
  catalogController = null;
  catalogLoading = false;
  loadMoreBtn.disabled = false;
}

function validStation(s) {
  return s.stationuuid && s.url && /^https?:\/\//i.test(s.url);
}
function uniqueByUuid(arr) {
  const seen = new Set();
  return arr.filter(s => s && !seen.has(s.stationuuid) && seen.add(s.stationuuid));
}
function cacheStation(s) {
  if (s?.stationuuid) stationCache[s.stationuuid] = s;
}

function renderStations() {
  if (!visibleStations.length) {
    stationList.innerHTML = '<div class="empty">Ничего не найдено.</div>';
    return;
  }

  stationList.innerHTML = visibleStations.map((s, index) => stationCardHtml(s, index)).join('');

  stationList.querySelectorAll('[data-play]').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const index = Number(btn.dataset.play);
      const station = visibleStations[index];
      if (currentStation?.stationuuid === station.stationuuid && !activeAudio().paused) pauseRadio();
      else playStation(station, index);
    });
  });
  stationList.querySelectorAll('[data-fav]').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleFavorite(btn.dataset.fav);
    });
  });
  stationList.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      deleteCustomStation(btn.dataset.delete);
    });
  });
  stationList.querySelectorAll('.station-card').forEach(card => {
    card.addEventListener('click', () => playStation(visibleStations[Number(card.dataset.index)], Number(card.dataset.index)));
  });
  wireLogoFallbacks(stationList);
}

function stationCardHtml(s, index) {
  const isFav = favorites.has(s.stationuuid);
  const isPlaying = currentStation?.stationuuid === s.stationuuid;
  const meta = [s.countrycode || (s.custom ? 'МОЯ' : ''), s.codec, s.bitrate ? `${s.bitrate} kbps` : ''].filter(Boolean).join(' · ');
  return `
    <article class="station-card ${isPlaying ? 'playing' : ''}" data-index="${index}">
      <div class="station-logo">${logoMarkup(s)}</div>
      <div class="station-main">
        <span class="station-name">${escapeHtml(s.name)}</span>
        <span class="station-desc">${escapeHtml(meta || firstTags(s) || 'Интернет-радио')}</span>
      </div>
      <div class="station-actions">
        ${s.custom ? `<button class="delete-btn" data-delete="${escapeAttr(s.stationuuid)}" aria-label="Удалить станцию">×</button>` : ''}
        <button class="fav-btn ${isFav ? 'active' : ''}" data-fav="${escapeAttr(s.stationuuid)}" aria-label="В избранное">♥</button>
        <button class="play-card-btn" data-play="${index}" aria-label="Воспроизвести">${isPlaying && !activeAudio().paused ? '❚❚' : '▶'}</button>
      </div>
    </article>`;
}

function renderRail(container, items, source) {
  if (!items.length) {
    container.innerHTML = '<div class="empty">Пока пусто.</div>';
    return;
  }
  container.innerHTML = items.map((s, i) => `
    <button class="rail-card ${currentStation?.stationuuid === s.stationuuid ? 'playing' : ''}" type="button" data-rail-source="${source}" data-rail-index="${i}">
      <span class="rail-logo">${logoMarkup(s, true)}</span>
      <span class="rail-name">${escapeHtml(s.name)}</span>
      <span class="rail-meta">${escapeHtml(s.countrycode || firstTags(s) || 'Радио')}</span>
    </button>`).join('');
  container.querySelectorAll('[data-rail-index]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sourceItems = btn.dataset.railSource === 'history' ? historyStations() : featuredStations;
      const station = sourceItems[Number(btn.dataset.railIndex)];
      if (station) playStation(station, visibleStations.findIndex(s => s.stationuuid === station.stationuuid));
    });
  });
  wireLogoFallbacks(container);
}

function renderFavorites() {
  visibleStations = [...favorites].map(id => stationCache[id]).filter(Boolean);
  listTitle.textContent = 'Избранное';
  statusText.textContent = `${visibleStations.length} станц.`;
  loadMoreBtn.hidden = true;
  renderStations();
}
function renderDnbStations(search = '') {
  const q = String(search || '').trim().toLowerCase();
  visibleStations = CURATED_DNB_STATIONS
    .map(cleanStation)
    .filter(validStation)
    .filter(s => !q || [s.name, s.tags, s.country, s.codec].join(' ').toLowerCase().includes(q));

  visibleStations.forEach(cacheStation);
  saveCache();
  stations = visibleStations;
  listTitle.textContent = q ? `Drum & Bass: ${search}` : 'Drum & Bass — лучшие станции';
  statusText.textContent = `${visibleStations.length} станц.`;
  loadMoreBtn.hidden = true;
  renderStations();
}

function renderCustomStations() {
  visibleStations = customStations.map(cleanStation);
  listTitle.textContent = 'Мои станции';
  statusText.textContent = `${visibleStations.length} станц.`;
  loadMoreBtn.hidden = true;
  renderStations();
}
function historyStations() {
  return history.map(id => stationCache[id]).filter(Boolean);
}
function renderHistory() {
  const items = historyStations();
  historySection.hidden = !items.length;
  if (items.length) renderRail(historyRail, items, 'history');
}

function toggleFavorite(uuid) {
  if (favorites.has(uuid)) favorites.delete(uuid); else favorites.add(uuid);
  saveFavorites();
  showToast(favorites.has(uuid) ? 'Добавлено в избранное' : 'Удалено из избранного');
  showFavoritesOnly ? renderFavorites() : renderStations();
}

async function playStation(station, index = -1, { recovery = false } = {}) {
  if (!station?.url) return;
  // Invalidate every earlier async start before the first possible await.
  const attemptId = ++playbackAttemptId;
  const isCurrent = () => attemptId === playbackAttemptId && !userPaused;
  clearTimeout(reconnectTimer);
  clearTimeout(recoveryTimer);
  reconnectTimer = null;
  recoveryTimer = null;
  clearPlaybackWatchdogs();
  if (!recovery) reconnectAttempts = 0;
  userPaused = false;
  interruptedPlayback = false;

  const changedStation = currentStation?.stationuuid !== station.stationuuid || currentStation?.url !== station.url;
  currentStation = station;
  trackTracker?.stop();
  if (changedStation) trackTracker?.setStation(station);
  cacheStation(station);
  saveCache();
  currentIndex = index >= 0 ? index : visibleStations.findIndex(s => s.stationuuid === station.stationuuid);
  updateNowPlaying(recovery ? 'Восстановление эфира…' : 'Подключение…');

  let player = eqEnabled ? eqAudio : audio;
  if (eqEnabled) {
    try {
      await ensureEqGraph();
      if (!isCurrent()) return;
    } catch (err) {
      if (!isCurrent()) return;
      console.warn('EQ unavailable', err);
      eqEnabled = false;
      eqToggle.checked = false;
      updateEqUi('Эквалайзер недоступен в этом браузере');
      player = audio;
    }
  }

  switchingPlayer = true;
  const other = player === audio ? eqAudio : audio;

  // Always tear down the inactive element. On iOS two half-open live streams
  // can compete for the same media/network resources and cause stuttering.
  resetStreamPlayer(other);
  activePlayer = player;

  try {
    // Close the old connection and call play in the same user action.
    // Delaying this call can lose Safari's permission to start audible media.
    resetStreamPlayer(player);
    player.preload = 'none';
    player.src = station.url;
    player.load();
    startConnectWatchdog(station, attemptId);
    await player.play();
    if (!isCurrent()) return;
    // play() can resolve before iOS Safari actually receives audio.
    // The "playing" event is the only place that marks the connection healthy.
    addToHistory(station);
    if (!recovery) reportClick(station.stationuuid);
  } catch (err) {
    if (!isCurrent()) return;
    clearPlaybackWatchdogs();
    console.error(err);

    if (err?.name === 'NotAllowedError') {
      pauseRadio();
      updateNowPlaying('Нажмите ▶, чтобы продолжить эфир');
      showToast('Для продолжения нажмите кнопку воспроизведения');
      return;
    }

    if (player === eqAudio && eqEnabled) {
      eqEnabled = false;
      eqToggle.checked = false;
      updateEqUi('Этот поток не поддерживает эквалайзер');
      showToast('Эквалайзер отключён для этой станции');
      activePlayer = audio;
      switchingPlayer = false;
      return playStation(station, currentIndex, { recovery });
    }

    updateNowPlaying('Не удалось запустить поток');
    showToast('Поток станции сейчас не воспроизводится');
    scheduleReconnect();
  } finally {
    if (attemptId === playbackAttemptId) {
      switchingPlayer = false;
      renderAllPlayingStates();
    }
  }
}

function activeAudio() { return activePlayer; }

function resetStreamPlayer(player) {
  try {
    player.pause();
    player.removeAttribute('src');
    player.load();
  } catch (_) {}
}

function clearPlaybackWatchdogs() {
  clearTimeout(connectWatchdogTimer);
  clearInterval(progressWatchdogTimer);
  connectWatchdogTimer = null;
  progressWatchdogTimer = null;
}

function startConnectWatchdog(station, attemptId) {
  clearTimeout(connectWatchdogTimer);
  connectWatchdogTimer = setTimeout(() => {
    if (!currentStation || userPaused || attemptId !== playbackAttemptId) return;
    if (currentStation.stationuuid !== station.stationuuid) return;

    updateNowPlaying('Переподключаемся…');
    resetStreamPlayer(activeAudio());
    scheduleReconnect(0);
  }, CONNECT_TIMEOUT_MS);
}

function markPlaybackProgress(player) {
  if (player !== activeAudio() || userPaused) return;
  const time = Number(player.currentTime || 0);
  if (Math.abs(time - lastPlaybackTime) > 0.05) {
    lastPlaybackTime = time;
    lastPlaybackProgressAt = performance.now();
    reconnectAttempts = 0;
  }
}

function startProgressWatchdog(player) {
  clearInterval(progressWatchdogTimer);
  lastPlaybackTime = Number(player.currentTime || 0);
  lastPlaybackProgressAt = performance.now();
  progressWatchdogTimer = setInterval(() => {
    if (player !== activeAudio() || userPaused || player.paused) return;
    // Background browsers may throttle timeupdate even while sound advances.
    markPlaybackProgress(player);
    if (performance.now() - lastPlaybackProgressAt < PLAYBACK_STALL_TIMEOUT_MS) return;

    updateNowPlaying('Поток завис — переподключаемся…');
    clearPlaybackWatchdogs();
    resetStreamPlayer(player);
    scheduleReconnect(0);
  }, PLAYBACK_PROGRESS_CHECK_MS);
}

function pauseRadio() {
  playbackAttemptId++;
  userPaused = true;
  interruptedPlayback = false;
  clearTimeout(reconnectTimer);
  clearTimeout(recoveryTimer);
  reconnectTimer = null;
  recoveryTimer = null;
  clearPlaybackWatchdogs();
  reconnectAttempts = 0;
  trackTracker?.stop();

  // Live radio streams should not stay half-open on iOS/Safari.
  // Fully close both media connections so Play starts a fresh stream
  // instead of resuming a stale buffered socket that can stutter.
  switchingPlayer = true;
  resetStreamPlayer(audio);
  resetStreamPlayer(eqAudio);
  switchingPlayer = false;

  updateNowPlaying('Пауза');
  renderAllPlayingStates();
}

function scheduleReconnect(delay = 1800) {
  if (!currentStation || userPaused || reconnectTimer || !navigator.onLine) return;
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    updateNowPlaying('Поток временно недоступен');
    return;
  }
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!currentStation || userPaused) return;
    clearPlaybackWatchdogs();
    playStation(currentStation, currentIndex, { recovery: true });
  }, delay);
}

function recoverInterruptedPlayback() {
  if (!currentStation || userPaused || document.visibilityState === 'hidden') return;
  if (!activeAudio().paused) {
    interruptedPlayback = false;
    return;
  }
  if (!interruptedPlayback && reconnectAttempts === 0) return;
  if (recoveryTimer) return;
  const attemptId = playbackAttemptId;
  recoveryTimer = setTimeout(() => {
    recoveryTimer = null;
    if (attemptId === playbackAttemptId && currentStation && !userPaused && activeAudio().paused && document.visibilityState !== 'hidden') {
      playStation(currentStation, currentIndex, { recovery: true });
    }
  }, 0);
}
function togglePlay() {
  if (!currentStation) {
    if (visibleStations.length) playStation(visibleStations[0], 0);
    else if (featuredStations.length) playStation(featuredStations[0], -1);
    return;
  }
  if (activeAudio().paused) playStation(currentStation, currentIndex); else pauseRadio();
}

function updateNowPlaying(status) {
  const playing = currentStation && !activeAudio().paused;
  playBtn.textContent = playing ? '❚❚' : '▶';
  miniPlayBtn.textContent = playing ? '❚❚' : '▶';
  if (!currentStation) return;

  const detail = [currentStation.country || currentStation.countrycode, firstTags(currentStation)].filter(Boolean).join(' · ');
  nowStatus.textContent = status;
  nowName.textContent = currentStation.name;
  nowDetails.textContent = detail || (currentStation.custom ? 'Моя станция' : 'Интернет-радио');
  miniName.textContent = currentStation.name;
  miniStatus.textContent = status + (eqEnabled ? ' · EQ' : '');
  miniPlayer.hidden = false;
  setCover(nowCover, currentStation);
  setCover(miniCover, currentStation);

  renderTrack();
  updateMediaMetadata();
}

function renderTrack() {
  if (!trackPanel) return;
  trackPanel.hidden = !currentStation;
  const {track,status,elapsed} = trackSnapshot;
  const setText = (element, value) => { if (element && element.textContent !== value) element.textContent = value; };
  setText(nowTrackTitle, track?.title || (status === 'loading' ? 'Получаем название трека…' : 'Данные о треке недоступны'));
  setText(nowTrackArtist, track ? track.artist || 'Исполнитель не передан' : 'Информация зависит от радиостанции');
  const format = window.RadioMetadata?.clock;
  let time = elapsed !== null && format ? (track?.duration ? `${format(elapsed)} / ${format(track.duration)}` : `${format(elapsed)} · длительность не передана`)
    : track?.duration && format ? `— / ${format(track.duration)} · время начала не передано` : 'Время трека не передано';
  if (status === 'paused') time = 'Пауза';
  setText(nowTrackTime, time);
  if (nowTrackProgress) {
    nowTrackProgress.hidden = !track?.duration || elapsed === null || status === 'paused';
    nowTrackProgress.value = track?.duration && elapsed !== null ? Math.min(100, elapsed / track.duration * 100) : 0;
  }
  setText(miniTrack, track ? [track.artist,track.title].filter(Boolean).join(' — ') : 'Название трека недоступно');
  const miniTime = track && format && status !== 'paused' && (elapsed !== null || track.duration)
    ? `${format(elapsed)}${track.duration ? ` / ${format(track.duration)}` : ''}` : '';
  setText(miniStatus, [nowStatus.textContent + (eqEnabled ? ' · EQ' : ''), miniTime].filter(Boolean).join(' · '));
}

function updateMediaMetadata() {
  if (!currentStation) return;
  const playing = !userPaused && !activeAudio().paused;
  const detail = [currentStation.country || currentStation.countrycode, firstTags(currentStation)].filter(Boolean).join(' · ');
  const track = trackSnapshot.track;

  if ('mediaSession' in navigator) {
    try {
      const metadata = {
        title: track?.title || currentStation.name,
        artist: track?.artist || detail || 'Интернет-радио',
        album: currentStation.name,
        artwork: currentStation.favicon ? [{ src: currentStation.favicon }] : []
      };
      // The song clock ticks every second; the lock-screen artwork need not.
      const key = JSON.stringify(metadata);
      if (key !== mediaMetadataKey) {
        navigator.mediaSession.metadata = new MediaMetadata(metadata);
        mediaMetadataKey = key;
      }
      const playbackState = playing ? 'playing' : 'paused';
      if (navigator.mediaSession.playbackState !== playbackState) navigator.mediaSession.playbackState = playbackState;
    } catch (_) {}
  }
}

function normalizedLogoUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value, window.location.href);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    // HTTPS pages cannot display HTTP station artwork because browsers block mixed content.
    // Try the HTTPS version first; if that host does not support it, the initials stay visible.
    if (window.location.protocol === 'https:' && parsed.protocol === 'http:') parsed.protocol = 'https:';
    return parsed.href;
  } catch (_) {
    return '';
  }
}

function logoMarkup(station, compact = false) {
  const fallback = `<span class="logo-fallback${compact ? ' compact' : ''}">${escapeHtml(initials(station.name))}</span>`;
  const src = normalizedLogoUrl(station.favicon);
  if (!src) return fallback;
  return `${fallback}<img class="station-logo-img" src="${escapeAttr(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
}

function wireLogoFallbacks(root) {
  root.querySelectorAll('.station-logo-img').forEach(img => {
    const fail = () => img.remove();
    img.addEventListener('error', fail, { once: true });
    if (img.complete && img.naturalWidth === 0) fail();
  });
}

function setCover(el, station) {
  const fallback = initials(station.name);
  const src = normalizedLogoUrl(station.favicon);
  el.style.backgroundImage = '';
  el.classList.remove('has-image');
  el.textContent = fallback;
  if (!src) return;

  const requestedStation = station.stationuuid;
  const img = new Image();
  img.referrerPolicy = 'no-referrer';
  img.onload = () => {
    if (currentStation?.stationuuid !== requestedStation) return;
    el.style.backgroundImage = `url("${src.replaceAll('\"', '%22')}")`;
    el.classList.add('has-image');
    el.textContent = '';
  };
  img.onerror = () => {
    if (currentStation?.stationuuid !== requestedStation) return;
    el.style.backgroundImage = '';
    el.classList.remove('has-image');
    el.textContent = fallback;
  };
  img.src = src;
}
function firstTags(station) {
  return String(station.tags || '').split(',').map(s => s.trim()).filter(Boolean).slice(0,2).join(' · ');
}

function moveStation(direction) {
  const pool = visibleStations.length ? visibleStations : featuredStations;
  if (!pool.length) return;
  let i = pool.findIndex(s => s.stationuuid === currentStation?.stationuuid);
  if (i < 0) i = 0; else i = (i + direction + pool.length) % pool.length;
  playStation(pool[i], i);
}

function reportClick(uuid) {
  if (!uuid || String(uuid).startsWith('custom-') || String(uuid).startsWith('curated-')) return;
  fetchWithTimeout(`${activeServer}/json/url/${encodeURIComponent(uuid)}`, {}, 3000).catch(() => {});
}

function addToHistory(station) {
  cacheStation(station);
  history = [station.stationuuid, ...history.filter(id => id !== station.stationuuid)].slice(0, 18);
  saveHistory();
  saveCache();
  renderHistory();
}
function clearHistory() {
  history = [];
  saveHistory();
  renderHistory();
  showToast('История очищена');
}

function addCustomStation(name, url, favicon) {
  const station = cleanStation({
    stationuuid: `custom-${Date.now()}`,
    name, url, url_resolved: url, favicon, custom: true, tags: 'моя станция'
  });
  customStations = [station, ...customStations];
  cacheStation(station);
  saveCustomStations();
  saveCache();
  showToast('Станция добавлена');
  setMode('custom');
  playStation(station, 0);
}
function deleteCustomStation(uuid) {
  customStations = customStations.filter(s => s.stationuuid !== uuid);
  favorites.delete(uuid);
  history = history.filter(id => id !== uuid);
  delete stationCache[uuid];
  saveCustomStations();
  saveFavorites();
  saveHistory();
  saveCache();
  renderCustomStations();
  renderHistory();
  showToast('Станция удалена');
}

function setMode(mode) {
  cancelCatalogRequest();
  currentMode = mode;
  showFavoritesOnly = false;
  favoritesToggle.classList.remove('active');
  searchInput.value = '';
  document.querySelectorAll('.chip').forEach(chip => chip.classList.toggle('active', chip.dataset.mode === mode));
  loadStations();
}

function startSleepTimer(minutes) {
  cancelSleepTimer(false);
  sleepEndsAt = Date.now() + minutes * 60_000;
  sleepTimeout = setTimeout(() => {
    pauseRadio();
    cancelSleepTimer(false);
    showToast('Таймер сна остановил радио');
  }, minutes * 60_000);
  sleepInterval = setInterval(updateSleepBadge, 1000);
  cancelSleepBtn.hidden = false;
  updateSleepBadge();
  settingsDialog.close();
  showToast(`Таймер сна: ${minutes} мин.`);
}
function cancelSleepTimer(notify = true) {
  clearTimeout(sleepTimeout);
  clearInterval(sleepInterval);
  sleepTimeout = sleepInterval = null;
  sleepEndsAt = null;
  sleepBadge.hidden = true;
  cancelSleepBtn.hidden = true;
  if (notify) showToast('Таймер сна отменён');
}
function updateSleepBadge() {
  if (!sleepEndsAt) return;
  const left = Math.max(0, sleepEndsAt - Date.now());
  const totalSec = Math.ceil(left / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  sleepBadge.textContent = `◷ ${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  sleepBadge.hidden = false;
}

async function ensureEqGraph() {
  if (eqGraphReady) {
    if (audioContext?.state === 'suspended') await audioContext.resume();
    return;
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) throw new Error('Web Audio unavailable');
  audioContext = new Ctx();
  const source = audioContext.createMediaElementSource(eqAudio);
  const low = audioContext.createBiquadFilter();
  const mid = audioContext.createBiquadFilter();
  const high = audioContext.createBiquadFilter();
  low.type = 'lowshelf'; low.frequency.value = 180;
  mid.type = 'peaking'; mid.frequency.value = 1200; mid.Q.value = 0.9;
  high.type = 'highshelf'; high.frequency.value = 5000;
  source.connect(low); low.connect(mid); mid.connect(high); high.connect(audioContext.destination);
  eqFilters = [low, mid, high];
  eqGraphReady = true;
  applyEqPreset(eqPreset);
  await audioContext.resume();
}

function applyEqPreset(name) {
  eqPreset = EQ_PRESETS[name] ? name : 'flat';
  localStorage.setItem('radioEqPreset', eqPreset);
  document.querySelectorAll('.preset').forEach(btn => btn.classList.toggle('active', btn.dataset.preset === eqPreset));
  if (!eqGraphReady) return;
  const gains = EQ_PRESETS[eqPreset];
  eqFilters.forEach((filter, i) => filter.gain.setTargetAtTime(gains[i], audioContext.currentTime, 0.03));
}

async function toggleEq(on) {
  if (!on) {
    const wasPlaying = currentStation && !activeAudio().paused;
    eqEnabled = false;
    eqToggle.checked = false;
    updateEqUi('Включается для совместимых потоков');
    if (wasPlaying) await playStation(currentStation, currentIndex, { recovery: true });
    return;
  }
  if (!currentStation) {
    eqToggle.checked = false;
    showToast('Сначала включите радиостанцию');
    return;
  }
  try {
    const wasPlaying = !activeAudio().paused;
    eqEnabled = true;
    await ensureEqGraph();
    eqToggle.checked = true;
    updateEqUi(`Включён · ${presetLabel(eqPreset)}`);
    if (wasPlaying) await playStation(currentStation, currentIndex, { recovery: true });
  } catch (err) {
    console.error(err);
    eqEnabled = false;
    eqToggle.checked = false;
    updateEqUi('Эквалайзер недоступен');
  }
}
function updateEqUi(text) { eqHint.textContent = text; }
function presetLabel(name) { return ({ flat:'Обычный', bass:'Бас', voice:'Голос', bright:'Яркий' })[name] || 'Обычный'; }

function renderAllPlayingStates() {
  renderStations();
  if (featuredStations.length) renderRail(featuredRail, featuredStations, 'featured');
  renderHistory();
}

function initials(name) {
  return (name || 'R').split(/\s+/).filter(Boolean).slice(0,2).map(w => w[0]).join('').toUpperCase();
}
function escapeHtml(str = '') {
  return String(str).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[ch]));
}
function escapeAttr(str = '') { return escapeHtml(String(str)).replace(/`/g, '&#096;'); }
function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}

$('chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (chip) setMode(chip.dataset.mode);
});
searchInput.addEventListener('input', () => {
  cancelCatalogRequest();
  const q = searchInput.value.trim();
  showFavoritesOnly = false;
  favoritesToggle.classList.remove('active');
  searchTimer = setTimeout(() => q ? loadStations({ search: q }) : loadStations(), 420);
});
clearSearch.addEventListener('click', () => {
  cancelCatalogRequest();
  searchInput.value = '';
  loadStations();
  searchInput.focus();
});
favoritesToggle.addEventListener('click', () => {
  cancelCatalogRequest();
  showFavoritesOnly = !showFavoritesOnly;
  favoritesToggle.classList.toggle('active', showFavoritesOnly);
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  if (showFavoritesOnly) renderFavorites(); else setMode(currentMode);
});
$('showRussiaBtn').addEventListener('click', () => setMode('ru'));
$('clearHistoryBtn').addEventListener('click', clearHistory);
loadMoreBtn.addEventListener('click', () => loadStations({ append: true }));
playBtn.addEventListener('click', togglePlay);
miniPlayBtn.addEventListener('click', togglePlay);
prevBtn.addEventListener('click', () => moveStation(-1));
nextBtn.addEventListener('click', () => moveStation(1));
$('miniOpenBtn').addEventListener('click', () => $('hero').scrollIntoView({ behavior:'smooth', block:'start' }));


$('settingsBtn').addEventListener('click', () => settingsDialog.showModal());
$('addStationBtn').addEventListener('click', () => addStationDialog.showModal());
$('closeAddStation').addEventListener('click', () => addStationDialog.close());
$('timerGrid').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-minutes]');
  if (btn) startSleepTimer(Number(btn.dataset.minutes));
});
cancelSleepBtn.addEventListener('click', () => cancelSleepTimer(true));
eqToggle.addEventListener('change', () => toggleEq(eqToggle.checked));
$('presetGrid').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-preset]');
  if (!btn) return;
  applyEqPreset(btn.dataset.preset);
  if (eqEnabled) updateEqUi(`Включён · ${presetLabel(eqPreset)}`);
});

$('addStationForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('customName').value.trim();
  const url = $('customUrl').value.trim();
  const favicon = $('customIcon').value.trim();
  const error = $('customFormError');
  if (!name || !/^https?:\/\//i.test(url) || (favicon && !/^https?:\/\//i.test(favicon))) {
    error.textContent = 'Проверьте название и ссылки. Ссылки должны начинаться с http:// или https://';
    error.hidden = false;
    return;
  }
  error.hidden = true;
  addCustomStation(name, url, favicon);
  e.target.reset();
  addStationDialog.close();
});

[audio, eqAudio].forEach(player => {
  player.addEventListener('playing', () => {
    if (player !== activeAudio() || userPaused || player.paused || !player.src) return;
    clearPlaybackWatchdogs();
    startProgressWatchdog(player);
    markPlaybackProgress(player);
    interruptedPlayback = false;
    updateNowPlaying('В эфире');
    trackTracker?.start();
  });

  player.addEventListener('timeupdate', () => markPlaybackProgress(player));

  player.addEventListener('pause', () => {
    if (player !== activeAudio() || switchingPlayer || !currentStation) return;
    if (!userPaused) {
      clearPlaybackWatchdogs();
      trackTracker?.stop();
      interruptedPlayback = true;
      updateNowPlaying('Воспроизведение прервано');
    } else {
      updateNowPlaying('Пауза');
    }
  });

  player.addEventListener('waiting', () => {
    if (player === activeAudio() && currentStation && !userPaused) {
      updateNowPlaying('Буферизация…');
    }
  });

  player.addEventListener('stalled', () => {
    if (player === activeAudio() && currentStation && !userPaused) {
      updateNowPlaying('Восстанавливаем поток…');
    }
  });

  player.addEventListener('error', () => {
    if (player === activeAudio() && currentStation && !userPaused) {
      clearPlaybackWatchdogs();
      trackTracker?.stop();
      updateNowPlaying('Ошибка потока');
      scheduleReconnect(500);
    }
  });

  player.addEventListener('ended', () => {
    if (player !== activeAudio() || !currentStation || userPaused || switchingPlayer) return;
    clearPlaybackWatchdogs();
    trackTracker?.stop();
    interruptedPlayback = true;
    updateNowPlaying('Эфир прерван — переподключаемся…');
    scheduleReconnect(500);
  });
});

document.addEventListener('visibilitychange', () => {
  trackTracker?.visibilityChanged();
  if (document.visibilityState === 'visible') recoverInterruptedPlayback();
});
window.addEventListener('pageshow', recoverInterruptedPlayback);
window.addEventListener('online', () => {
  if (currentStation && !userPaused && activeAudio().paused) {
    interruptedPlayback = true;
    recoverInterruptedPlayback();
  }
});

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => currentStation && playStation(currentStation, currentIndex));
  navigator.mediaSession.setActionHandler('pause', pauseRadio);
  navigator.mediaSession.setActionHandler('previoustrack', () => moveStation(-1));
  navigator.mediaSession.setActionHandler('nexttrack', () => moveStation(1));
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.error));
}

applyEqPreset(eqPreset);
renderHistory();
discoverApiServers().catch(() => {});
Promise.allSettled([loadFeatured(), loadStations()]);
