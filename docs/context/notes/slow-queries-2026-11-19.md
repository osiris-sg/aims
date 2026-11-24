# Prod slow queries (pg_stat_statements since 2026-10-27, read 2026-11-19)

Total exec time 19503 s over 2915838 calls.

| # | total s | calls | mean ms | max ms | query (start) |
|---|---|---|---|---|---|
| 1 | 15580 | 1676 | 9296.5 | 84048 | SELECT d.id FROM "Document" d WHERE d."organizationId" = $1 AND ( d.config #>> $13 ILIKE $2 ESCAPE $14 OR d.config ->> $15 ILIKE $3 ESCAPE $ |
| 2 | 494 | 10 | 49461.2 | 234193 | SELECT d.id FROM "Document" d WHERE d."organizationId" = $1 AND ( d.config #>> $3 ILIKE $2 OR d.config ->> $4 ILIKE $2 OR d.config ->> $5 IL |
| 3 | 461 | 13263 | 34.8 | 517 | SELECT "public"."EmailIngestLog"."id", "public"."EmailIngestLog"."organizationId", "public"."EmailIngestLog"."messageId", "public"."EmailIng |
| 4 | 318 | 214 | 1488.4 | 4040 | WITH d AS ( SELECT CASE WHEN config->>$5 ~ $3 THEN (config->>$6)::numeric WHEN config->>$7 ~ $3 THEN (config->>$8)::numeric WHEN config->>$9 |
| 5 | 244 | 214 | 1142.8 | 3275 | SELECT LEFT(config->>$5, $6) AS d, COUNT(*)::int AS n FROM "Document" WHERE "organizationId" = $1 AND type IN ($7,$8,$9) AND COALESCE(config |
| 6 | 184 | 1480 | 124.4 | 1722 | SELECT DISTINCT btrim(item->>$2) AS description FROM ( SELECT d.config FROM "Document" d WHERE d."organizationId" = $1 AND jsonb_typeof(d.co |
| 7 | 160 | 514 | 311.8 | 2224 | SELECT "public"."Document"."id", "public"."Document"."name", "public"."Document"."type", "public"."Document"."documentTemplateId", "public". |
| 8 | 142 | 57 | 2496.0 | 3337 | INSERT INTO "JournalEntry" ("id","organizationId","journalNumber","entryDate","type","status","isUnconfirmed","reference","description","tot |
| 9 | 142 | 15 | 9469.8 | 42481 | select d.id::text id, d."organizationId" "organizationId", d.type, d.name, d.status::text status, d."createdAt", (d.config - $2 - $3) config |
| 10 | 137 | 217 | 634.5 | 1747 | SELECT COUNT(*) AS "_count._all" FROM (SELECT "public"."Document"."id" FROM "public"."Document" WHERE ("public"."Document"."organizationId"  |
