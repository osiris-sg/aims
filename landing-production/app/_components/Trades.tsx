import { TRADES } from "../_content/site";

/** Who it is for: a plain table of trades, what each runs on AIMS and the
 *  papers they would recognise. Rows become links once the trade pages exist. */
export function Trades() {
  return (
    <section id="trades" className="trades">
      <div className="wrap trades-inner">
        <div className="trades-head" data-reveal>
          <div>
            <p className="eyebrow eyebrow-dark" style={{ marginBottom: 12 }}>Who it is for</p>
            <h2 className="h2">Built with the Singapore companies that run on it.</h2>
          </div>
          <p>Same product, different paperwork. The documents, the vocabulary and the example messages change with the trade.</p>
        </div>
        <div className="trades-table" data-reveal>
          {TRADES.map((t) => (
            <div key={t.name} className="trade-row">
              <strong>{t.name}</strong>
              <span>{t.runs}</span>
              <span className="num">{t.papers}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
