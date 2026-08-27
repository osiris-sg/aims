import { SOFTWARE } from "../_content/logos";

/** "Works with" strip. Marks are masked with currentColor so they sit quietly in both themes. */
export function LogoStrip({ label = "Move your books from" }: { label?: string }) {
  return (
    <section className="logos" aria-label="Compatible accounting software">
      <div className="wrap logos-inner">
        <span className="logos-label">{label}</span>
        <ul className="logos-list">
          {SOFTWARE.map((s) => (
            <li key={s.name} className="logo">
              {s.icon ? <span className="logo-mark" style={{ WebkitMaskImage: `url(/logos/${s.icon}.svg)`, maskImage: `url(/logos/${s.icon}.svg)` }} aria-hidden="true" /> : null}
              <span className="logo-name">{s.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
