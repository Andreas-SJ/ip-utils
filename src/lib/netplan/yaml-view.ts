function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (char) => {
    if (char === '&') return '&amp;';
    if (char === '<') return '&lt;';
    if (char === '>') return '&gt;';
    if (char === '"') return '&quot;';
    return '&#39;';
  });
}

function highlightValue(value: string): string {
  if (value === '') return '';
  if (/^\[.*\]$/.test(value)) return '<span class="v">' + value + '</span>';
  if (/^&quot;.*&quot;$/.test(value)) return '<span class="s">' + value + '</span>';
  if (/^(true|false)$/.test(value)) return '<span class="b">' + value + '</span>';
  if (/^-?\d+(\.\d+)?$/.test(value)) return '<span class="n">' + value + '</span>';
  return '<span class="v">' + value + '</span>';
}

function highlightLine(line: string): string {
  if (/^\s*#/.test(line)) return '<span class="c">' + line + '</span>';

  let match = line.match(/^(\s*)(-\s+)(.*)$/);
  if (match) {
    return match[1] + '<span class="d">' + match[2] + '</span>' + highlightValue(match[3]);
  }

  match = line.match(/^(\s*)([^:]+?)(:\s*)(.*)$/);
  if (match) {
    return match[1] + '<span class="k">' + match[2] + '</span><span class="d">' + match[3] + '</span>' + highlightValue(match[4]);
  }

  return line;
}

export function buildYamlPreviewMarkup(yamlText: string): string {
  const lines = String(yamlText || '').split('\n');
  return lines
    .map((line) => {
      const safe = escapeHtml(line);
      const highlighted = highlightLine(safe);
      return '<span class="ln">' + (highlighted || '&nbsp;') + '</span>';
    })
    .join('');
}