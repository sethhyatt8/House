const raw = new URLSearchParams(location.search).get('legacy');

export function legacy(name) {
  if (raw == null) return false;
  if (raw === '' || raw === '1' || raw === 'all') return true;
  return raw.split(',').includes(name);
}
