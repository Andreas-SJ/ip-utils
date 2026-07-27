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

  function currentPageName() {
    var p = (window.location && window.location.pathname) || '/';
    if (p === '/' || p === '') return 'index';
    if (p.indexOf('/admin') === 0) return 'admin';
    if (p.indexOf('/ip-planner') === 0) return 'ip-planner';
    if (p.indexOf('/login') === 0) return 'login';
    if (p.indexOf('/netplan-gen') === 0) return 'netplan-gen';
    return 'index';
  }

  function ensureSkinStylesheets(skin) {
    var baseId = 'skin-base-stylesheet';
    var pageId = 'skin-page-stylesheet';

    var baseLink = document.getElementById(baseId);
    if (!baseLink) {
      baseLink = document.createElement('link');
      baseLink.id = baseId;
      baseLink.rel = 'stylesheet';
      document.head.appendChild(baseLink);
    }
    var baseHref = '/skins/' + skin + '.css';
    if (baseLink.getAttribute('href') !== baseHref) {
      baseLink.setAttribute('href', baseHref);
    }

    var pageLink = document.getElementById(pageId);
    if (!pageLink) {
      pageLink = document.createElement('link');
      pageLink.id = pageId;
      pageLink.rel = 'stylesheet';
      document.head.appendChild(pageLink);
    }
    var pageHref = '/skins/' + skin + '/' + currentPageName() + '.css';
    if (pageLink.getAttribute('href') !== pageHref) {
      pageLink.setAttribute('href', pageHref);
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
    ensureSkinStylesheets(safeSkin);
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
    ensureSkinStylesheets: ensureSkinStylesheets,
    setThemeIcon: setThemeIcon,
    applySkinAndMode: applySkinAndMode,
    init: init,
    toggleMode: toggleMode
  };
})();
