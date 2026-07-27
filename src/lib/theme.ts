export type Skin = 'futuristic' | 'enterprise';
export type ThemeMode = 'light' | 'dark';

export type ThemeState = {
  skin: Skin;
  mode: ThemeMode;
};

type LoaderApi = {
  sanitizeSkin: (value: string) => Skin;
  sanitizeMode: (value: string) => ThemeMode;
  modeStorageKey: (skin: Skin) => string;
  preferredModeForSkin: (skin: Skin) => ThemeMode;
  applySkinAndMode: (skin: Skin, mode: ThemeMode, iconId?: string) => ThemeState;
  toggleMode: (skin: Skin, mode: ThemeMode, iconId?: string) => ThemeState;
  init: (configSkin?: Skin, iconId?: string) => Promise<ThemeState>;
};

declare global {
  interface Window {
    IpUtilsSkinLoader?: LoaderApi;
  }
}

export function sanitizeSkin(value: string | null | undefined): Skin {
  return value === 'enterprise' ? 'enterprise' : 'futuristic';
}

export function sanitizeMode(value: string | null | undefined): ThemeMode {
  return value === 'light' ? 'light' : 'dark';
}

export function modeStorageKey(skin: Skin): string {
  return `iputils-theme-mode-${skin}`;
}

export function preferredModeForSkin(skin: Skin): ThemeMode {
  const fallback: ThemeMode = skin === 'enterprise' ? 'light' : 'dark';
  try {
    return sanitizeMode(localStorage.getItem(modeStorageKey(skin)) || fallback);
  } catch {
    return fallback;
  }
}

export function bootSkinFromStorage(): Skin {
  try {
    return sanitizeSkin(localStorage.getItem('iputils-global-skin') || 'futuristic');
  } catch {
    return 'futuristic';
  }
}

export function applyTheme(skin: Skin, mode: ThemeMode, iconId = 'theme-toggle-icon'): ThemeState {
  const resolvedSkin = sanitizeSkin(skin);
  const resolvedMode = sanitizeMode(mode);

  if (window.IpUtilsSkinLoader) {
    return window.IpUtilsSkinLoader.applySkinAndMode(resolvedSkin, resolvedMode, iconId);
  }

  const html = document.documentElement;
  const body = document.body;
  html.classList.remove('skin-futuristic', 'skin-enterprise', 'mode-dark', 'mode-light');
  body.classList.remove('skin-futuristic', 'skin-enterprise', 'mode-dark', 'mode-light');

  html.classList.add(`skin-${resolvedSkin}`, `mode-${resolvedMode}`);
  body.classList.add(`skin-${resolvedSkin}`, `mode-${resolvedMode}`);
  body.classList.remove('skin-loading');
  body.classList.add('skin-ready');

  return { skin: resolvedSkin, mode: resolvedMode };
}

export async function initTheme(configSkin?: Skin, iconId = 'theme-toggle-icon'): Promise<ThemeState> {
  if (window.IpUtilsSkinLoader) {
    return window.IpUtilsSkinLoader.init(configSkin, iconId);
  }

  const skin = configSkin ?? bootSkinFromStorage();
  const mode = preferredModeForSkin(skin);
  return applyTheme(skin, mode, iconId);
}

export function toggleTheme(state: ThemeState, iconId = 'theme-toggle-icon'): ThemeState {
  if (window.IpUtilsSkinLoader) {
    return window.IpUtilsSkinLoader.toggleMode(state.skin, state.mode, iconId);
  }

  const nextMode: ThemeMode = state.mode === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(modeStorageKey(state.skin), nextMode);
  } catch {
    // noop
  }
  return applyTheme(state.skin, nextMode, iconId);
}
