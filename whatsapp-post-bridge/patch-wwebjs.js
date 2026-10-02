#!/usr/bin/env node
/**
 * Media-send fix for whatsapp-web.js 1.34.7 (postinstall).
 *
 * Since WhatsApp Web 2.3000.1047xxx (2026-09-17) every media send fails with
 * "Data passed to getter must include an id property (it's how we memoize) but
 * got undefined", while text still sends. processMediaData() returns a
 * MediaData model with its own internal __x_id; sendMessage() spreads it into
 * the outgoing message, which overwrites the message's real id.
 *
 * Upstream fix: wwebjs/whatsapp-web.js PR #201923 (merged to main 2026-09-28,
 * not yet released on npm; 1.34.7 is the latest release). It deletes
 * message.__x_id after the message object is built. This applies exactly that
 * one line to the pinned 1.34.7, and FAILS the install if the version or the
 * code around it is not what was checked, so an upgrade cannot silently skip it.
 * Remove this script once a release includes the fix.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, 'node_modules', 'whatsapp-web.js');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.version !== '1.34.7') {
  console.error(`patch-wwebjs: expected whatsapp-web.js 1.34.7, found ${pkg.version}. Check whether the release includes PR #201923, then update or remove this patch.`);
  process.exit(1);
}
const file = path.join(root, 'src', 'util', 'Injected', 'Utils.js');
const src = fs.readFileSync(file, 'utf8');
const MARK = 'aims-patch: PR #201923';
if (src.includes(MARK)) {
  console.log('patch-wwebjs: already applied');
  process.exit(0);
}
// The media spread exists once, in sendMessage's message object; the object
// ends at the first "...extraOptions, };" after it (editMessage has another
// object ending the same way, which must not be touched).
const media = '            ...(mediaOptions.toJSON ? mediaOptions.toJSON() : {}),\n';
const anchor = '            ...extraOptions,\n        };\n';
const m = src.indexOf(media);
const at = m < 0 ? -1 : src.indexOf(anchor, m);
const fn = src.lastIndexOf('window.WWebJS.sendMessage = async', m);
// The next top-level helper definition bounds sendMessage (calls to other
// window.WWebJS helpers inside its body do not count).
const next = /\n    window\.WWebJS\.\w+ = /g;
next.lastIndex = fn + 10;
const nextMatch = next.exec(src);
const nextFn = nextMatch ? nextMatch.index : src.length;
if (m < 0 || src.indexOf(media, m + 1) >= 0 || at < 0 || fn < 0 || at > nextFn) {
  console.error('patch-wwebjs: the sendMessage code is not the expected 1.34.7 shape; not patching.');
  process.exit(1);
}
const fix =
  '\n        // ' + MARK + ' (media sends): the MediaData model carries its own\n' +
  '        // __x_id, which would replace this message\'s id.\n' +
  '        delete message.__x_id;\n';
fs.writeFileSync(file, src.slice(0, at + anchor.length) + fix + src.slice(at + anchor.length));
console.log('patch-wwebjs: applied (delete message.__x_id in sendMessage)');
