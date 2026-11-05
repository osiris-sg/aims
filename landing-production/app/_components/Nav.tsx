"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DEMO_URL, MODULES, NAV_LINKS, SIGN_IN_URL } from "../_content/site";
import { ArrowIcon, ChevronDownIcon, CloseIcon, MenuIcon } from "./Icons";
import { Logo } from "./Logo";
import { MODULE_ICONS } from "./ModuleIcons";
import { ThemeToggle } from "./ThemeToggle";

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const close = () => setOpen(false);

  return (
    <header className={`nav${scrolled || open ? " is-scrolled" : ""}`}>
      <div className="wrap nav-inner">
        <Link className="brand" href="/" aria-label="AIMS home" onClick={close}>
          <Logo />
        </Link>
        <nav className="nav-links" aria-label="Primary">
          <div className="nav-menu">
            <Link href="/#modules" className="nav-link nav-menu-trigger" aria-haspopup="true">
              Modules
              <ChevronDownIcon />
            </Link>
            <div className="nav-dropdown">
              {MODULES.map((m) => (
                <Link key={m.key} href={`/modules/${m.key}`} className="nav-dropdown-item">
                  <span className="nav-dropdown-icon">{MODULE_ICONS[m.key]}</span>
                  <span>
                    <strong>{m.name}</strong>
                    <small>{m.short}</small>
                  </span>
                </Link>
              ))}
            </div>
          </div>
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="nav-link">{l.label}</Link>
          ))}
        </nav>
        <div className="nav-actions">
          <ThemeToggle />
          <a className="btn btn-ghost btn-sm nav-signin" href={SIGN_IN_URL}>Sign in</a>
          <a className="btn btn-primary btn-sm nav-demo" href={DEMO_URL}>Book a demo <ArrowIcon /></a>
          <button
            type="button"
            className="nav-burger"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="nav-mobile"
          >
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>
      {open ? (
        <div id="nav-mobile" className="nav-mobile">
          <div className="wrap nav-mobile-inner">
            <span className="nav-mobile-label">Modules</span>
            {MODULES.map((m) => (
              <Link key={m.key} href={`/modules/${m.key}`} className="nav-mobile-link" onClick={close}>
                <span className="nav-dropdown-icon">{MODULE_ICONS[m.key]}</span>
                {m.name}
              </Link>
            ))}
            <span className="nav-mobile-label">Product</span>
            {NAV_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="nav-mobile-link" onClick={close}>{l.label}</Link>
            ))}
            <div className="nav-mobile-actions">
              <a className="btn btn-ghost" href={SIGN_IN_URL}>Sign in</a>
              <a className="btn btn-primary" href={DEMO_URL} onClick={close}>Book a demo <ArrowIcon /></a>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
