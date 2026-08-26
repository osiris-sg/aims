import { PLATFORM } from "../_content/site";

export function Platform() {
  return (
    <section className="wrap section platform-stack">
      <div className="section-head">
        <span className="eyebrow">{PLATFORM.eyebrow}</span>
        <h2 className="h2">{PLATFORM.title}</h2>
      </div>
      <div className="grid6">
        {PLATFORM.items.map((it) => (
          <div key={it.title} className="platform-item span2">
            <strong>{it.title}</strong>
            <span>{it.body}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
