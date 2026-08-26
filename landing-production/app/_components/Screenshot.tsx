import fs from "fs";
import path from "path";
import { SCREENS } from "../_content/site";

/**
 * Framed product screenshot. Server component: checks /public/screens at build
 * time and renders a labelled placeholder when the capture isn't there yet, so
 * the page never ships a broken image.
 */
export function hasScreen(id?: string): boolean {
  if (!id) return false;
  const s = SCREENS[id];
  if (!s) return false;
  return fs.existsSync(path.join(process.cwd(), "public", "screens", s.file)) || process.env.NEXT_PUBLIC_SHOW_PENDING === "1";
}

export function Screenshot({ id, className = "" }: { id: string; className?: string }) {
  const s = SCREENS[id];
  if (!s) return null;
  const abs = path.join(process.cwd(), "public", "screens", s.file);
  const exists = fs.existsSync(abs);
  const dim = exists ? pngSize(abs) : null;
  if (!exists && process.env.NEXT_PUBLIC_SHOW_PENDING !== "1") return null;
  const frame = s.kind === "phone" ? "shot shot-phone" : "shot shot-desktop";
  return (
    <figure className={`${frame} ${className}`.trim()}>
      <div className="shot-chrome" aria-hidden="true">
        {s.kind === "desktop" ? (<><span /><span /><span /></>) : <span className="shot-notch" />}
      </div>
      <div className="shot-body">
        {exists ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/screens/${s.file}`} alt={s.alt} width={dim?.w} height={dim?.h} decoding="async" />
        ) : (
          <div className="shot-placeholder"><span>{s.caption ?? s.alt}</span><small>screenshot pending</small></div>
        )}
      </div>
      {s.caption ? <figcaption className="shot-caption">{s.caption}</figcaption> : null}
    </figure>
  );
}

/** Width/height from a PNG's IHDR chunk — enough to reserve layout space without an image library. */
function pngSize(file: string): { w: number; h: number } | null {
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    fs.closeSync(fd);
    if (buf.toString("ascii", 1, 4) !== "PNG") return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch {
    return null;
  }
}
