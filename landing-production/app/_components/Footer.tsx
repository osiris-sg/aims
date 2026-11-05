import { FOOTER, TAGLINE } from "../_content/site";
import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-inner">
        <div className="footer-cols">
          <div className="footer-brand">
            <Logo onDark height={28} />
            <p className="footer-tag">Artificial Intelligence Management Systems</p>
            <p className="footer-blurb">{FOOTER.blurb}</p>
          </div>
          {FOOTER.columns.map((c) => (
            <div key={c.title} className="footer-col">
              <strong>{c.title}</strong>
              {c.links.map((l) => (
                <a key={l.label + l.href} href={l.href}>{l.label}</a>
              ))}
            </div>
          ))}
        </div>
        <div className="footer-legal">
          <span>{FOOTER.legal} · {FOOTER.site}</span>
          <span>{TAGLINE}</span>
        </div>
      </div>
    </footer>
  );
}
