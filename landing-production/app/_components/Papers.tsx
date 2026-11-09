import { DESK, HERO } from "../_content/site";

/* A 7×7 pattern that reads as a QR code at 64px. Decorative. */
const QR = ["1110111", "1011101", "1010101", "0101010", "1010101", "1011011", "1110101"];

/** The five pieces of paper on the desk, as plain markup. Shared by the hero
 *  flow and anything else that wants to show a sample document. */

export function MessagePaper() {
  return (
    <div className="wa-bubble">
      {HERO.message.text}
      <div className="stamp">{HERO.message.time} ✓✓</div>
    </div>
  );
}

export function QuotationPaper() {
  const q = DESK.quotation;
  return (
    <div className="paper">
      <div className="paper-head"><strong>QUOTATION</strong><span className="paper-ref">{q.ref}</span></div>
      <p className="paper-party">{q.customer[0]}<br />{q.customer[1]}</p>
      <div className="paper-lines">
        {q.lines.map(([l, a]) => <div key={l}><span>{l}</span><span>{a}</span></div>)}
      </div>
      <div className="paper-total"><span>{q.total[0]}</span><span>{q.total[1]}</span></div>
    </div>
  );
}

export function DeliveryPaper() {
  const d = DESK.delivery;
  return (
    <div className="paper">
      <div className="paper-head"><strong>DELIVERY ORDER</strong><span className="paper-ref">{d.ref}</span></div>
      <p className="paper-party">{d.summary}</p>
      <div className="paper-photos" aria-hidden="true">{d.photos.map((p) => <span key={p}>{p}</span>)}</div>
      <div className="paper-sign">
        <span>Received by</span>
        <svg width="90" height="28" viewBox="0 0 90 28" aria-hidden="true"><path d="M3 20 C 14 2, 22 26, 32 14 S 48 4, 56 18 S 74 24, 87 8" fill="none" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </div>
      <p className="paper-stamp">{d.stamp}</p>
    </div>
  );
}

export function InvoicePaper() {
  const inv = DESK.invoice;
  return (
    <div className="paper">
      <div className="paper-head"><strong>TAX INVOICE</strong><span className="paper-ref">{inv.ref}</span></div>
      <div className="paper-row">
        <div className="paper-kv">
          {inv.rows.map(([k, v], i) => <div key={k}><span>{k}</span>{i === 0 ? <strong>{v}</strong> : <span>{v}</span>}</div>)}
        </div>
        <div className="qr" aria-hidden="true">
          {QR.flatMap((row, r) => row.split("").map((c, i) => <i key={`${r}-${i}`} className={c === "1" ? "on" : undefined} />))}
        </div>
      </div>
      <p className="paper-note">{inv.note}</p>
    </div>
  );
}

export function JournalPaper() {
  const j = DESK.journal;
  return (
    <div className="paper">
      <div className="paper-head"><strong>JOURNAL</strong><span className="paper-posted">{j.status}</span></div>
      <div className="paper-lines" style={{ borderTop: 0, marginTop: 8 }}>
        {j.lines.map(([l, a, indent]) => <div key={l} className={indent ? "indent" : undefined}><span>{l}</span><span>{a}</span></div>)}
      </div>
    </div>
  );
}
