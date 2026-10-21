const sharp = require("sharp"); const fs = require("fs"); const path = require("path");
const OUT = path.join(__dirname, "out"); fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const SVG = fs.readFileSync(path.join(__dirname, "sitejobs-mark.svg"));
const RES = "/Users/elroylee/Desktop/aims/portal-production/android/app/src/main/res";
const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const WHITE = "#ffffff";
async function mark(size) { return sharp(SVG, { density: 72 * size / 1024 }).resize(size, size).png().toBuffer(); }
// mark scaled to `scale` of a square canvas, centred, transparent elsewhere
async function markOn(canvas, scale, background) {
  const m = Math.round(canvas * scale);
  const buf = await mark(m);
  const base = sharp({ create: { width: canvas, height: canvas, channels: 4, background: background ?? { r: 0, g: 0, b: 0, alpha: 0 } } });
  return base.composite([{ input: buf, left: Math.round((canvas - m) / 2), top: Math.round((canvas - m) / 2) }]).png().toBuffer();
}
(async () => {
  // Masters
  fs.writeFileSync(path.join(OUT, "icon-1024.png"), await markOn(1024, 1, WHITE));
  fs.writeFileSync(path.join(OUT, "icon-foreground-1024.png"), await markOn(1024, 0.62));
  // Adaptive foreground PNGs (108dp canvas) and legacy mipmaps (48dp), round variant circle-masked
  for (const [d, k] of Object.entries(DENS)) {
    const fgSize = Math.round(108 * k), legacy = Math.round(48 * k);
    const dir = path.join(OUT, "res", `mipmap-${d}`); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "ic_launcher_foreground.png"), await markOn(fgSize, 0.62));
    // legacy: white square with the mark at 80%, rounded corners like a modern launcher
    const r = Math.round(legacy * 0.18);
    const squareMask = Buffer.from(`<svg width="${legacy}" height="${legacy}"><rect width="${legacy}" height="${legacy}" rx="${r}" fill="#fff"/></svg>`);
    const circleMask = Buffer.from(`<svg width="${legacy}" height="${legacy}"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}" fill="#fff"/></svg>`);
    const square = await markOn(legacy, 0.8, WHITE);
    fs.writeFileSync(path.join(dir, "ic_launcher.png"), await sharp(square).composite([{ input: squareMask, blend: "dest-in" }]).png().toBuffer());
    fs.writeFileSync(path.join(dir, "ic_launcher_round.png"), await sharp(square).composite([{ input: circleMask, blend: "dest-in" }]).png().toBuffer());
  }
  // Splash: same dimensions as the existing files, mark centred on white
  const splashDirs = fs.readdirSync(RES).filter((n) => fs.existsSync(path.join(RES, n, "splash.png")));
  for (const dirName of splashDirs) {
    const meta = await sharp(path.join(RES, dirName, "splash.png")).metadata();
    const w = meta.width, h = meta.height, m = Math.round(Math.min(w, h) * 0.28);
    const buf = await mark(m);
    const dir = path.join(OUT, "res", dirName); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "splash.png"), await sharp({ create: { width: w, height: h, channels: 3, background: WHITE } })
      .composite([{ input: buf, left: Math.round((w - m) / 2), top: Math.round((h - m) / 2) }]).png().toBuffer());
  }
  // Play Store icon 512 (full-bleed white, no alpha)
  fs.writeFileSync(path.join(OUT, "play-icon-512.png"), await sharp(await markOn(512, 1, WHITE)).removeAlpha().png().toBuffer());
  // Feature graphic 1024x500: mark + SiteJobs + tagline, navy on white
  const fgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500">
    <rect width="1024" height="500" fill="#ffffff"/>
    <text x="400" y="235" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="96" font-weight="700" fill="#24487C" letter-spacing="-2">SiteJobs</text>
    <text x="402" y="300" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="30" font-weight="400" fill="#24487C" opacity="0.85">Deliveries, scans and service reports,</text>
    <text x="402" y="342" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="30" font-weight="400" fill="#24487C" opacity="0.85">done in the field.</text>
  </svg>`;
  const markFg = await mark(360);
  fs.writeFileSync(path.join(OUT, "feature-graphic-1024x500.png"), await sharp(Buffer.from(fgSvg)).composite([{ input: markFg, left: 40, top: 70 }]).removeAlpha().png().toBuffer());
  // Preview sheet
  const sc = await sharp("/Users/elroylee/Desktop/siteclock/app/assets/icon/icon.png").resize(400, 400).png().toBuffer();
  const mine = await sharp(path.join(OUT, "icon-1024.png")).resize(400, 400).png().toBuffer();
  const fgPrev = await sharp(path.join(OUT, "res/mipmap-xxxhdpi/ic_launcher_foreground.png")).resize(400, 400).flatten({ background: "#dde3ea" }).png().toBuffer();
  const legacy = await sharp(path.join(OUT, "res/mipmap-xxxhdpi/ic_launcher_round.png")).resize(200, 200).png().toBuffer();
  const feat = await sharp(path.join(OUT, "feature-graphic-1024x500.png")).resize(1024, 500).png().toBuffer();
  fs.writeFileSync(path.join(OUT, "preview.png"), await sharp({ create: { width: 1240, height: 980, channels: 3, background: "#f3f4f6" } })
    .composite([{ input: sc, left: 20, top: 20 }, { input: mine, left: 430, top: 20 }, { input: fgPrev, left: 840, top: 20 }, { input: legacy, left: 20, top: 440 }, { input: feat, left: 108, top: 450 }]).png().toBuffer());
  console.log("done", fs.readdirSync(OUT));
})().catch((e) => { console.error(e); process.exit(1); });
