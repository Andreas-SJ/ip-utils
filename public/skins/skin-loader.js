(function () {
  function sanitizeSkin(v) {
    return v === 'enterprise' || v === 'futuristic' ? v : 'futuristic';
  }

  function sanitizeMode(v) {
    return v === 'light' || v === 'dark' ? v : 'dark';
  }

  function modeStorageKey(skin) {
    return 'iputils-theme-mode-' + skin;
  }

  function preferredModeForSkin(skin) {
    try {
      var fallback = skin === 'enterprise' ? 'light' : 'dark';
      return sanitizeMode(localStorage.getItem(modeStorageKey(skin)) || fallback);
    } catch (_err) {
      return skin === 'enterprise' ? 'light' : 'dark';
    }
  }

  function ensureSkinStylesheet(skin) {
    var id = 'skin-stylesheet';
    var link = document.getElementById(id);
    if (!link) {
      link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    var href = '/skins/' + skin + '.css';
    if (link.getAttribute('href') !== href) {
      link.setAttribute('href', href);
    }
  }

  function setBodyTheme(skin, mode) {
    var body = document.body;
    if (!body) return;
    body.classList.remove('skin-futuristic', 'skin-enterprise', 'mode-dark', 'mode-light');
    body.classList.add('skin-' + skin, 'mode-' + mode);
    body.classList.remove('skin-loading');
    body.classList.add('skin-ready');
  }

  function setThemeIcon(mode, iconId) {
    var id = iconId || 'theme-toggle-icon';
    var icon = document.getElementById(id);
    if (!icon) return;
    icon.src = mode === 'dark' ? '/icons/day-sunny-icon.svg' : '/icons/moon-line-icon.svg';
  }

  function applySkinAndMode(skin, mode, iconId) {
    var safeSkin = sanitizeSkin(skin);
    var safeMode = sanitizeMode(mode);
    try {
      localStorage.setItem('iputils-global-skin', safeSkin);
    } catch (_err) {}
    ensureSkinStylesheet(safeSkin);
    setBodyTheme(safeSkin, safeMode);
    setThemeIcon(safeMode, iconId);
    return { skin: safeSkin, mode: safeMode };
  }

  async function init(configSkin, iconId) {
    var skin = sanitizeSkin(configSkin || 'futuristic');
    if (!configSkin) {
      try {
        var cfg = await fetch('/api/config').then(function (r) {
          return r.ok ? r.json() : {};
        }).catch(function () {
          return {};
        });
        skin = sanitizeSkin(cfg.skin || skin);
      } catch (_err) {}
    }
    var mode = preferredModeForSkin(skin);
    return applySkinAndMode(skin, mode, iconId);
  }

  function toggleMode(currentSkin, currentMode, iconId) {
    var skin = sanitizeSkin(currentSkin);
    var mode = currentMode === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(modeStorageKey(skin), mode);
    } catch (_err) {}
    return applySkinAndMode(skin, mode, iconId);
  }

  window.IpUtilsSkinLoader = {
    sanitizeSkin: sanitizeSkin,
    sanitizeMode: sanitizeMode,
    preferredModeForSkin: preferredModeForSkin,
    modeStorageKey: modeStorageKey,
    ensureSkinStylesheet: ensureSkinStylesheet,
    setThemeIcon: setThemeIcon,
    applySkinAndMode: applySkinAndMode,
    init: init,
    toggleMode: toggleMode
  };
})();
