export type NetplanConfig = {
  hasPlanner?: boolean;
  skin?: string;
};

export type NetplanMe = {
  username: string;
  isAdmin: boolean;
};

export function buildNetplanNavHtml(
  cfg: NetplanConfig,
  me: NetplanMe | null,
  esc: (value: unknown) => string
): string {
  let html = '';

  if (cfg.hasPlanner) {
    html += '<a href="/ip-planner">ip-planner</a>';
  } else {
    html += '<a href="#" id="btn-planner-missing" class="nav-disabled" aria-disabled="true">ip-planner</a>';
  }

  if (me) {
    if (html) html += ' &nbsp;&middot;&nbsp; ';
    html = '<span class="u-name">' + esc(me.username) + '</span> &nbsp;&middot;&nbsp; ' + html;
    if (me.isAdmin) html += ' &nbsp;&middot;&nbsp; <a href="/admin">admin</a>';
    html += ' &nbsp;&middot;&nbsp; <button id="btn-theme-toggle" class="theme-toggle" title="Toggle dark/light mode" aria-label="Toggle dark/light mode"><img id="theme-toggle-icon" class="theme-icon" src="/icons/day-sunny-icon.svg" alt="" /></button>';
    html += ' &nbsp;&middot;&nbsp; <a href="#" id="btn-logout">logout</a>';
  } else if (cfg.hasPlanner) {
    html += ' &nbsp;&middot;&nbsp; <button id="btn-theme-toggle" class="theme-toggle" title="Toggle dark/light mode" aria-label="Toggle dark/light mode"><img id="theme-toggle-icon" class="theme-icon" src="/icons/day-sunny-icon.svg" alt="" /></button>';
    html += ' &nbsp;&middot;&nbsp; <a href="/login">log in</a>';
  }

  return html;
}