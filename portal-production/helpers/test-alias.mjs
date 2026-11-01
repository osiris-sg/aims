// Round AZ — `npm test` (node --test) resolves the portal's "@/…" alias and extension-less relative imports of .ts
// files, so a tested lib may import another lib (e.g. shipments/_lib/format.ts → i18n/lang.ts) like the app does.
import { register } from "node:module";

register("./test-alias-hooks.mjs", import.meta.url);
