// create_payment_voucher / create_official_receipt (guru 2026-11-28: "make sure it can create OR, PV
// and JE as well"). The journal voucher has its own tool (create_journal_voucher). These two move
// money at the bank, so they follow the house rule for money: the tool only PREPARES and checks
// (accounts, bank, supplier / customer, the invoices and what is still owing), a Confirm card is
// shown, and the voucher is created the way its own screen creates it only when the user confirms
// (PaymentVouchersService / ReceiptsService: one journal, payment rows, numbering).
// Nothing is guessed: a bank that is not named, a payee that matches two suppliers, an invoice that
// is not open → the tool says so and AIMEE asks.

import { isBankAccount } from './ledger-activity';

const R = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const key = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const money = (n: number) => R(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Account = { code: string; name: string; accountType?: string | null };
export type Prepared<T> = { error: string; matches?: string[] } | { ok: true; summary: string; args: T };

/** An account by code (punctuation ignored) or by name; several name matches → the caller asks. */
export function resolveAccount(accounts: Account[], code: unknown, name: unknown, what: string): { account?: Account; error?: string; matches?: string[] } {
  const c = key(code);
  if (c) {
    const exact = accounts.filter((a) => key(a.code) === c);
    if (exact.length === 1) return { account: exact[0] };
  }
  const q = String(name || code || '').trim().toLowerCase();
  if (!q) return { error: `${what}: give an account code or name.` };
  const hits = accounts.filter((a) => String(a.name).toLowerCase().includes(q));
  if (hits.length === 1) return { account: hits[0] };
  if (hits.length > 1) return { error: `${what}: "${name || code}" matches several accounts. Ask the user which one.`, matches: hits.slice(0, 12).map((a) => `${a.code} ${a.name}`) };
  return { error: `${what}: no active account matches "${name || code}". Ask the user for the account code.` };
}

/** The bank / cash account money moves through. Never defaulted: an unnamed bank is asked for. */
export function resolveBank(accounts: Account[], code: unknown, name: unknown): { account?: Account; error?: string; matches?: string[] } {
  const banks = accounts.filter(isBankAccount);
  if (!String(code || name || '').trim()) return { error: 'Which bank or cash account? Ask the user (never pick one for them).', matches: banks.slice(0, 15).map((a) => `${a.code} ${a.name}`) };
  const r = resolveAccount(banks, code, name, 'Bank account');
  if (r.account) return r;
  return { error: r.error, matches: r.matches || banks.slice(0, 15).map((a) => `${a.code} ${a.name}`) };
}

async function resolveParty(prisma: any, model: 'supplier' | 'customer', organizationId: string, idOrName: unknown): Promise<{ party?: any; error?: string; matches?: string[] }> {
  const q = String(idOrName || '').trim();
  if (!q) return { error: `Which ${model}?` };
  const sel = model === 'supplier' ? { id: true, name: true, supplierCode: true } : { id: true, name: true, customerCode: true };
  if (UUID.test(q)) {
    const row = await prisma[model].findFirst({ where: { id: q, organizationId }, select: sel });
    return row ? { party: row } : { error: `No ${model} with that id in this organization.` };
  }
  const rows: any[] = await prisma[model].findMany({ where: { organizationId, name: { contains: q, mode: 'insensitive' } }, select: sel, take: 15 });
  const exact = rows.filter((r) => String(r.name).trim().toLowerCase() === q.toLowerCase());
  if (exact.length === 1) return { party: exact[0] };
  if (rows.length === 1) return { party: rows[0] };
  if (rows.length > 1) return { error: `"${q}" matches several ${model}s. Ask the user which one.`, matches: rows.map((r) => r.name) };
  return { error: `No ${model} named "${q}" in this organization.` };
}

/** Open documents picked by number (punctuation ignored) or id; no amount = what is still owing. */
function pick(open: Array<{ documentId: string; reference: string; outstanding: number; remarks?: string }>, wanted: any[], what: string) {
  const out: Array<{ documentId: string; reference: string; amount: number }> = [];
  for (const w of wanted) {
    const q = String(w?.number || w?.documentId || '').trim();
    const rows = open.filter((r) => r.documentId === q || key(r.reference) === key(q) || (q && key(r.remarks) === key(q)));
    if (rows.length !== 1) {
      return { error: `${what} "${q}" is not an open ${what.toLowerCase()} of this party (not confirmed, already paid, or the number is different).`, matches: open.slice(0, 15).map((r) => `${r.reference} (owing ${money(r.outstanding)})`) };
    }
    const amount = w?.amount == null ? R(rows[0].outstanding) : R(w.amount);
    if (!(amount > 0)) return { error: `${rows[0].reference}: the amount must be more than 0.` };
    if (amount > rows[0].outstanding + 0.005) return { error: `${rows[0].reference}: ${money(amount)} is more than the ${money(rows[0].outstanding)} still owing.` };
    out.push({ documentId: rows[0].documentId, reference: rows[0].reference, amount });
  }
  return { picks: out };
}

export interface PaymentVoucherPlan {
  date: string | null;
  bankAccountCode: string;
  payee: string;
  remarks: string | null;
  supplierId: string | null;
  picks: Array<{ documentId: string; amount: number }>;
  lines: Array<{ accountCode: string; amount: number; remarks: string | null }>;
  total: number;
}

export async function preparePaymentVoucher(
  deps: { prisma: any; openBills: (supplierId: string) => Promise<any[]> },
  organizationId: string,
  args: any,
): Promise<Prepared<PaymentVoucherPlan>> {
  const accounts: Account[] = await deps.prisma.chartOfAccount.findMany({ where: { organizationId, isActive: true }, select: { code: true, name: true, accountType: true } });
  const bank = resolveBank(accounts, args?.bankAccountCode, args?.bank);
  if (!bank.account) return { error: bank.error!, matches: bank.matches };
  const rawLines: any[] = Array.isArray(args?.lines) ? args.lines : [];
  const wanted: any[] = Array.isArray(args?.supplierInvoices) ? args.supplierInvoices : [];
  if (!rawLines.length && !wanted.length) return { error: 'Say what is being paid: supplierInvoices (invoice numbers of one supplier) and / or lines (an account and an amount each).' };

  let supplier: any = null;
  let picks: Array<{ documentId: string; reference: string; amount: number }> = [];
  if (wanted.length) {
    const s = await resolveParty(deps.prisma, 'supplier', organizationId, args?.supplier);
    if (!s.party) return { error: s.error || 'Which supplier?', matches: s.matches };
    supplier = s.party;
    const p = pick(await deps.openBills(supplier.id), wanted, 'Supplier invoice');
    if (!p.picks) return { error: p.error!, matches: p.matches };
    picks = p.picks;
  }
  const lines: PaymentVoucherPlan['lines'] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i] || {};
    const a = resolveAccount(accounts, l.accountCode, l.account, `Line ${i + 1}`);
    if (!a.account) return { error: a.error!, matches: a.matches };
    if (isBankAccount(a.account) && a.account.code === bank.account.code) return { error: `Line ${i + 1} is the same bank account the voucher pays from.` };
    const amount = R(l.amount);
    if (!amount) return { error: `Line ${i + 1} (${a.account.code} ${a.account.name}): give the amount.` };
    lines.push({ accountCode: a.account.code, amount, remarks: l.remarks ? String(l.remarks).trim().slice(0, 500) : null });
  }
  const total = R(picks.reduce((t, x) => t + x.amount, 0) + lines.reduce((t, x) => t + x.amount, 0));
  if (!(total > 0)) return { error: 'The voucher total must be more than 0.' };
  const payee = String(args?.payee || supplier?.name || '').trim().slice(0, 200);
  if (!payee) return { error: 'Who is being paid? Ask the user for the payee (the person or company that receives the money).' };
  const date = ISO.test(String(args?.date || '')) ? String(args.date) : null;
  const parts = [
    ...picks.map((x) => `${x.reference} ${money(x.amount)}`),
    ...lines.map((l) => `${l.accountCode} ${accounts.find((a) => a.code === l.accountCode)?.name || ''} ${money(l.amount)}`.replace(/\s+/g, ' ')),
  ];
  return {
    ok: true,
    summary: `Payment Voucher: pay ${payee} ${money(total)} from ${bank.account.code} ${bank.account.name}${date ? ` on ${date}` : ''} (${parts.join('; ')})`,
    args: { date, bankAccountCode: bank.account.code, payee, remarks: args?.remarks ? String(args.remarks).trim().slice(0, 2000) : null, supplierId: supplier?.id || null, picks: picks.map((x) => ({ documentId: x.documentId, amount: x.amount })), lines, total },
  };
}

