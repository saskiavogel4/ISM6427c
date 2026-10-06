(() => {
  'use strict';

  let userName = '';
  const DEFAULT_PLACE = {
    name: 'Boca Raton',
    admin: 'Florida',
    country: 'United States',
    latitude: 26.373, // Florida Atlantic University, Boca Raton campus
    longitude: -80.1018,
    label: 'Boca Raton, FL · FAU',
  };
  const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
  const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
  const REFRESH_MS = 10 * 60 * 1000; // refresh live data every 10 minutes

  // WMO weather interpretation codes -> [description, day icon, night icon]
  const WMO = {
    0: ['Clear sky', '☀️', '🌙'],
    1: ['Mainly clear', '🌤️', '🌙'],
    2: ['Partly cloudy', '⛅', '☁️'],
    3: ['Overcast', '☁️', '☁️'],
    45: ['Fog', '🌫️', '🌫️'],
    48: ['Freezing fog', '🌫️', '🌫️'],
    51: ['Light drizzle', '🌦️', '🌧️'],
    53: ['Drizzle', '🌦️', '🌧️'],
    55: ['Heavy drizzle', '🌧️', '🌧️'],
    56: ['Freezing drizzle', '🌧️', '🌧️'],
    57: ['Heavy freezing drizzle', '🌧️', '🌧️'],
    61: ['Light rain', '🌦️', '🌧️'],
    63: ['Rain', '🌧️', '🌧️'],
    65: ['Heavy rain', '🌧️', '🌧️'],
    66: ['Freezing rain', '🌧️', '🌧️'],
    67: ['Heavy freezing rain', '🌧️', '🌧️'],
    71: ['Light snow', '🌨️', '🌨️'],
    73: ['Snow', '🌨️', '🌨️'],
    75: ['Heavy snow', '❄️', '❄️'],
    77: ['Snow grains', '🌨️', '🌨️'],
    80: ['Light showers', '🌦️', '🌧️'],
    81: ['Showers', '🌧️', '🌧️'],
    82: ['Violent showers', '⛈️', '⛈️'],
    85: ['Snow showers', '🌨️', '🌨️'],
    86: ['Heavy snow showers', '❄️', '❄️'],
    95: ['Thunderstorm', '⛈️', '⛈️'],
    96: ['Thunderstorm with hail', '⛈️', '⛈️'],
    99: ['Severe thunderstorm with hail', '⛈️', '⛈️'],
  };
  const describe = (code) => (WMO[code] || ['Unknown'])[0];
  const icon = (code, isDay = 1) => {
    const w = WMO[code];
    return w ? (isDay ? w[1] : w[2]) : '❔';
  };

  const $ = (id) => document.getElementById(id);

  // ---------- Storage (safe) ----------
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, val) { try { localStorage.setItem(key, val); } catch { /* ignore */ } },
    remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
  };

  // ---------- Theme ----------
  const themeButtons = document.querySelectorAll('[data-theme-choice]');
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function applyTheme(choice) {
    const root = document.documentElement;
    if (choice === 'light' || choice === 'dark') {
      root.dataset.theme = choice;
      store.set('theme', choice);
    } else {
      choice = 'system';
      delete root.dataset.theme;
      store.remove('theme');
    }
    themeButtons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeChoice === choice)));
    const isDark = choice === 'dark' || (choice === 'system' && darkQuery.matches);
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      m.setAttribute('content', isDark ? '#0b1220' : '#f4f7fb');
    });
  }
  themeButtons.forEach((b) => b.addEventListener('click', () => {
    applyTheme(b.dataset.themeChoice);
    notify({ theme: b.dataset.themeChoice });
  }));
  darkQuery.addEventListener?.('change', () => applyTheme(store.get('theme') || 'system'));
  applyTheme(store.get('theme') || 'system');

  // ---------- Greeting ----------
  function updateGreeting() {
    const h = new Date().getHours();
    let part = 'Good evening';
    if (h < 5) part = 'Hey there, night owl';
    else if (h < 12) part = 'Good morning';
    else if (h < 17) part = 'Good afternoon';
    $('greeting').textContent = userName ? `${part}, ${userName}! 👋` : `${part}! 👋`;
    $('greeting-sub').textContent = new Date().toLocaleDateString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric',
    });
  }

  // ---------- State ----------
  let units = store.get('units') === 'c' ? 'c' : 'f';
  let homePlace = DEFAULT_PLACE; // the signed-in user's home city from their profile
  let place = homePlace;
  let lastData = null;
  let started = false;
  let onPreferenceChange = null;

  // Tell the profile code when the user changes a preference from the main screen.
  function notify(change) {
    if (onPreferenceChange) onPreferenceChange(change);
  }

  function setPlace(p) {
    place = p;
    if (started) loadWeather();
  }

  function updateHomeButton() {
    const btn = $('home-btn');
    const isFau = homePlace === DEFAULT_PLACE;
    btn.querySelector('.label').textContent = isFau ? 'FAU' : 'Home';
    btn.firstChild.textContent = isFau ? '🦉' : '🏠';
    btn.title = `Back to ${placeLabel(homePlace)}`;
  }

  function placeLabel(p) {
    if (p.label) return p.label;
    return [p.name, p.admin || p.country].filter(Boolean).join(', ');
  }

  // ---------- Status ----------
  function setStatus(msg, isError = false) {
    const el = $('status');
    if (!msg) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = msg;
    el.classList.toggle('error', isError);
  }

  // ---------- Fetch weather ----------
  async function loadWeather() {
    $('current').setAttribute('aria-busy', 'true');
    $('place').textContent = placeLabel(place);
    const params = new URLSearchParams({
      latitude: place.latitude,
      longitude: place.longitude,
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m,uv_index',
      hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max',
      temperature_unit: units === 'c' ? 'celsius' : 'fahrenheit',
      wind_speed_unit: units === 'c' ? 'kmh' : 'mph',
      timezone: 'auto',
      forecast_days: '7',
    });
    try {
      const res = await fetch(`${FORECAST_URL}?${params}`);
      if (!res.ok) throw new Error(`Weather service returned ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.reason || 'Weather service error');
      lastData = data;
      render(data);
      setStatus('');
    } catch (err) {
      console.error(err);
      setStatus(`Couldn't load the weather right now (${err.message}). Retrying soon…`, true);
      if (!lastData) $('current-desc').textContent = 'Unavailable';
    } finally {
      $('current').setAttribute('aria-busy', 'false');
    }
  }

  // Open-Meteo returns local times like "2026-09-29T14:00" in the location's timezone.
  // Parse them as-is (no timezone shift) so labels show the location's local time.
  const parseLocal = (s) => {
    const [d, t = '00:00'] = s.split('T');
    const [y, m, day] = d.split('-').map(Number);
    const [hh, mm] = t.split(':').map(Number);
    return new Date(y, m - 1, day, hh, mm);
  };
  const fmtHour = (s) => parseLocal(s).toLocaleTimeString(undefined, { hour: 'numeric' });
  const fmtTime = (s) => parseLocal(s).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const deg = (v) => `${Math.round(v)}°`;
  const compass = (d) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(d / 45) % 8];

  function render(data) {
    const c = data.current;
    const d = data.daily;
    const h = data.hourly;

    $('current-icon').textContent = icon(c.weather_code, c.is_day);
    $('current-temp').textContent = deg(c.temperature_2m);
    $('current-desc').textContent = describe(c.weather_code);
    $('current-hilo').textContent = `H: ${deg(d.temperature_2m_max[0])}  ·  L: ${deg(d.temperature_2m_min[0])}`;
    $('updated').textContent = `Updated ${fmtTime(c.time)} local time`;

    $('stat-feels').textContent = deg(c.apparent_temperature);
    $('stat-humidity').textContent = `${Math.round(c.relative_humidity_2m)}%`;
    $('stat-wind').textContent = `${Math.round(c.wind_speed_10m)} ${units === 'c' ? 'km/h' : 'mph'} ${compass(c.wind_direction_10m)}`;
    const uv = c.uv_index ?? d.uv_index_max?.[0];
    $('stat-uv').textContent = uv == null ? '--' : `${Math.round(uv)} (${uvLabel(uv)})`;
    $('stat-rain').textContent = `${d.precipitation_probability_max[0] ?? 0}%`;
    $('stat-sun').textContent = `${fmtTime(d.sunrise[0])} / ${fmtTime(d.sunset[0])}`;

    // Hourly: start from the current hour, show 24 entries.
    const nowHour = c.time.slice(0, 13);
    let start = h.time.findIndex((t) => t.slice(0, 13) >= nowHour);
    if (start < 0) start = 0;
    const hourly = $('hourly');
    hourly.innerHTML = '';
    for (let i = start; i < Math.min(start + 24, h.time.length); i++) {
      const el = document.createElement('div');
      el.className = 'hour';
      const p = h.precipitation_probability?.[i];
      el.innerHTML = `
        <span class="muted">${i === start ? 'Now' : fmtHour(h.time[i])}</span>
        <span class="icon" aria-hidden="true">${icon(h.weather_code[i], h.is_day?.[i] ?? 1)}</span>
        <span class="t">${deg(h.temperature_2m[i])}</span>
        <span class="p">${p ? `💧${p}%` : ''}</span>`;
      el.title = describe(h.weather_code[i]);
      hourly.appendChild(el);
    }

    // Daily with temperature range bars.
    const min = Math.min(...d.temperature_2m_min);
    const max = Math.max(...d.temperature_2m_max);
    const span = Math.max(max - min, 1);
    const daily = $('daily');
    daily.innerHTML = '';
    d.time.forEach((t, i) => {
      const lo = d.temperature_2m_min[i];
      const hi = d.temperature_2m_max[i];
      const left = ((lo - min) / span) * 100;
      const width = ((hi - lo) / span) * 100;
      const name = i === 0 ? 'Today' : parseLocal(t).toLocaleDateString(undefined, { weekday: 'short' });
      const rain = d.precipitation_probability_max[i];
      const li = document.createElement('li');
      li.className = 'day';
      li.title = describe(d.weather_code[i]);
      li.innerHTML = `
        <span class="name">${name}</span>
        <span class="icon" aria-hidden="true">${icon(d.weather_code[i])}</span>
        <span class="rain">${rain ? `💧${rain}%` : ''}</span>
        <span class="range">
          <span class="lo">${deg(lo)}</span>
          <span class="bar"><span style="left:${left}%;width:${Math.max(width, 4)}%"></span></span>
          <span class="hi">${deg(hi)}</span>
        </span>
        <span class="temps-compact"><strong>${deg(hi)}</strong><span class="lo">${deg(lo)}</span></span>`;
      daily.appendChild(li);
    });
  }

  function uvLabel(uv) {
    if (uv < 3) return 'Low';
    if (uv < 6) return 'Moderate';
    if (uv < 8) return 'High';
    if (uv < 11) return 'Very high';
    return 'Extreme';
  }

  // ---------- Units ----------
  function updateUnitButton() {
    $('unit-btn').textContent = units === 'c' ? '°C' : '°F';
    $('unit-btn').title = units === 'c' ? 'Switch to Fahrenheit' : 'Switch to Celsius';
  }
  $('unit-btn').addEventListener('click', () => {
    units = units === 'c' ? 'f' : 'c';
    store.set('units', units);
    updateUnitButton();
    loadWeather();
    notify({ temperature_unit: units });
  });

  // ---------- Search ----------
  const input = $('search-input');
  const results = $('search-results');
  let searchTimer = null;
  let searchSeq = 0;
  let found = [];
  let active = -1;

  function hideResults() {
    results.hidden = true;
    results.innerHTML = '';
    found = [];
    active = -1;
  }

  function showResults(list) {
    found = list;
    active = -1;
    results.innerHTML = '';
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = 'No places found';
      results.appendChild(li);
    }
    list.forEach((p, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.dataset.index = i;
      const strong = document.createElement('div');
      strong.textContent = p.name;
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = [p.admin1, p.country].filter(Boolean).join(', ');
      li.append(strong, sub);
      li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(i); });
      results.appendChild(li);
    });
    results.hidden = false;
  }

  function choose(i) {
    const p = found[i];
    if (!p) return;
    input.value = '';
    hideResults();
    input.blur();
    setPlace({
      name: p.name,
      admin: p.admin1,
      country: p.country,
      latitude: p.latitude,
      longitude: p.longitude,
    });
  }

  async function geocode(q) {
    const params = new URLSearchParams({ name: q, count: '6', language: 'en', format: 'json' });
    const res = await fetch(`${GEOCODE_URL}?${params}`);
    if (!res.ok) throw new Error(`Place search returned ${res.status}`);
    const data = await res.json();
    return data.results || [];
  }

  async function search(q) {
    const seq = ++searchSeq;
    try {
      const list = await geocode(q);
      if (seq === searchSeq && input.value.trim()) showResults(list);
    } catch (err) {
      console.error(err);
      if (seq === searchSeq) setStatus("Couldn't search for places right now.", true);
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) { searchSeq++; hideResults(); return; }
    searchTimer = setTimeout(() => search(q), 300);
  });
  input.addEventListener('keydown', (e) => {
    const items = results.querySelectorAll('[role="option"]');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((el, i) => el.setAttribute('aria-selected', String(i === active)));
    } else if (e.key === 'Escape') {
      hideResults();
    }
  });
  input.addEventListener('blur', () => setTimeout(hideResults, 100));
  $('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (found.length) choose(active >= 0 ? active : 0);
  });

  // ---------- Location buttons ----------
  $('home-btn').addEventListener('click', () => setPlace(homePlace));

  $('locate-btn').addEventListener('click', () => {
    if (!navigator.geolocation) {
      setStatus('Location is not supported by this browser.', true);
      return;
    }
    setStatus('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPlace({
          name: 'My location',
          latitude: Math.round(pos.coords.latitude * 1e4) / 1e4,
          longitude: Math.round(pos.coords.longitude * 1e4) / 1e4,
          label: 'My location',
        });
      },
      (err) => setStatus(`Couldn't get your location (${err.message}).`, true),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  });

  // ---------- Profile ----------
  // auth.js passes in the signed-in user's profile row (see supabase/migrations).
  function applyProfile(profile) {
    const p = profile || {};
    userName = (p.first_name || '').trim();

    if (p.theme) applyTheme(p.theme);

    let reload = false;
    if ((p.temperature_unit === 'c' || p.temperature_unit === 'f') && p.temperature_unit !== units) {
      units = p.temperature_unit;
      store.set('units', units);
      updateUnitButton();
      reload = true;
    }

    const wasAtHome = place === homePlace;
    homePlace = typeof p.home_latitude === 'number' && typeof p.home_longitude === 'number'
      ? {
        name: p.home_name || 'Home',
        admin: p.home_admin || '',
        country: p.home_country || '',
        latitude: p.home_latitude,
        longitude: p.home_longitude,
      }
      : DEFAULT_PLACE;
    if (wasAtHome || !started) {
      place = homePlace;
      reload = true;
    }

    updateHomeButton();
    updateGreeting();
    if (reload && started) loadWeather();
  }

  // ---------- Start ----------
  // auth.js calls start() once someone signs in, so nothing loads before then.
  function start() {
    updateGreeting();
    if (started) return;
    started = true;
    updateUnitButton();
    updateHomeButton();
    loadWeather();
    setInterval(() => { updateGreeting(); loadWeather(); }, REFRESH_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { updateGreeting(); loadWeather(); }
    });
  }

  window.OwlWeather = {
    start,
    applyProfile,
    geocode,
    placeLabel,
    DEFAULT_PLACE,
    setUserName(name) { userName = name || ''; updateGreeting(); },
    set onPreferenceChange(fn) { onPreferenceChange = fn; },
  };
})();
