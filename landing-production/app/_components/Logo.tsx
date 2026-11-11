import Image from "next/image";
import logo from "../_assets/aims-logo.png";
import logoWhite from "../_assets/aims-logo-white.png";
import mark from "../_assets/aims-mark.png";
import markWhite from "../_assets/aims-mark-white.png";

/* Imported (not /public) so the files ship under the asset prefix and still
   load on the legal pages that the portal proxies from this site. */

/** Full AIMS wordmark. `onDark` picks the cream file for ink backgrounds. */
export function Logo({ height = 28, onDark = false }: { height?: number; onDark?: boolean }) {
  const width = Math.round((height * 1579) / 440);
  const alt = "AIMS, Artificial Intelligence Management Systems";
  return <Image src={onDark ? logoWhite : logo} alt={alt} width={width} height={height} priority unoptimized />;
}

/** The "A+" mark on its own, decorative. */
export function LogoMark({ size = 16, onDark = false }: { size?: number; onDark?: boolean }) {
  const width = Math.round((size * 478) / 440);
  return <Image className="logo-mark-img" src={onDark ? markWhite : mark} alt="" aria-hidden="true" width={width} height={size} unoptimized />;
}