export interface OfficialReceiptPlan {
  date: string | null;
  customerId: string;
  customerName: string;
  debitAccountCode: string;
  receiptAmount: number;
  chequeNo: string | null;
  remarks: string | null;
  allocations: Array<{ documentId: string; amount: number }>;
}

export async function prepareOfficialReceipt(
  deps: { prisma: any; openInvoices: (customerId: string) => Promise<any[]> },
  organizationId: string,
  args: any,
): Promise<Prepared<OfficialReceiptPlan>> {
  const accounts: Account[] = await deps.prisma.chartOfAccount.findMany({ where: { organizationId, isActive: true }, select: { code: true, name: true, accountType: true } });
  const bank = resolveBank(accounts, args?.bankAccountCode, args?.bank);
  if (!bank.account) return { error: bank.error!, matches: bank.matches };
  const c = await resolveParty(deps.prisma, 'customer', organizationId, args?.customer);
  if (!c.party) return { error: c.error || 'Which customer?', matches: c.matches };
  const wanted: any[] = Array.isArray(args?.invoices) ? args.invoices : [];
  if (!wanted.length) return { error: 'Which invoice(s) does this receipt pay? Give their numbers (list_open_invoices shows what the customer owes).' };
  const p = pick(await deps.openInvoices(c.party.id), wanted, 'Invoice');
  if (!p.picks) return { error: p.error!, matches: p.matches };
  const allocated = R(p.picks.reduce((t, x) => t + x.amount, 0));
  const amount = args?.amount == null ? allocated : R(args.amount);
  if (Math.abs(amount - allocated) > 0.005) return { error: `The receipt is ${money(amount)} but the invoices picked add up to ${money(allocated)}. Ask the user how the amount is split across the invoices.` };
  const date = ISO.test(String(args?.date || '')) ? String(args.date) : null;
  return {
    ok: true,
    summary: `Official Receipt: ${money(amount)} from ${c.party.name} into ${bank.account.code} ${bank.account.name}${date ? ` on ${date}` : ''} (${p.picks.map((x) => `${x.reference} ${money(x.amount)}`).join('; ')})`,
    args: {
      date, customerId: c.party.id, customerName: c.party.name, debitAccountCode: bank.account.code, receiptAmount: amount,
      chequeNo: args?.chequeNo ? String(args.chequeNo).trim().slice(0, 60) : null,
      remarks: args?.remarks ? String(args.remarks).trim().slice(0, 2000) : null,
      allocations: p.picks.map((x) => ({ documentId: x.documentId, amount: x.amount })),
    },
  };
}
