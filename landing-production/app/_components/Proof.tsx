import { CLIENT_LOGOS } from "../_content/site";

/** Client-logo strip. Renders nothing until real logos are configured. */
export function Proof() {
  if (CLIENT_LOGOS.length === 0) return null;
  return (
    <section className="proof" aria-label="Customers">
      <div className="wrap proof-inner">
        <span className="proof-label">Running the books for Singapore SMEs</span>
        <div className="proof-logos">
          {CLIENT_LOGOS.map((l) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={l.src} src={l.src} alt={l.alt} />
          ))}
        </div>
      </div>
    </section>
  );
}
