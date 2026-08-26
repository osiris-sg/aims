import Image from "next/image";
import { DEMO_URL, NAV_LINKS, SIGN_IN_URL } from "../_content/site";
import { ThemeToggle } from "./ThemeToggle";

export function Nav() {
  return (
    <header className="nav">
      <div className="wrap nav-inner">
        <a className="brand" href="#top" aria-label="AIMS home">
          <Image src="/aims-logo.png" alt="" width={28} height={28} priority />
          <span>AIMS</span>
        </a>
        <nav className="nav-links" aria-label="Primary">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href}>{l.label}</a>
          ))}
        </nav>
        <div className="nav-actions">
          <ThemeToggle />
          <a className="btn btn-ghost btn-sm" href={SIGN_IN_URL}>Sign in</a>
          <a className="btn btn-primary btn-sm" href={DEMO_URL}>Book a demo</a>
        </div>
      </div>
    </header>
  );
}
