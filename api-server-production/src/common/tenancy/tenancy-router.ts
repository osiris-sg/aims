/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from 'fs';
import * as path from 'path';
import { Prisma as FullPrisma } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { currentOrgId, currentTenantStore } from './tenant-context';

/**
 * Routes `this.prisma.<model>.<op>()` to the right Prisma client:
 *   platform models → platform client (schema "platform")
 *   legacy models   → the original client (schema "public", archive-only tables)
 *   org models      → the org's own client (schema "org_<name>", its own Prisma file)
 *
 * Which org: args (where/data.organizationId) → request context → fan-out across
 * every org (crons, public token lookups, the auth guard's cross-org role read).
 *
 * Org shapes differ (CIEL's Project ≠ Biofuel's), so args are checked against the
 * target org's own model before running: unknown select/include keys are dropped
 * and filled back with null / [] (or the real row, for relations into platform
 * such as `organization`), unknown data keys are dropped, and a where-filter on a
 * column the org doesn't have matches nothing.
 */

type FieldInfo = { name: string; kind: string; type: string; isList: boolean; from?: string[]; to?: string[] };
type ModelMap = Map<string, Map<string, FieldInfo>>;

const READS = new Set(['findMany', 'findFirst', 'findUnique', 'findFirstOrThrow', 'findUniqueOrThrow', 'count', 'aggregate', 'groupBy']);
const WRITES_UNIQUE = new Set(['update', 'delete', 'upsert']);
const WRITES_MANY = new Set(['updateMany', 'deleteMany']);
const CREATES = new Set(['create', 'createMany', 'createManyAndReturn']);
const OPS = [...READS, ...WRITES_UNIQUE, ...WRITES_MANY, ...CREATES];

export class TenancyError extends Error {
  constructor(msg: string) {
    super(`[tenancy] ${msg}`);
  }
}

function modelsOf(dmmf: any): ModelMap {
  const out: ModelMap = new Map();
  for (const m of dmmf.datamodel.models) {
    const f = new Map<string, FieldInfo>();
    for (const x of m.fields) {
      f.set(x.name, { name: x.name, kind: x.kind, type: x.type, isList: x.isList, from: x.relationFromFields, to: x.relationToFields });
    }
    out.set(m.name, f);
  }
  return out;
}

const accessorOf = (model: string) => model[0].toLowerCase() + model.slice(1);

function neonAdapter(schema: string) {
  const url = new URL(process.env.DATABASE_URL as string);
  url.searchParams.delete('pool_timeout');
  url.searchParams.delete('connect_timeout');
  url.searchParams.delete('schema');
  return new PrismaNeon({ connectionString: url.toString() }, { schema });
}

function notFound(model: string, method: string) {
  const e: any = new FullPrisma.PrismaClientKnownRequestError(`No ${model} found (${method})`, { code: 'P2025', clientVersion: FullPrisma.prismaVersion.client });
  return e;
}

function emptyResult(method: string, args: any, model: string) {
  switch (method) {
    case 'findMany':
    case 'groupBy':
    case 'createManyAndReturn':
      return [];
    case 'findFirst':
    case 'findUnique':
      return null;
    case 'findFirstOrThrow':
    case 'findUniqueOrThrow':
      throw notFound(model, method);
    case 'count':
      if (args?.select && typeof args.select === 'object') return Object.fromEntries(Object.keys(args.select).map((k) => [k, 0]));
      return 0;
    case 'aggregate': {
      const r: any = {};
      for (const k of Object.keys(args || {})) {
        if (!k.startsWith('_')) continue;
        const sel = args[k];
        if (k === '_count' && sel === true) r[k] = 0;
        else if (sel && typeof sel === 'object') r[k] = Object.fromEntries(Object.keys(sel).map((f) => [f, k === '_count' ? 0 : null]));
      }
      return r;
    }
    case 'updateMany':
    case 'deleteMany':
      return { count: 0 };
    default:
      return null;
  }
}

