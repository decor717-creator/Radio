// Public station APIs only. Reading song information never opens an audio stream.
// A missing title, artist or broadcast timestamp stays unknown.
(function (global) {
  const text = value => typeof value === 'string' ? value.trim().slice(0, 300) : '';
  const number = value => value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  function streamKey(value) {
    try {
      const url = new URL(value);
      const proxy = url.pathname.match(/^\/radio\/(\d+)\/(.*)$/);
      return `${url.hostname.toLowerCase()}:${proxy ? proxy[1] : url.port}/${proxy ? proxy[2] : url.pathname.replace(/^\//, '')}`;
    } catch { return ''; }
  }
  function endpoints(station) {
    try {
      const url = new URL(station.url);
      if (url.protocol !== 'https:') return [];
      const results = [], shortcode = url.pathname.match(/^\/listen\/([^/]+)\//)?.[1];
      if (shortcode) results.push({type:'azuracast',url:`${url.origin}/api/nowplaying/${shortcode}`,direct:true});
      results.push({type:'icecast',url:`${url.origin}/status-json.xsl`});
      if (!shortcode) results.push({type:'azuracast',url:`${url.origin}/api/nowplaying`});
      const sid = url.searchParams.get('sid') || url.pathname.match(/^\/stream\/(\d+)/)?.[1];
      if (sid || /^\/;/.test(url.pathname)) results.push({type:'shoutcast',url:`${url.origin}/stats?sid=${encodeURIComponent(sid || '1')}&json=1`});
      return results;
    } catch { return []; }
  }
  function splitTitle(raw, artist = '') {
    const value = text(raw), named = text(artist);
    if (named) return {title:value,artist:named};
    const separator = value.indexOf(' - ');
    return separator > 0 ? {artist:value.slice(0, separator),title:value.slice(separator + 3)} : {artist:'',title:value};
  }
  function normalize(data, endpoint, station, now = Date.now()) {
    let row, title = '', artist = '', id = '', startedAt = null, duration = null, elapsed = null;
    if (endpoint.type === 'azuracast') {
      const rows = Array.isArray(data) ? data : [data];
      row = rows.find(item => {
        if (!item?.now_playing) return false;
        if (endpoint.direct && !Array.isArray(data)) return true;
        const stationData = item.station;
        const urls = [stationData?.listen_url, ...(Array.isArray(stationData?.mounts) ? stationData.mounts : []).map(m => m?.url), ...(Array.isArray(stationData?.remotes) ? stationData.remotes : []).map(m => m?.url)];
        return urls.some(url => streamKey(url) && streamKey(url) === streamKey(station.url));
      })?.now_playing;
      if (!row) return null;
      artist = text(row.song?.artist); title = text(row.song?.title);
      if (!title) ({title,artist} = splitTitle(row.song?.text, artist));
      id = text(row.song?.id);
      const playedAt = number(row.played_at);
      if (playedAt > 0 && playedAt * 1000 <= now + 5000 && now - playedAt * 1000 < 86400000) startedAt = playedAt * 1000;
      duration = number(row.duration);
      elapsed = number(row.elapsed);
    } else if (endpoint.type === 'icecast') {
      const source = data?.icestats?.source;
      const rows = Array.isArray(source) ? source : source ? [source] : [];
      row = rows.find(item => streamKey(item.listenurl) && streamKey(item.listenurl) === streamKey(station.url));
      if (!row) return null;
      ({title,artist} = splitTitle(row.title, row.artist));
      // stream_start describes the server connection, not this song: never use it.
    } else if (endpoint.type === 'shoutcast') {
      ({title,artist} = splitTitle(data?.songtitle));
    }
    if (!title) return null;
    duration = duration > 0 && duration <= 86400 ? duration : null;
    elapsed = elapsed >= 0 && elapsed <= 86400 ? elapsed : null;
    if (startedAt !== null) elapsed = Math.max(0, (now - startedAt) / 1000);
    if (duration !== null && elapsed !== null) elapsed = Math.min(duration, elapsed);
    return {title,artist,duration,elapsed,startedAt,receivedAt:now,key:`${id || artist + '\n' + title}:${startedAt ?? ''}`};
  }
  function position(track, now = Date.now()) {
    if (!track || track.elapsed === null) return null;
    const elapsed = Math.max(0, track.elapsed + (now - track.receivedAt) / 1000);
    return track.duration === null ? elapsed : Math.min(track.duration, elapsed);
  }
  function clock(seconds) {
    if (seconds === null || !Number.isFinite(seconds)) return '—';
    const s = Math.floor(Math.max(0, seconds));
    return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`
      : `${Math.floor(s / 60)}:${String(s % 60).padStart(2,'0')}`;
  }
  class Tracker {
    constructor({fetch:request = global.fetch.bind(global), now = Date.now, onChange = () => {}, visible = () => global.document?.visibilityState !== 'hidden'} = {}) {
      this.fetch = request; this.now = now; this.onChange = onChange; this.visible = visible;
      this.station = null; this.track = null; this.status = 'idle'; this.running = false;
      this.generation = 0; this.busy = false; this.controller = null; this.preferred = null;
      this.pollTimer = null; this.clockTimer = null; this.failures = 0;
    }
    emit() {
      if (this.track && this.now() - this.track.receivedAt > 45000) { this.track = null; this.status = 'unavailable'; }
      this.onChange({track:this.track,status:this.status,elapsed:position(this.track,this.now())});
    }
    setStation(station) {
      this.stop(); this.station = station; this.track = null; this.preferred = null; this.failures = 0;
      this.status = 'loading'; this.emit();
    }
    start() {
      if (!this.station) return;
      if (this.running) return;
      this.running = true; this.status = 'loading'; this.emit();
      if (!this.visible()) return;
      this.clockTimer = global.setInterval(() => this.emit(), 1000);
      return this.poll();
    }
    stop() {
      this.running = false; this.generation++; this.busy = false;
      this.controller?.abort(); this.controller = null;
      global.clearTimeout(this.pollTimer); global.clearInterval(this.clockTimer);
      this.pollTimer = this.clockTimer = null;
      this.status = 'paused'; this.emit();
    }
    visibilityChanged() {
      if (!this.running) { this.emit(); return; }
      // Hidden pages cannot reliably refresh songs. Keep the station on the
      // lock screen instead of presenting this title as current indefinitely.
      this.track = null;
      this.stop(); this.start();
    }
    async poll() {
      if (!this.running || !this.visible() || this.busy) return;
      this.busy = true;
      const generation = this.generation, station = this.station;
      const candidates = endpoints(station);
      const ordered = this.preferred ? [this.preferred, ...candidates.filter(e => e.url !== this.preferred.url)] : candidates;
      let successful = false;
      try {
        for (const endpoint of ordered) {
          if (!this.running || generation !== this.generation) return;
          const controller = new AbortController(); this.controller = controller;
          const timeout = global.setTimeout(() => controller.abort(), 4000);
          try {
            const response = await this.fetch(endpoint.url, {signal:controller.signal,cache:'no-store',credentials:'omit',headers:{Accept:'application/json'}});
            if (!response.ok) throw Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (!this.running || generation !== this.generation) return;
            if (controller.signal.aborted) continue;
            const track = normalize(data, endpoint, station, this.now());
            if (!track) continue;
            this.track = track; this.status = 'fresh'; this.preferred = endpoint; this.failures = 0; successful = true;
            this.emit(); break;
          } catch {
            if (!this.running || generation !== this.generation) return;
          } finally { global.clearTimeout(timeout); }
        }
        if (!successful && generation === this.generation) {
          this.failures++;
          // A failed refresh cannot present an old song as the current one.
          this.track = null; this.status = 'unavailable'; this.emit();
        }
      } finally {
        if (generation === this.generation) {
          this.busy = false; this.controller = null;
          if (this.running && this.visible()) this.pollTimer = global.setTimeout(() => this.poll(), successful ? 15000 : Math.min(120000, 15000 * 2 ** Math.min(this.failures, 3)));
        }
      }
    }
  }
  global.RadioMetadata = {Tracker,normalize,endpoints,position,clock,streamKey};
})(globalThis);
