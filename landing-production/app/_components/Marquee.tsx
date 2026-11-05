import { MARQUEE } from "../_content/site";
import { LogoMark } from "./Logo";

/** Slow editorial ticker under the hero. Decorative, so hidden from screen readers. */
export function Marquee() {
  const row = [...MARQUEE, ...MARQUEE];
  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee-track">
        {[0, 1].map((half) => (
          <div key={half} className="marquee-half">
            {row.map((item, i) => (
              <span key={`${half}-${i}`} className="marquee-item">
                <span>{item}</span>
                <LogoMark size={14} />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