/** A deferred operation: runs when awaited, or inside a real $transaction([...]) when batched. */
class LazyOp {
  private p?: Promise<any>;
  constructor(
    readonly router: TenancyRouter,
    readonly model: string,
    readonly method: string,
    readonly args: any,
  ) {}
  private run() {
    if (!this.p) this.p = this.router.exec(this.model, this.method, this.args);
    return this.p;
  }
  then(a?: any, b?: any) {
    return this.run().then(a, b);
  }
  catch(b?: any) {
    return this.run().catch(b);
  }
  finally(f?: any) {
    return this.run().finally(f);
  }
  get [Symbol.toStringTag]() {
    return 'PrismaPromise';
  }
}

interface OrgEntry {
  schema: string;
  client: any;
  models: ModelMap;
}

export class TenancyRouter {
  private full: ModelMap = modelsOf(FullPrisma.dmmf);
  private platform!: any;
  private platformModels!: ModelMap;
  private orgs = new Map<string, OrgEntry>(); // schema → client
  private registry = new Map<string, string>(); // organizationId → schema
  private registryAt = 0;
  private legacyModels = new Set<string>();
  private tenantModels = new Set<string>();
  private accessors = new Map<string, string>(); // accessor → model
  private warned = new Set<string>();

  constructor(private readonly legacy: any) {
    const root = process.cwd();
    const load = (name: string) => require(path.join(root, 'node_modules/.prisma-tenancy', name));
    const P = load('platform');
    this.platform = new P.PrismaClient({ adapter: neonAdapter('platform') });
    this.platformModels = modelsOf(P.Prisma.dmmf);
    const orgDir = path.join(root, 'prisma/tenancy/orgs');
    for (const file of fs.readdirSync(orgDir).filter((f) => f.endsWith('.prisma'))) {
      const name = file.replace(/\.prisma$/, '');
      const C = load(`org-${name}`);
      const schema = `org_${name}`;
      const models = modelsOf(C.Prisma.dmmf);
      this.orgs.set(schema, { schema, client: new C.PrismaClient({ adapter: neonAdapter(schema) }), models });
      for (const m of models.keys()) this.tenantModels.add(m);
    }
    for (const m of this.full.keys()) {
      if (!this.platformModels.has(m) && !this.tenantModels.has(m)) this.legacyModels.add(m);
    }
    for (const m of [...this.full.keys(), ...this.platformModels.keys(), ...this.tenantModels]) this.accessors.set(accessorOf(m), m);
  }

