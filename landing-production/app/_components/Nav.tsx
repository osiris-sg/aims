import Image from "next/image";
import Link from "next/link";
import { DEMO_URL, MODULES, SIGN_IN_URL } from "../_content/site";
import { ThemeToggle } from "./ThemeToggle";
import { MODULE_ICONS } from "./Modules";

export function Nav() {
  return (
    <header className="nav">
      <div className="wrap nav-inner">
        <Link className="brand" href="/" aria-label="AIMS home">
          <Image src="/aims-logo.png" alt="" width={28} height={28} priority />
          <span>AIMS</span>
        </Link>
        <nav className="nav-links" aria-label="Primary">
          <div className="nav-menu">
            <Link href="/#modules" className="nav-menu-trigger" aria-haspopup="true">
              Modules
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </Link>
            <div className="nav-dropdown">
              {MODULES.map((m) => (
                <Link key={m.key} href={`/modules/${m.key}`} className="nav-dropdown-item">
                  <span className="nav-dropdown-icon">{MODULE_ICONS[m.key]}</span>
                  <span>
                    <strong>{m.name}</strong>
                    <small>{m.hero}</small>
                  </span>
                </Link>
              ))}
            </div>
          </div>
          <Link href="/agent">WhatsApp agent</Link>
          <Link href="/agent#how">How it works</Link>
          <Link href="/pricing">Pricing</Link>
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
