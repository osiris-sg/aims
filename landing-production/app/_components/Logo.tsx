import Image from "next/image";
import logo from "../_assets/aims-logo.png";
import logoWhite from "../_assets/aims-logo-white.png";
import mark from "../_assets/aims-mark.png";
import markWhite from "../_assets/aims-mark-white.png";

/* Imported (not /public) so the files ship under the asset prefix and still
   load on the legal pages that the portal proxies from this site. */

/** Full AIMS wordmark. Swaps to the white file in dark mode, or always when `onDark`. */
export function Logo({ height = 28, onDark = false }: { height?: number; onDark?: boolean }) {
  const width = Math.round((height * 1162) / 360);
  const alt = "AIMS, Artificial Intelligence Management Systems";
  if (onDark) return <Image src={logoWhite} alt={alt} width={width} height={height} unoptimized />;
  return (
    <>
      <Image className="only-light" src={logo} alt={alt} width={width} height={height} priority unoptimized />
      <Image className="only-dark" src={logoWhite} alt="" aria-hidden="true" width={width} height={height} priority unoptimized />
    </>
  );
}

/** The "A+" mark on its own, decorative. */
export function LogoMark({ size = 16, onDark = false }: { size?: number; onDark?: boolean }) {
  const width = Math.round((size * 390) / 360);
  if (onDark) return <Image className="logo-mark-img" src={markWhite} alt="" aria-hidden="true" width={width} height={size} unoptimized />;
  return (
    <>
      <Image className="logo-mark-img only-light" src={mark} alt="" aria-hidden="true" width={width} height={size} unoptimized />
      <Image className="logo-mark-img only-dark" src={markWhite} alt="" aria-hidden="true" width={width} height={size} unoptimized />
    </>
  );
}
