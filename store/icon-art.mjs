// Rising-columns artwork used for every icon size: weekly kilometres climbing, the last week in blue.
// `size` is the full canvas; the art sits in the central area so adaptive-icon masks never clip it.
export function columnsSvg({ size, background = null, accent = "#4f8ff7", base = "#eef0f3", scale = 0.56 }) {
  const s = size, c = s / 2, w = s * scale; // artwork width
  const u = w / 320; // artwork drawn on a 320-unit grid, centred
  const x0 = c - w / 2, y0 = c - w / 2;
  const r = (v) => Number(v.toFixed(2));
  const col = (i, h, fill) => `<rect x="${r(x0 + i * 84 * u)}" y="${r(y0 + (320 - h) * u)}" width="${r(68 * u)}" height="${r(h * u)}" rx="${r(14 * u)}" fill="${fill}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    ${background ? `<rect width="${s}" height="${s}" fill="${background}"/>` : ""}
    ${col(0, 110, base)}${col(1, 170, base)}${col(2, 235, base)}${col(3, 320, accent)}
  </svg>`;
}
