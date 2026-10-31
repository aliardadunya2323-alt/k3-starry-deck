// v4 room emblems use a 300-unit canvas and explicit ring/core groups.
// Keep legacy factory options unchanged for every existing unversioned SVG.
export function emblemFactoryOptions(svg, legacy) {
  if (svg?.getAttribute('data-svg-version') !== 'v4') return legacy;
  const box = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (box.length !== 4 || !box.every(Number.isFinite) || box[0] !== 0 || box[1] !== 0 || box[2] <= 0 || box[2] !== box[3]) {
    throw new TypeError('Versioned room emblem requires a square, zero-origin viewBox');
  }
  const ratio = box[2] / legacy.size;
  // Fit the declared canvas; v4 glyphs can extend beyond the legacy ring ratio.
  return { ...legacy, size: box[2], outerR: box[2] / 2,
    splitRadius: legacy.splitRadius * ratio, strokeMax: legacy.strokeMax * ratio,
    splitByGroup: true };
}
