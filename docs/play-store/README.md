# SiteJobs: Google Play store assets

SiteJobs is the Android app for AIMS riders and technicians
(`portal-production/android`, applicationId `so.osiris.aims.field`).

| File | Use |
|---|---|
| `sitejobs-mark.svg` | Master mark, 1024 viewBox. SiteClock's teal pin (#16C8B8) and white face with a navy (#24487C) wrench instead of the clock hands. Edit this, then regenerate. |
| `icon-512.png` | Play Console app icon (512x512, no alpha). |
| `icon-1024.png` | Full-bleed mark on white (source for legacy launcher icons and the splash). |
| `icon-foreground-1024.png` | Adaptive-icon foreground master (mark at 62%, transparent). |
| `feature-graphic-1024x500.png` | Play Console feature graphic. |
| `generate-assets.js` | Node script (needs `sharp`) that renders every launcher density, the round and legacy mipmaps, the splash PNGs, the Play icon and the feature graphic from the SVG into `out/`; copy `out/res` over `android/app/src/main/res`. |

The monochrome launcher layer for Android 13+ themed icons is a vector drawable,
`android/app/src/main/res/drawable/ic_launcher_monochrome.xml`, kept in step with
the SVG by hand (same path data, scaled to 62% of the 108dp canvas).

Still to produce for the listing: phone screenshots (at least two, 9:16),
short description (80 characters), full description.
