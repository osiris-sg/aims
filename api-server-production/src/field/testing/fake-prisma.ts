/**
 * In-memory Prisma stand-in for the Field specs (test only). SiteClock's own tests are an HTTP script
 * against a real database (test/e2e.ts); its cases are ported here as service specs, so the services
 * need a database that behaves like Prisma for the queries they use:
 *   where: equality, null, { in, notIn, not, lt, lte, gt, gte, equals, mode: 'insensitive', contains }, AND, OR, NOT
 *   findMany (orderBy, take, skip), findFirst, findUnique (incl. compound keys a_b), count, groupBy (_count._all),
 *   create, createMany (skipDuplicates on @@unique / @unique), update, updateMany, upsert, delete, deleteMany,
 *   $transaction (callback or array).
 * Model defaults (@default literals, uuid(), now(), @updatedAt) are read from prisma/schema.prisma.
 */
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

type Row = Record<string, any>;
interface ModelMeta {
  defaults: Record<string, () => unknown>;
  updatedAt: string[];
  uniques: string[][];
}

let metaCache: Record<string, ModelMeta> | null = null;

function parseSchema(): Record<string, ModelMeta> {
  if (metaCache) return metaCache;
  const src = readFileSync(join(__dirname, '../../../prisma/schema.prisma'), 'utf8');
  const out: Record<string, ModelMeta> = {};
  const re = /^model (\w+) \{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const name = m[1][0].toLowerCase() + m[1].slice(1);
    const meta: ModelMeta = { defaults: {}, updatedAt: [], uniques: [] };
    for (const raw of m[2].split('\n')) {
      const line = raw.replace(/\/\/.*$/, '').trim();
      if (!line) continue;
      const u = line.match(/^@@(?:unique|id)\(\[([^\]]+)\]/);
      if (u) {
        meta.uniques.push(u[1].split(',').map((s) => s.trim()));
        continue;
      }
      const f = line.match(/^(\w+)\s+(\S+)(.*)$/);
      if (!f || line.startsWith('@@')) continue;
      const [, field, type, rest] = f;
      if (/@id\b|@unique\b/.test(rest)) meta.uniques.push([field]);
      if (/@updatedAt/.test(rest)) meta.updatedAt.push(field);
      const d = rest.match(/@default\((.*?)\)(?:\s|$)/);
      if (d) {
        const v = d[1];
        if (v === 'uuid()' || v === 'cuid()') meta.defaults[field] = () => randomUUID();
        else if (v === 'now()') meta.defaults[field] = () => new Date();
        else if (v === 'true' || v === 'false') meta.defaults[field] = () => v === 'true';
        else if (/^-?\d+(\.\d+)?$/.test(v)) meta.defaults[field] = () => Number(v);
        else if (v === '[]') meta.defaults[field] = () => [];
        else if (/^"[\s\S]*"$/.test(v)) {
          const s = JSON.parse(v);
          meta.defaults[field] = type.startsWith('Json') ? () => JSON.parse(s) : () => s;
        } else if (/^\w+$/.test(v)) meta.defaults[field] = () => v; // enum literal
      }
      if (/^(String|Int|Float|Boolean|DateTime|Json)\[\]$/.test(type) && !meta.defaults[field]) meta.defaults[field] = () => [];
      // Prisma returns null for an optional scalar that was never set.
      if (type.endsWith('?') && !meta.defaults[field] && /^[A-Z]/.test(type) && /^(String|Int|Float|Boolean|DateTime|Json|Decimal|BigInt)\?$/.test(type)) meta.defaults[field] = () => null;
    }
    out[name] = meta;
  }
  metaCache = out;
  return out;
}

const isObj = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
const cmp = (a: any, b: any) => {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  return x < y ? -1 : x > y ? 1 : 0;
};
const val = (v: any) => (v instanceof Date ? v.getTime() : v);

function matchField(v: any, cond: any): boolean {
  if (!isObj(cond)) return val(v) === val(cond) || (cond === null && v == null);
  const ci = cond.mode === 'insensitive';
  const norm = (x: any) => (ci && typeof x === 'string' ? x.toLowerCase() : x);
  for (const [op, arg] of Object.entries(cond)) {
    if (op === 'mode') continue;
    if (op === 'equals' && norm(v) !== norm(arg)) return false;
    if (op === 'in' && !(arg as any[]).map(val).includes(val(v))) return false;
    if (op === 'notIn' && (arg as any[]).map(val).includes(val(v))) return false;
    if (op === 'not' && (isObj(arg) ? matchField(v, arg) : val(v) === val(arg) || (arg === null && v == null))) return false;
    if (op === 'lt' && !(v != null && cmp(v, arg) < 0)) return false;
    if (op === 'lte' && !(v != null && cmp(v, arg) <= 0)) return false;
    if (op === 'gt' && !(v != null && cmp(v, arg) > 0)) return false;
    if (op === 'gte' && !(v != null && cmp(v, arg) >= 0)) return false;
    if (op === 'contains' && !(typeof v === 'string' && norm(v).includes(norm(arg)))) return false;
    if (op === 'has' && !(Array.isArray(v) && v.includes(arg))) return false;
  }
  return true;
}

export function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [k, c] of Object.entries(where)) {
    if (c === undefined) continue;
    if (k === 'AND') {
      if (!(Array.isArray(c) ? c : [c]).every((w) => matches(row, w))) return false;
    } else if (k === 'OR') {
      if (!(c as Row[]).some((w) => matches(row, w))) return false;
    } else if (k === 'NOT') {
      if ((Array.isArray(c) ? c : [c]).some((w) => matches(row, w))) return false;
    } else if (!matchField(row[k], c)) return false;
  }
  return true;
}

