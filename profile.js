(() => {
  'use strict';

  // Profiles live in the Supabase `profiles` table (supabase/migrations/).
  // Row Level Security lets each signed-in user read and update only their own row.

  const $ = (id) => document.getElementById(id);
  const AVATARS = ['🦉', '☀️', '🌤️', '🌧️', '⛈️', '🌈', '❄️', '🌊', '🌴', '🐊', '🐢', '🐬', '🌺', '🦩', '🏖️', '🎓'];
  const COLUMNS = 'id, first_name, last_name, avatar_emoji, major, bio, home_name, home_admin, home_country, home_latitude, home_longitude, temperature_unit, theme';

  let user = null;
  let profile = null;
  let pendingHome = null; // home city chosen in the form but not saved yet
  let signedIn = false;

  const client = () => window.OwlAuth.client;

  // ---------- Loading ----------
  async function load(u, fallbackName) {
    user = u;
    const { data, error } = await client()
      .from('profiles').select(COLUMNS).eq('id', u.id).maybeSingle();
    if (error) throw error;
    profile = data;
    if (!profile) {
      // Accounts created before profiles existed: make one now.
      const { data: created, error: insertError } = await client()
        .from('profiles').insert({ id: u.id, first_name: fallbackName || null })
        .select(COLUMNS).single();
      if (insertError) throw insertError;
      profile = created;
    }
    applyEverywhere(fallbackName);
    return profile;
  }

  function applyEverywhere(fallbackName) {
    const p = { ...profile, first_name: profile.first_name || fallbackName || '' };
    window.OwlWeather.applyProfile(p);
    $('user-avatar').textContent = profile.avatar_emoji || '🦉';
    $('user-label').textContent = profile.first_name || 'Profile';
  }

  // Theme or °F/°C changed from the main screen: save it quietly.
  window.OwlWeather.onPreferenceChange = async (change) => {
    if (!user || !profile) return;
    Object.assign(profile, change);
    const { error } = await client().from('profiles').update(change).eq('id', user.id);
    if (error) console.error('Could not save preference', error);
  };

  // ---------- Views ----------
  function setSignedIn(value) {
    signedIn = value;
    route();
  }

  function route() {
    const wantsProfile = signedIn && window.location.hash === '#profile';
    $('profile-view').hidden = !wantsProfile;
    $('app').hidden = !signedIn || wantsProfile;
    if (wantsProfile) {
      fillForm();
      window.scrollTo(0, 0);
    }
  }
  window.addEventListener('hashchange', route);

  $('profile-back').addEventListener('click', (e) => {
    e.preventDefault();
    goToWeather();
  });

  function goToWeather() {
    if (window.location.hash) history.pushState('', document.title, window.location.pathname + window.location.search);
    route();
  }

  // ---------- Form ----------
  const form = $('profile-form');
  const bio = $('pf-bio');

  const avatarBox = $('avatar-options');
  AVATARS.forEach((emoji) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'avatar-option';
    b.setAttribute('role', 'radio');
    b.dataset.emoji = emoji;
    b.textContent = emoji;
    b.addEventListener('click', () => selectAvatar(emoji));
    avatarBox.appendChild(b);
  });

  function selectAvatar(emoji) {
    avatarBox.querySelectorAll('.avatar-option').forEach((b) => {
      b.setAttribute('aria-checked', String(b.dataset.emoji === emoji));
    });
    $('profile-avatar-preview').textContent = emoji;
  }
  const selectedAvatar = () => avatarBox.querySelector('[aria-checked="true"]')?.dataset.emoji || '🦉';

  function homeFromProfile(p) {
    if (typeof p.home_latitude !== 'number') return null;
    return { name: p.home_name, admin: p.home_admin, country: p.home_country, latitude: p.home_latitude, longitude: p.home_longitude };
  }

  function showHome(home) {
    const W = window.OwlWeather;
    $('pf-home-label').textContent = W.placeLabel(home || W.DEFAULT_PLACE);
    $('pf-home-reset').hidden = !home;
  }

  function fillForm() {
    if (!profile) return;
    $('profile-email').textContent = user?.email || '';
    $('pf-first').value = profile.first_name || '';
    $('pf-last').value = profile.last_name || '';
    $('pf-major').value = profile.major || '';
    bio.value = profile.bio || '';
    updateBioCount();
    selectAvatar(profile.avatar_emoji || '🦉');
    pendingHome = homeFromProfile(profile);
    showHome(pendingHome);
    form.querySelector(`input[name="pf-unit"][value="${profile.temperature_unit || 'f'}"]`).checked = true;
    form.querySelector(`input[name="pf-theme"][value="${profile.theme || 'system'}"]`).checked = true;
    showMessage('');
  }

  function updateBioCount() {
    $('pf-bio-count').textContent = `${bio.value.length}/280`;
  }
  bio.addEventListener('input', updateBioCount);

  function showMessage(text, isError = false) {
    const el = $('profile-message');
    el.hidden = !text;
    el.textContent = text;
    el.classList.toggle('error', isError);
    el.classList.toggle('success', !!text && !isError);
  }

  // Home city search
  const homeInput = $('pf-home-search');
  const homeResults = $('pf-home-results');
  let homeTimer = null;
  let homeSeq = 0;

  function hideHomeResults() {
    homeResults.hidden = true;
    homeResults.innerHTML = '';
  }

  homeInput.addEventListener('input', () => {
    clearTimeout(homeTimer);
    const q = homeInput.value.trim();
    if (q.length < 2) { homeSeq++; hideHomeResults(); return; }
    homeTimer = setTimeout(async () => {
      const seq = ++homeSeq;
      try {
        const list = await window.OwlWeather.geocode(q);
        if (seq !== homeSeq) return;
        homeResults.innerHTML = '';
        if (!list.length) {
          const li = document.createElement('li');
          li.className = 'muted';
          li.textContent = 'No places found';
          homeResults.appendChild(li);
        }
        list.forEach((p) => {
          const li = document.createElement('li');
          li.setAttribute('role', 'option');
          const main = document.createElement('div');
          main.textContent = p.name;
          const sub = document.createElement('div');
          sub.className = 'sub';
          sub.textContent = [p.admin1, p.country].filter(Boolean).join(', ');
          li.append(main, sub);
          li.addEventListener('mousedown', (e) => {
            e.preventDefault();
            pendingHome = { name: p.name, admin: p.admin1 || '', country: p.country || '', latitude: p.latitude, longitude: p.longitude };
            showHome(pendingHome);
            homeInput.value = '';
            hideHomeResults();
          });
          homeResults.appendChild(li);
        });
        homeResults.hidden = false;
      } catch (err) {
        console.error(err);
        showMessage("Couldn't search for places right now.", true);
      }
    }, 300);
  });
  homeInput.addEventListener('blur', () => setTimeout(hideHomeResults, 100));
  homeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault(); // don't submit the whole form from the search box
    if (e.key === 'Escape') hideHomeResults();
  });
  $('pf-home-reset').addEventListener('click', () => {
    pendingHome = null;
    showHome(null);
  });

  // Save
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const first = $('pf-first').value.trim();
    if (!first) {
      showMessage('Please enter your first name.', true);
      $('pf-first').focus();
      return;
    }
    const update = {
      first_name: first,
      last_name: $('pf-last').value.trim() || null,
      major: $('pf-major').value.trim() || null,
      bio: bio.value.trim() || null,
      avatar_emoji: selectedAvatar(),
      home_name: pendingHome ? pendingHome.name : null,
      home_admin: pendingHome ? pendingHome.admin || null : null,
      home_country: pendingHome ? pendingHome.country || null : null,
      home_latitude: pendingHome ? pendingHome.latitude : null,
      home_longitude: pendingHome ? pendingHome.longitude : null,
      temperature_unit: form.querySelector('input[name="pf-unit"]:checked')?.value || 'f',
      theme: form.querySelector('input[name="pf-theme"]:checked')?.value || 'system',
    };

    const btn = $('profile-save');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const { data, error } = await client()
        .from('profiles').update(update).eq('id', user.id).select(COLUMNS).single();
      if (error) throw error;
      profile = data;
      applyEverywhere();
      showMessage('Profile saved! ✅');
    } catch (err) {
      console.error(err);
      showMessage(`Couldn't save your profile: ${err.message || 'please try again.'}`, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save profile';
    }
  });

  function reset() {
    user = null;
    profile = null;
    pendingHome = null;
  }

  window.OwlProfile = { load, setSignedIn, reset };
})();