  private warnOnce(key: string, msg: string) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[tenancy] ${msg}`);
  }

  // ── registry ────────────────────────────────────────────────────────────
  async loadRegistry(force = false) {
    if (!force && Date.now() - this.registryAt < 60_000) return;
    const rows: any[] = await this.platform.orgTenant.findMany({ where: { status: 'ACTIVE' } });
    this.registry = new Map(rows.map((r) => [r.organizationId, r.schemaName]));
    this.registryAt = Date.now();
  }

  private async schemaFor(orgId: string): Promise<OrgEntry | null> {
    await this.loadRegistry();
    let s = this.registry.get(orgId);
    if (!s) {
      await this.loadRegistry(true);
      s = this.registry.get(orgId);
    }
    return s ? this.orgs.get(s) ?? null : null;
  }

  private allOrgs(): OrgEntry[] {
    const live = new Set(this.registry.values());
    return [...this.orgs.values()].filter((o) => live.size === 0 || live.has(o.schema));
  }

  /** Org id stated by the query itself (where / data / create). */
  private orgFromArgs(args: any): string | string[] | null {
    const pick = (v: any): string | string[] | null => {
      if (typeof v === 'string') return v;
      if (v && typeof v === 'object') {
        if (typeof v.equals === 'string') return v.equals;
        if (Array.isArray(v.in) && v.in.every((x: any) => typeof x === 'string')) return v.in;
      }
      return null;
    };
    const w = args?.where;
    if (w) {
      const r = pick(w.organizationId);
      if (r) return r;
    }
    for (const key of ['data', 'create']) {
      let d = args?.[key];
      if (Array.isArray(d)) d = d[0];
      if (d && typeof d === 'object') {
        if (typeof d.organizationId === 'string') return d.organizationId;
        if (typeof d.organization?.connect?.id === 'string') return d.organization.connect.id;
      }
    }
    return null;
  }

  // ── argument checking against the target org's model ───────────────────
  private cleanSelect(model: string, sel: any, target: ModelMap, fixups: any[], pathArr: string[]) {
    const tf = target.get(model)!;
    const ff = this.full.get(model);
    for (const key of Object.keys(sel)) {
      if (key === '_count') {
        const c = sel[key];
        if (c && typeof c === 'object' && c.select) {
          for (const k of Object.keys(c.select)) if (!tf.has(k)) delete c.select[k];
        }
        continue;
      }
      const f = tf.get(key);
      if (!f) {
        const fi = ff?.get(key);
        fixups.push({ path: pathArr, key, value: sel[key], field: fi, model });
        delete sel[key];
        continue;
      }
      const v = sel[key];
      if (f.kind === 'object' && v && typeof v === 'object') {
        if (v.select) this.cleanSelect(f.type, v.select, target, fixups, [...pathArr, key]);
        if (v.include) this.cleanSelect(f.type, v.include, target, fixups, [...pathArr, key]);
        if (v.where) this.cleanWhere(f.type, v.where, target);
        if (v.orderBy) v.orderBy = this.cleanOrderBy(f.type, v.orderBy, target);
      }
    }
  }

  /** Returns false when the filter can never match in this org (column not in its schema). */
  private cleanWhere(model: string, where: any, target: ModelMap): boolean {
    const tf = target.get(model);
    if (!tf || !where || typeof where !== 'object') return true;
    for (const key of Object.keys(where)) {
      if (key === 'AND' || key === 'OR' || key === 'NOT') continue;
      if (tf.has(key)) continue;
      const v = where[key];
      const isNull = v === null || v === undefined || (v && typeof v === 'object' && Object.keys(v).length === 1 && v.equals === null);
      delete where[key];
      if (!isNull) {
        const fi = this.full.get(model)?.get(key);
        // relation filter into platform (e.g. where.organization) — drop it; org scoping comes from the schema
        if (fi?.kind === 'object' && this.platformModels.has(fi.type)) continue;
        return false;
      }
    }
    return true;
  }

  private cleanOrderBy(model: string, ob: any, target: ModelMap) {
    const tf = target.get(model);
    if (!tf) return ob;
    const keep = (o: any) => o && typeof o === 'object' && Object.keys(o).every((k) => tf.has(k) || k === '_count' || k === '_relevance');
    if (Array.isArray(ob)) return ob.filter(keep);
    return keep(ob) ? ob : undefined;
  }

  private cleanData(model: string, data: any, target: ModelMap) {
    const tf = target.get(model);
    if (!tf || !data || typeof data !== 'object') return;
    for (const key of Object.keys(data)) {
      if (tf.has(key)) continue;
      const fi = this.full.get(model)?.get(key);
      if (key === 'organization' && data[key]?.connect?.id && tf.has('organizationId')) {
        data.organizationId = data[key].connect.id;
      } else if (fi?.kind === 'object' && fi.from?.length === 1 && data[key]?.connect && tf.has(fi.from[0])) {
        // relation into platform (e.g. customer.salesman) → keep the plain id
        const refKey = fi.to?.[0] ?? 'id';
        if (data[key].connect[refKey] !== undefined) data[fi.from[0]] = data[key].connect[refKey];
      } else if (data[key] !== null && data[key] !== undefined && !(Array.isArray(data[key]) && !data[key].length)) {
        this.warnOnce(`data:${model}.${key}`, `dropping ${model}.${key} on write: not in this org's schema`);
      }
      delete data[key];
    }
  }

  private prepare(model: string, method: string, argsIn: any, target: ModelMap) {
    const args = argsIn === undefined ? undefined : structuredCloneSafe(argsIn);
    const fixups: any[] = [];
    let possible = true;
    if (args) {
      if (args.where && !this.cleanWhere(model, args.where, target)) possible = false;
      if (args.select) this.cleanSelect(model, args.select, target, fixups, []);
      if (args.include) this.cleanSelect(model, args.include, target, fixups, []);
      if (args.orderBy) {
        const ob = this.cleanOrderBy(model, args.orderBy, target);
        if (ob === undefined) delete args.orderBy;
        else args.orderBy = ob;
      }
      if (Array.isArray(args.distinct)) args.distinct = args.distinct.filter((k: string) => target.get(model)!.has(k));
      if (args.data) {
        if (Array.isArray(args.data)) args.data.forEach((d: any) => this.cleanData(model, d, target));
        else this.cleanData(model, args.data, target);
      }
      if (args.create) this.cleanData(model, args.create, target);
      if (args.update) this.cleanData(model, args.update, target);
      if (method === 'aggregate' || method === 'groupBy') {
        for (const k of ['_sum', '_avg', '_min', '_max', '_count']) {
          if (args[k] && typeof args[k] === 'object') for (const f of Object.keys(args[k])) if (f !== '_all' && !target.get(model)!.has(f)) delete args[k][f];
        }
        if (Array.isArray(args.by)) args.by = args.by.filter((k: string) => target.get(model)!.has(k));
      }
    }
    return { args, fixups, possible };
  }

  /** Put back what `prepare` dropped from select/include: null / [] or the real platform row. */
  private async applyFixups(result: any, fixups: any[]) {
    if (!fixups.length || result == null) return result;
    for (const fx of fixups) {
      const rows: any[] = [];
      const walk = (node: any, depth: number) => {
        if (node == null) return;
        if (Array.isArray(node)) return node.forEach((n) => walk(n, depth));
        if (depth === fx.path.length) return rows.push(node);
        walk(node[fx.path[depth]], depth + 1);
      };
      walk(result, 0);
      if (!rows.length) continue;
      const fi: FieldInfo | undefined = fx.field;
      if (fi?.kind === 'object' && this.platformModels.has(fi.type) && fi.from?.length === 1 && !fi.isList) {
        // relation into platform: fetch the real rows (e.g. document.organization)
        const fromKey = fi.from[0];
        const toKey = fi.to?.[0] ?? 'id';
        const ids = [...new Set(rows.map((r) => r[fromKey]).filter((v) => v != null))];
        let byId = new Map<any, any>();
        if (ids.length) {
          const q: any = { where: { [toKey]: { in: ids } } };
          if (fx.value && typeof fx.value === 'object') {
            if (fx.value.select) q.select = { ...fx.value.select, [toKey]: true };
            if (fx.value.include) q.include = fx.value.include;
          }
          const found: any[] = await (this.platform as any)[accessorOf(fi.type)].findMany(q);
          byId = new Map(found.map((x) => [x[toKey], x]));
        }
        for (const r of rows) r[fx.key] = r[fromKey] != null ? byId.get(r[fromKey]) ?? null : null;
      } else if (fi?.kind === 'object' && fx.model === 'Organization' && fi.isList && this.tenantModels.has(fi.type)) {
        // organization.<tenant list> → read from that org's schema
        for (const r of rows) {
          const q: any = { where: { organizationId: r.id } };
          if (fx.value && typeof fx.value === 'object') Object.assign(q, fx.value, { where: { ...(fx.value.where || {}), organizationId: r.id } });
          r[fx.key] = await this.exec(fi.type, 'findMany', q);
        }
      } else {
        for (const r of rows) r[fx.key] = fi?.isList ? [] : null;
      }
    }
    return result;
  }

  // ── execution ──────────────────────────────────────────────────────────
  async exec(model: string, method: string, argsIn: any): Promise<any> {
    if (this.platformModels.has(model) && !this.tenantModels.has(model)) {
      const { args, fixups, possible } = this.prepare(model, method, argsIn, this.platformModels);
      if (!possible && READS.has(method)) return emptyResult(method, args, model);
      return this.applyFixups(await this.platform[accessorOf(model)][method](args), fixups);
    }
    if (this.legacyModels.has(model)) {
      return this.legacy[accessorOf(model)][method](argsIn);
    }

    // tenant model
    const stated = this.orgFromArgs(argsIn);
    const ctxOrg = currentOrgId();
    let targets: OrgEntry[];
    let fromArgs = false;
    if (typeof stated === 'string') {
      const o = await this.schemaFor(stated);
      targets = o ? [o] : [];
      fromArgs = true;
    } else if (Array.isArray(stated)) {
      const list = await Promise.all(stated.map((id) => this.schemaFor(id)));
      targets = [...new Map(list.filter(Boolean).map((o) => [o!.schema, o!])).values()];
      fromArgs = true;
    } else if (ctxOrg) {
      const o = await this.schemaFor(ctxOrg);
      targets = o ? [o] : [];
    } else {
      await this.loadRegistry();
      targets = this.allOrgs();
    }

    if (!targets.length) {
      if (READS.has(method)) return emptyResult(method, argsIn, model);
      throw new TenancyError(`${model}.${method}: org ${String(stated ?? ctxOrg)} has no org schema`);
    }

    const withModel = targets.filter((t) => t.models.has(model));
    const single = targets.length === 1 && (typeof stated === 'string' || (!stated && !!ctxOrg));

    if (single) {
      const t = targets[0];
      if (!t.models.has(model)) {
        if (READS.has(method)) return emptyResult(method, argsIn, model);
        throw new TenancyError(`${model}.${method}: module not enabled in ${t.schema}`);
      }
      const r = await this.runOn(t, model, method, argsIn);
      // cross-org fallback: an id lookup that misses in the context org (admin viewing another org's record)
      if (!fromArgs && (method === 'findUnique' || method === 'findUniqueOrThrow') && r == null) {
        return this.fanOut(model, method, argsIn, this.allOrgs().filter((o) => o !== t && o.models.has(model)));
      }
      return r;
    }
    return this.fanOut(model, method, argsIn, withModel);
  }

  private async runOn(t: OrgEntry, model: string, method: string, argsIn: any) {
    const { args, fixups, possible } = this.prepare(model, method, argsIn, t.models);
    if (!possible) {
      if (READS.has(method) || WRITES_MANY.has(method)) return emptyResult(method, args, model);
      if (method === 'update' || method === 'delete') throw notFound(model, method);
    }
    const res = await t.client[accessorOf(model)][method](args);
    return this.applyFixups(res, fixups);
  }

  private async fanOut(model: string, method: string, argsIn: any, targets: OrgEntry[]): Promise<any> {
    const store = currentTenantStore();
    if (!targets.length) {
      if (READS.has(method)) return emptyResult(method, argsIn, model);
      throw new TenancyError(`${model}.${method}: no org schema has this model`);
    }
    if (CREATES.has(method)) {
      throw new TenancyError(`${model}.${method}: cannot tell which org to write to (no organizationId and no request org)`);
    }
    if (method === 'findFirst' || method === 'findUnique' || method === 'findFirstOrThrow' || method === 'findUniqueOrThrow') {
      const soft = method.replace('OrThrow', '');
      for (const t of targets) {
        const r = await this.runOn(t, model, soft, argsIn);
        if (r != null) {
          if (store && !store.orgId) store.orgId = await this.orgIdOfSchema(t.schema);
          return r;
        }
      }
      if (method.endsWith('OrThrow')) throw notFound(model, method);
      return null;
    }
    if (method === 'findMany' || method === 'groupBy') {
      const skip = argsIn?.skip ?? 0;
      const take = argsIn?.take;
      const per = { ...(argsIn || {}) };
      delete per.skip;
      if (take !== undefined && take >= 0) per.take = skip + take;
      const parts = await Promise.all(targets.map((t) => this.runOn(t, model, method, per)));
      let rows = parts.flat();
      const ob = argsIn?.orderBy;
      const obs = (Array.isArray(ob) ? ob : ob ? [ob] : []).filter((o: any) => o && typeof o === 'object' && Object.keys(o).length === 1 && typeof Object.values(o)[0] === 'string');
      if (obs.length) {
        rows = rows.sort((a: any, b: any) => {
          for (const o of obs) {
            const [k, dir] = Object.entries(o)[0] as [string, string];
            const av = a[k], bv = b[k];
            if (av === bv) continue;
            const cmp = av == null ? 1 : bv == null ? -1 : av > bv ? 1 : -1;
            return dir === 'desc' ? -cmp : cmp;
          }
          return 0;
        });
      }
      return rows.slice(skip, take !== undefined && take >= 0 ? skip + take : undefined);
    }
    if (method === 'count') {
      const parts = await Promise.all(targets.map((t) => this.runOn(t, model, method, argsIn)));
      if (parts.every((p) => typeof p === 'number')) return parts.reduce((a, b) => a + b, 0);
      const out: any = {};
      for (const p of parts) for (const [k, v] of Object.entries(p || {})) out[k] = (out[k] || 0) + (v as number);
      return out;
    }
    if (method === 'aggregate') {
      const parts = await Promise.all(targets.map((t) => this.runOn(t, model, method, argsIn)));
      const out: any = {};
      for (const p of parts) {
        for (const [agg, val] of Object.entries(p || {})) {
          if (typeof val === 'number') { out[agg] = (out[agg] || 0) + val; continue; }
          out[agg] = out[agg] || {};
          for (const [f, v] of Object.entries(val || {})) {
            const cur = out[agg][f];
            const n = v == null ? null : Number(v);
            if (agg === '_sum' || agg === '_count') out[agg][f] = n == null ? cur ?? (agg === '_count' ? 0 : null) : (cur || 0) + n;
            else if (agg === '_min') out[agg][f] = cur == null ? v : n == null ? cur : Math.min(cur, n);
            else if (agg === '_max') out[agg][f] = cur == null ? v : n == null ? cur : Math.max(cur, n);
            else out[agg][f] = cur ?? v; // _avg: approximate (first org with data)
          }
        }
      }
      return out;
    }
    if (WRITES_MANY.has(method)) {
      const parts = await Promise.all(targets.map((t) => this.runOn(t, model, method, argsIn)));
      return { count: parts.reduce((a, p: any) => a + (p?.count || 0), 0) };
    }
    if (WRITES_UNIQUE.has(method)) {
      for (const t of targets) {
        const hit = await this.runOn(t, model, 'findUnique', { where: argsIn.where });
        if (hit) {
          if (store && !store.orgId) store.orgId = await this.orgIdOfSchema(t.schema);
          return this.runOn(t, model, method, argsIn);
        }
      }
      if (method === 'upsert') {
        const org = this.orgFromArgs({ data: argsIn.create });
        if (typeof org === 'string') {
          const t = await this.schemaFor(org);
          if (t) return this.runOn(t, model, method, argsIn);
        }
        throw new TenancyError(`${model}.upsert: cannot tell which org to create in`);
      }
      throw notFound(model, method);
    }
    throw new TenancyError(`${model}.${method}: unsupported without an org`);
  }

  private async orgIdOfSchema(schema: string) {
    await this.loadRegistry();
    for (const [org, s] of this.registry) if (s === schema) return org;
    return null;
  }

  // ── raw SQL: runs with search_path = the org schema (then platform, public) ─
  private async rawOn(kind: string, a: any[]) {
    const org = currentOrgId();
    const t = org ? await this.schemaFor(org) : null;
    const client = t ? t.client : this.platform;
    const sp = t ? `"${t.schema}", platform, public` : 'platform, public';
    const res = await client.$transaction([client.$executeRawUnsafe(`SET LOCAL search_path TO ${sp}`), client[kind](...a)]);
    return res[1];
  }

  // ── transactions ────────────────────────────────────────────────────────
  private async transaction(arg: any, opts?: any) {
    if (Array.isArray(arg)) {
      const ops = arg;
      if (ops.every((o) => o instanceof LazyOp)) {
        // batch atomically when every op lands in one org schema
        const orgs = new Set<string>();
        let ok = true;
        for (const o of ops as LazyOp[]) {
          const st = this.orgFromArgs(o.args);
          const id = typeof st === 'string' ? st : Array.isArray(st) ? null : currentOrgId();
          if (!id || !this.tenantModels.has(o.model) || this.platformModels.has(o.model)) { ok = false; break; }
          orgs.add(id);
        }
        if (ok && orgs.size === 1) {
          const t = await this.schemaFor([...orgs][0]);
          if (t && (ops as LazyOp[]).every((o) => t.models.has(o.model))) {
            const prepared = (ops as LazyOp[]).map((o) => ({ o, ...this.prepare(o.model, o.method, o.args, t.models) }));
            if (prepared.every((p) => p.possible)) {
              const res = await t.client.$transaction(prepared.map((p) => t.client[accessorOf(p.o.model)][p.o.method](p.args)), opts);
              return Promise.all(res.map((r: any, i: number) => this.applyFixups(r, prepared[i].fixups)));
            }
          }
        }
      }
      this.warnOnce('tx-array', '$transaction([...]) spans orgs/platform — ran sequentially, not atomically');
      const out: any[] = [];
      for (const o of ops) out.push(await o);
      return out;
    }
    // interactive: open a real transaction on the first org the callback touches
    const fn = arg;
    type Open = { schema: string; tx: any; release: (e?: any) => void; finished: Promise<any> };
    let open: Open | null = null;
    let opening: Promise<Open> | null = null;
    const router = this;
    const start = (t: OrgEntry): Promise<Open> => {
      if (opening) return opening;
      opening = new Promise<Open>((resolveOpen, rejectOpen) => {
        let release!: (e?: any) => void;
        const released = new Promise<void>((res, rej) => (release = (e?: any) => (e ? rej(e) : res())));
        const finished: Promise<any> = t.client.$transaction(
          async (tx: any) => {
            await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${t.schema}", platform, public`);
            open = { schema: t.schema, tx, release, finished };
            resolveOpen(open);
            await released; // a rejection here rolls the transaction back
          },
          { timeout: 60_000, maxWait: 10_000, ...(opts || {}) },
        );
        finished.catch((e: any) => rejectOpen(e));
      });
      return opening;
    };
    const orgForOp = async (model: string, args: any): Promise<OrgEntry | null> => {
      if (!router.tenantModels.has(model) || router.platformModels.has(model)) return null;
      const st = router.orgFromArgs(args);
      const id = typeof st === 'string' ? st : currentOrgId();
      return id ? router.schemaFor(id) : null;
    };
    const view = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === '$queryRaw' || prop === '$queryRawUnsafe' || prop === '$executeRaw' || prop === '$executeRawUnsafe') {
          return async (...a: any[]) => {
            let o = open as Open | null;
            if (!o) {
              const id = currentOrgId();
              const t = id ? await router.schemaFor(id) : null;
              if (t) o = await start(t);
            }
            return o ? o.tx[prop](...a) : router.rawOn(prop, a);
          };
        }
        const model = router.accessors.get(prop);
        if (!model) return (router.legacy as any)[prop];
        return Object.fromEntries(
          OPS.map((op) => [
            op,
            async (args: any) => {
              const t = await orgForOp(model, args);
              if (t && t.models.has(model)) {
                const o = (open as Open | null) ?? (await start(t));
                if (o.schema === t.schema) {
                  const { args: a2, fixups, possible } = router.prepare(model, op, args, t.models);
                  if (!possible && (READS.has(op) || WRITES_MANY.has(op))) return emptyResult(op, a2, model);
                  return router.applyFixups(await o.tx[accessorOf(model)][op](a2), fixups);
                }
                router.warnOnce('tx-multi', 'interactive $transaction touched two orgs — second org ran outside the transaction');
              }
              return router.exec(model, op, args);
            },
          ]),
        );
      },
    });
    try {
      const result = await fn(view);
      const o = open as Open | null;
      if (o) {
        o.release();
        await o.finished;
      }
      return result;
    } catch (e) {
      const o = open as Open | null;
      if (o) {
        o.release(e);
        await o.finished.catch(() => undefined);
      }
      throw e;
    }
  }

  // ── the object services see as `this.prisma` ────────────────────────────
  proxy(): any {
    const router = this;
    const delegates = new Map<string, any>();
    return new Proxy(this.legacy, {
      get(target, prop: string | symbol, receiver) {
        if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);
        if (prop === '$transaction') return (a: any, o?: any) => router.transaction(a, o);
        if (prop === '$queryRaw' || prop === '$queryRawUnsafe' || prop === '$executeRaw' || prop === '$executeRawUnsafe') {
          return (...a: any[]) => router.rawOn(prop, a);
        }
        if (prop === '$connect') return async () => { await Promise.all([router.platform.$connect(), ...[...router.orgs.values()].map((o) => o.client.$connect())]); await router.loadRegistry(true); };
        if (prop === '$disconnect') return async () => { await Promise.all([router.platform.$disconnect(), ...[...router.orgs.values()].map((o) => o.client.$disconnect()), target.$disconnect()]); };
        if (prop === '__tenancy') return router;
        const model = router.accessors.get(prop);
        if (model) {
          let d = delegates.get(model);
          if (!d) {
            d = Object.fromEntries(OPS.map((op) => [op, (args?: any) => new LazyOp(router, model, op, args)]));
            delegates.set(model, d);
          }
          return d;
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }
}

function structuredCloneSafe(v: any): any {
  // Prisma args can hold Dates, Decimals, Buffers — clone plain objects/arrays only.
  if (Array.isArray(v)) return v.map(structuredCloneSafe);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const o: any = {};
    for (const k of Object.keys(v)) o[k] = structuredCloneSafe(v[k]);
    return o;
  }
  return v;
}
