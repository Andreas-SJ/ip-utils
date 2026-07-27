import type { Skin } from './theme';

export type AppConfig = {
  hasPlanner: boolean;
  hasNetplan: boolean;
  skin: Skin;
};

export type Me = {
  username: string;
  isAdmin: boolean;
  passwordManagerEnabled: boolean;
};

export type LoginResult = {
  username: string;
  isAdmin: boolean;
  passwordManagerEnabled: boolean;
  returnTo: string;
};

async function readJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: 'include',
    ...init
  });

  if (!response.ok) {
    const fallback = await response.text().catch(() => 'Request failed');
    throw new Error(fallback || `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function getConfig(): Promise<AppConfig> {
  try {
    return await readJson<AppConfig>('/api/config');
  } catch {
    return {
      hasPlanner: true,
      hasNetplan: true,
      skin: 'futuristic'
    };
  }
}

export async function getMe(): Promise<Me | null> {
  const response = await fetch('/api/me', { credentials: 'include' });
  if (!response.ok) return null;
  return response.json() as Promise<Me>;
}

export async function login(username: string, password: string): Promise<LoginResult> {
  return readJson<LoginResult>('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
}

export async function logout(): Promise<void> {
  await fetch('/api/logout', { method: 'POST', credentials: 'include' });
}
