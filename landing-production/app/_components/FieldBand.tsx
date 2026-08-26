import { FIELD_BAND } from "../_content/site";
import { CheckIcon } from "./Icons";
import { Screenshot } from "./Screenshot";

export function FieldBand() {
  return (
    <section id="field" className="section-grey">
      <div className="wrap section field-stack">
        <div className="field-head">
          <div className="section-head">
            <span className="eyebrow">{FIELD_BAND.eyebrow}</span>
            <h2 className="h2">{FIELD_BAND.title}</h2>
            <p className="lede">{FIELD_BAND.body}</p>
          </div>
          <ul className="field-points">
            {FIELD_BAND.points.map((p) => (
              <li key={p}><CheckIcon size={16} stroke="#00a572" strokeWidth={2.2} />{p}</li>
            ))}
          </ul>
        </div>
        <div className="field-phones">
          {FIELD_BAND.screens.map((id) => <Screenshot key={id} id={id} />)}
        </div>
        <Screenshot id={FIELD_BAND.wide} className="field-wide" />
      </div>
    </section>
  );
}