function sortRows(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows;
  const keys: Array<[string, 'asc' | 'desc']> = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o: Row) => Object.entries(o) as any);
  return [...rows].sort((a, b) => {
    for (const [k, dir] of keys) {
      const x = val(a[k]);
      const y = val(b[k]);
      if (x === y) continue;
      if (x == null) return 1;
      if (y == null) return -1;
      const r = x < y ? -1 : 1;
      return dir === 'desc' ? -r : r;
    }
    return 0;
  });
}

/** Compound unique lookups come as { a_b: { a, b } }. */
function flattenUnique(where: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(where)) {
    if (k.includes('_') && isObj(v) && !Object.keys(v).some((x) => ['in', 'not', 'lt', 'lte', 'gt', 'gte', 'equals', 'notIn'].includes(x))) Object.assign(out, v);
    else out[k] = v;
  }
  return out;
}

class FakeModel {
  rows: Row[] = [];
  constructor(private readonly name: string, private readonly meta: ModelMeta) {}

  private withDefaults(data: Row): Row {
    const row: Row = {};
    for (const [k, f] of Object.entries(this.meta.defaults)) row[k] = f();
    for (const k of this.meta.updatedAt) row[k] = new Date();
    for (const [k, v] of Object.entries(data)) if (v !== undefined) row[k] = v;
    return row;
  }

  private clash(row: Row, except?: Row): Row | undefined {
    for (const u of this.meta.uniques) {
      if (u.some((k) => row[k] == null)) continue;
      const hit = this.rows.find((r) => r !== except && u.every((k) => val(r[k]) === val(row[k])));
      if (hit) return hit;
    }
    return undefined;
  }

  private apply(row: Row, data: Row) {
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      if (isObj(v) && ('increment' in v || 'decrement' in v)) row[k] = (row[k] ?? 0) + (v.increment ?? -v.decrement);
      else if (isObj(v) && 'set' in v) row[k] = v.set;
      else row[k] = v;
    }
    for (const k of this.meta.updatedAt) row[k] = new Date();
  }

  async findMany(args: Row = {}) {
    let rows = this.rows.filter((r) => matches(r, args.where));
    rows = sortRows(rows, args.orderBy);
    if (args.skip) rows = rows.slice(args.skip);
    if (args.take != null) rows = rows.slice(0, args.take);
    return rows.map((r) => ({ ...r }));
  }
  async findFirst(args: Row = {}) {
    return (await this.findMany({ ...args, take: 1 }))[0] ?? null;
  }
  async findUnique(args: Row) {
    const w = flattenUnique(args.where);
    const r = this.rows.find((x) => matches(x, w));
    return r ? { ...r } : null;
  }
  async findFirstOrThrow(args: Row = {}) {
    const r = await this.findFirst(args);
    if (!r) throw new Error(`${this.name} not found`);
    return r;
  }
  async count(args: Row = {}) {
    return this.rows.filter((r) => matches(r, args.where)).length;
  }
  async groupBy(args: Row) {
    const rows = this.rows.filter((r) => matches(r, args.where));
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const key = JSON.stringify(args.by.map((k: string) => r[k]));
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    return [...groups.values()].map((g) => ({ ...Object.fromEntries(args.by.map((k: string) => [k, g[0][k]])), _count: { _all: g.length } }));
  }
  async create(args: Row) {
    const row = this.withDefaults(args.data);
    if (this.clash(row)) throw Object.assign(new Error(`Unique constraint failed on ${this.name}`), { code: 'P2002' });
    this.rows.push(row);
    return { ...row };
  }
  async createMany(args: Row) {
    let count = 0;
    for (const d of Array.isArray(args.data) ? args.data : [args.data]) {
      const row = this.withDefaults(d);
      if (this.clash(row)) {
        if (args.skipDuplicates) continue;
        throw Object.assign(new Error(`Unique constraint failed on ${this.name}`), { code: 'P2002' });
      }
      this.rows.push(row);
      count++;
    }
    return { count };
  }
  async update(args: Row) {
    const w = flattenUnique(args.where);
    const r = this.rows.find((x) => matches(x, w));
    if (!r) throw Object.assign(new Error(`${this.name} to update not found`), { code: 'P2025' });
    this.apply(r, args.data);
    return { ...r };
  }
  async updateMany(args: Row) {
    const rows = this.rows.filter((r) => matches(r, args.where));
    for (const r of rows) this.apply(r, args.data);
    return { count: rows.length };
  }
  async upsert(args: Row) {
    const w = flattenUnique(args.where);
    const r = this.rows.find((x) => matches(x, w));
    if (r) {
      this.apply(r, args.update);
      return { ...r };
    }
    return this.create({ data: { ...w, ...args.create } });
  }
  async delete(args: Row) {
    const w = flattenUnique(args.where);
    const i = this.rows.findIndex((x) => matches(x, w));
    if (i < 0) throw Object.assign(new Error(`${this.name} to delete not found`), { code: 'P2025' });
    return this.rows.splice(i, 1)[0];
  }
  async deleteMany(args: Row = {}) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !matches(r, args.where));
    return { count: before - this.rows.length };
  }
}

export type FakePrisma = Record<string, any> & { $transaction: (x: any) => Promise<any>; $models: Record<string, FakeModel> };

export function fakePrisma(): FakePrisma {
  const meta = parseSchema();
  const models: Record<string, FakeModel> = {};
  let proxy: any;
  const db: any = {
    $models: models,
    async $transaction(x: any) {
      if (typeof x === 'function') return x(proxy);
      return Promise.all(x);
    },
  };
  proxy = new Proxy(db, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (!meta[prop]) return undefined;
      if (!models[prop]) models[prop] = new FakeModel(prop, meta[prop]);
      return models[prop];
    },
  });
  return proxy;
}
