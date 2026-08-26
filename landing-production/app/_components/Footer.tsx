import Image from "next/image";
import { FOOTER } from "../_content/site";

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-inner">
        <div className="footer-cols">
          <div className="footer-brand">
            <div className="brand">
              <Image src="/aims-logo.png" alt="" width={24} height={24} />
              <span>AIMS</span>
            </div>
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
          <span>{FOOTER.legal}</span>
          <span>{FOOTER.site}</span>
        </div>
      </div>
    </footer>
  );
}
