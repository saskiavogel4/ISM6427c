(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const cfg = window.OWL_CONFIG || {};
  const authView = $('auth');
  const appView = $('app');

  if (!window.supabase || !cfg.supabaseUrl || !cfg.supabasePublishableKey) {
    authView.hidden = false;
    showMessage("Sign-in isn't available right now. Please try again later.", true);
    $('auth-form').querySelectorAll('input, button').forEach((el) => { el.disabled = true; });
    return;
  }

  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  window.OwlAuth = { client };

  // ---------- Form modes ----------
  // signin | signup | forgot | recover (set a new password after a reset link)
  let mode = 'signin';
  const form = $('auth-form');
  const nameInput = $('auth-name');
  const emailInput = $('auth-email');
  const passwordInput = $('auth-password');
  const submitBtn = $('auth-submit');

  const MODES = {
    signin: { title: 'Welcome to Owl Weather', intro: 'Sign in to see live weather for Boca Raton and beyond.', submit: 'Sign in', name: false, email: true, password: true, tabs: true },
    signup: { title: 'Create your account', intro: 'Tell us your name so we can greet you.', submit: 'Create account', name: true, email: true, password: true, tabs: true },
    forgot: { title: 'Reset your password', intro: "Enter your email and we'll send you a reset link.", submit: 'Send reset link', name: false, email: true, password: false, tabs: false },
    recover: { title: 'Choose a new password', intro: 'Enter a new password for your account.', submit: 'Update password', name: false, email: false, password: true, tabs: false },
  };

  function setMode(next) {
    mode = next;
    const m = MODES[mode];
    $('auth-title').textContent = m.title;
    $('auth-intro').textContent = m.intro;
    submitBtn.textContent = m.submit;
    $('field-name').hidden = !m.name;
    $('field-email').hidden = !m.email;
    $('field-password').hidden = !m.password;
    $('auth-tabs').hidden = !m.tabs;
    $('forgot-link').hidden = mode !== 'signin';
    $('back-link').hidden = mode === 'signin' || mode === 'signup';
    passwordInput.autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
    document.querySelectorAll('#auth-tabs [data-mode]').forEach((t) => {
      t.setAttribute('aria-selected', String(t.dataset.mode === mode));
    });
    showMessage('');
  }

  function showMessage(text, isError = false) {
    const el = $('auth-message');
    el.hidden = !text;
    el.textContent = text;
    el.classList.toggle('error', isError);
    el.classList.toggle('success', !!text && !isError);
  }

  function setBusy(busy) {
    submitBtn.disabled = busy;
    submitBtn.textContent = busy ? 'Please wait…' : MODES[mode].submit;
  }

  document.querySelectorAll('#auth-tabs [data-mode]').forEach((t) => {
    t.addEventListener('click', () => setMode(t.dataset.mode));
  });
  $('forgot-link').addEventListener('click', (e) => { e.preventDefault(); setMode('forgot'); });
  $('back-link').addEventListener('click', (e) => { e.preventDefault(); setMode('signin'); });

  // Where Supabase email links (confirm account, reset password) send people back to.
  const redirectTo = window.location.origin + window.location.pathname;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const m = MODES[mode];

    if (m.name && !name) return showMessage('Please enter your first name.', true);
    if (m.email && !/^\S+@\S+\.\S+$/.test(email)) return showMessage('Please enter a valid email address.', true);
    if (m.password && password.length < 6) return showMessage('Password must be at least 6 characters.', true);

    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: { data: { first_name: name }, emailRedirectTo: redirectTo },
        });
        if (error) throw error;
        if (!data.session) {
          setMode('signin');
          emailInput.value = email;
          showMessage(`Almost there! Check ${email} for a confirmation link, then sign in.`);
        }
      } else if (mode === 'forgot') {
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
        showMessage(`If an account exists for ${email}, a reset link is on its way.`);
      } else if (mode === 'recover') {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        passwordInput.value = '';
        render(await currentSession());
      }
    } catch (err) {
      showMessage(friendlyError(err), true);
    } finally {
      setBusy(false);
    }
  });

  function friendlyError(err) {
    const msg = (err && err.message) || 'Something went wrong.';
    if (/invalid login credentials/i.test(msg)) return 'Email or password is incorrect.';
    if (/email not confirmed/i.test(msg)) return 'Please confirm your email first. Check your inbox for the link.';
    if (/already registered|already exists/i.test(msg)) return 'An account with this email already exists. Try signing in.';
    if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Please wait a minute and try again.';
    if (/failed to fetch|network/i.test(msg)) return "Can't reach the sign-in service. Check your connection.";
    return msg;
  }

  $('signout-btn').addEventListener('click', async () => {
    await client.auth.signOut();
    // Reload (without #profile) so the weather view, timers and greeting fully reset.
    window.location.replace(window.location.pathname + window.location.search);
  });

  // ---------- Session handling ----------
  async function currentSession() {
    const { data } = await client.auth.getSession();
    return data.session;
  }

  function displayName(user) {
    const meta = user.user_metadata || {};
    const n = (meta.first_name || meta.name || meta.full_name || '').trim();
    return n || (user.email || '').split('@')[0];
  }

  let loadedUserId = null;

  function render(session) {
    if (session && mode !== 'recover') {
      const user = session.user;
      authView.hidden = true;
      $('user-menu').hidden = false;
      window.OwlProfile.setSignedIn(true);
      if (loadedUserId === user.id) return; // e.g. a token refresh
      loadedUserId = user.id;
      const fallbackName = displayName(user);
      window.OwlWeather.setUserName(fallbackName);
      // Load the saved profile (name, home city, units, theme) before the first forecast.
      window.OwlProfile.load(user, fallbackName)
        .catch((err) => console.error('Could not load profile', err))
        .finally(() => window.OwlWeather.start());
    } else {
      loadedUserId = null;
      window.OwlProfile.reset();
      window.OwlProfile.setSignedIn(false);
      appView.hidden = true;
      $('user-menu').hidden = true;
      authView.hidden = false;
    }
  }

  client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      setMode('recover');
      render(null);
      return;
    }
    if (event === 'USER_UPDATED' && mode === 'recover') {
      setMode('signin');
    }
    // Defer so we never call Supabase from inside its own callback.
    setTimeout(() => render(session), 0);
  });

  setMode('signin');
  currentSession().then(render).catch(() => render(null));
})();
