export function basenameFromPath(path) {
  if (!path) return '';
  const parts = String(path).split(/[\\/]+/);
  return parts[parts.length - 1] || String(path);
}
