/**
 * Import Cappitech Daikin VRV 2026 price list (R410A, SGD, GST-excl) into Asset.
 *
 * Source: 19 phone photos of the Daikin VRV binder (no Excel). Transcribed via
 * OCR — OUTDOOR combination tables are MEDIUM confidence (dense + watermarked);
 * FCU + accessory tables are HIGH confidence. Per user: "trust the pictures, we
 * can change once it's inside." Values are easy to correct in Prisma Studio later.
 *
 * Model: FLAT (MKM-style, no parent/child). All outdoor -> "Condensing Unit",
 * all indoor -> "Fan Coil Unit", ventilation/kits -> "Accessories".
 * FCUs: ONE SKU each at the WIRED (BRC1E63) list price; the wireless-remote
 * bundle price is stored as customPrices [{label:"Wireless Price"}] for reference.
 * capacityKw stored (outdoor from the sheet; indoor derived from the model class).
 * The multi-module COMBINATION string is folded into the description.
 *
 * Run from api-server-production/ (loads .env = DEV db ep-steep-truth):
 *   node scripts/import-cappitech-vrv.js
 * (Bash sandbox blocks Neon; run with dangerouslyDisableSandbox.)
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ORG_ID = '59802f75-262b-4f96-b8b2-09a9a071d882'; // Cappitech Engineering Pte. Ltd.

// ---- Indoor (FCU) nominal cooling capacity by model class number (kW) ----
const FCU_KW = {
  20: 2.2, 25: 2.8, 32: 3.6, 40: 4.5, 50: 5.6, 63: 7.1, 71: 8.0, 80: 9.0,
  100: 11.2, 125: 14.0, 140: 16.0, 200: 22.4, 250: 28.0,
  335: 33.5, 350: 35.5, 400: 45.0, 500: 56.0,
};
const fcuCapacity = (sku) => {
  const m = String(sku).match(/(\d+)/);
  return m ? (FCU_KW[Number(m[1])] ?? null) : null;
};

// ===================== OUTDOOR / CONDENSING UNITS =====================
// item = [sku, capacityKw, tick, combination|null, listPrice]
const OUTDOOR = [
  { series: 'VRV IV S', desc: 'Daikin VRV IV S Series Condensing Unit (R410A)', items: [
    ['RXMUQ4AVEG', 11.2, '5', null, 6825],
    ['RXMUQ5AVEG', 14.0, '5', null, 7823],
    ['RXMUQ6AVEG', 16.0, '5', null, 8978],
  ]},
  { series: 'VRV S', desc: 'Daikin VRV S Series Condensing Unit (R410A)', items: [
    ['RSUQ7AYM', 20.0, '2', null, 8560],
    ['RSUQ8AYM', 22.4, '1', null, 9011],
    ['RSUQ9AYM', 24.0, '1', null, 9450],
  ]},
  { series: 'VRV IV', desc: 'Daikin VRV IV Series Condensing Unit (R410A)', items: [
    // single modules (16kW corrected to RQQ06TYMG per Daikin numbering)
    ['RQQ06TYMG', 16.0, '2', null, 11984],
    ['RQQ08TYMG', 22.4, '2', null, 11701],
    ['RQQ10TYMG', 28.0, '1', null, 12844],
    ['RQQ12TYMG', 33.5, '1', null, 14380],
    ['RQQ14TYMG', 40.0, '1', null, 21087],
    ['RQQ16TYMG', 45.0, '1', null, 23009],
    ['RQQ18TYMG', 50.0, '1', null, 24570],
    ['RQQ20TYMG', 56.0, '1', null, 26233],
    // combinations (module + module [+ module] + piping kit)
    ['RQQ18TNYM', 50.4, '1 and above', 'RQQ08TYMG + RQQ10TYMG + BHFP22P100-7', 24645],
    ['RQQ20TNYM', 55.9, '1 and above', 'RQQ08TYMG + RQQ12TYMG + BHFP22P100-7', 26381],
    ['RQQ22TYMG', 61.5, '1', 'RQQ10TYMG + RQQ12TYMG + BHFP22P100-7', 27524],
    ['RQQ24TYMG', 67.0, '1', 'RQQ12TYMG + RQQ12TYMG + BHFP22P100-7', 29060],
    ['RQQ26TNYM', 73.5, '1', 'RQQ12TYMG + RQQ14TYMG + BHFP22P100-7', 35767],
    ['RQQ28TNYM', 78.5, '1', 'RQQ12TYMG + RQQ16TYMG + BHFP22P100-7', 37689],
    ['RQQ30TSYM', 83.5, '1', 'RQQ14TYMG + RQQ16TYMG + BHFP22P100-7', 39250],
    ['RQQ32TSYM', 89.5, '1', 'RQQ16TYMG + RQQ16TYMG + BHFP22P100-7', 44396],
    ['RQQ32TNYM', 90.0, '1', 'RQQ12TYMG + RQQ20TYMG + BHFP22P100-7', 40913],
    ['RQQ34TSYM', 95.0, '1', 'RQQ16TYMG + RQQ18TYMG + BHFP22P100-7', 45957], // was "RQQ34SYM" (faint)
    ['RQQ34TNYM', 95.0, '1', 'RQQ16TYMG + RQQ18TYMG + BHFP22P100-7', 47879],
    ['RQQ34TYMG', 95.0, '1', 'RQQ10TYMG + RQQ12TYMG + RQQ12TYMG + BHFP22P151-7', 42202], // 3rd 95kW variant — VERIFY code
    ['RQQ36TSYM', 100.0, '1', 'RQQ18TYMG + RQQ18TYMG + BHFP22P100-7', 49440],
    ['RQQ36TNYM', 101.0, '1', 'RQQ12TYMG + RQQ12TYMG + RQQ12TYMG + BHFP22P151-7', 43738],
    ['RQQ38TSYM', 106.0, '1', 'RQQ18TYMG + RQQ20TYMG + BHFP22P100-7', 51103],
    ['RQQ38TNYM', 106.0, '1 and above', 'RQQ08TYMG + RQQ12TYMG + RQQ18TYMG + BHFP22P151-7', 51249],
    ['RQQ40TSYM', 112.0, '1', 'RQQ20TYMG + RQQ20TYMG + BHFP22P100-7', 52766],
    ['RQQ40TNYM', 112.0, '1', 'RQQ12TYMG + RQQ12TYMG + RQQ16TYMG + BHFP22P151-7', 52367],
    ['RQQ42TSYM', 117.0, '1', 'RQQ12TYMG + RQQ12TYMG + RQQ18TYMG + BHFP22P151-7', 53928],
    ['RQQ42TNYM', 119.0, '1', 'RQQ12TYMG + RQQ14TYMG + RQQ16TYMG + BHFP22P151-7', 59074],
    ['RQQ44TSYM', 123.0, '1', 'RQQ12TYMG + RQQ12TYMG + RQQ20TYMG + BHFP22P151-7', 55591],
    ['RQQ44TNYM', 124.0, '1', 'RQQ12TYMG + RQQ16TYMG + RQQ16TYMG + BHFP22P151-7', 60996],
    ['RQQ46TSYM', 129.0, '1', 'RQQ12TYMG + RQQ16TYMG + RQQ18TYMG + BHFP22P151-7', 62557],
    ['RQQ46TNYM', 130.0, '1', 'RQQ14TYMG + RQQ14TYMG + RQQ18TYMG + BHFP22P151-7', 67342],
    ['RQQ48TSYM', 134.0, '1', 'RQQ12TYMG + RQQ18TYMG + RQQ18TYMG + BHFP22P151-7', 64118],
    ['RQQ48TNYM', 135.0, '1', 'RQQ14TYMG + RQQ16TYMG + RQQ18TYMG + BHFP22P151-7', 69264],
  ]},
  { series: 'VRV 6A', desc: 'Daikin VRV 6A Series Condensing Unit (R410A)', items: [
    // single modules
    ['RXQ08BYMG', 22.4, '3', null, 9011],
    ['RXQ10BYMG', 28.0, '3', null, 9591],
    ['RXQ12BYMG', 33.5, '3', null, 11297],
    ['RXQ14BYMG', 40.0, '3', null, 16248],
    ['RXQ16BYMG', 45.0, '2', null, 17719],
    ['RXQ18BYMG', 50.0, '2', null, 18900],
    ['RXQ20BYMG', 56.0, '2', null, 20178],
    ['RXQ22BYMG', 61.5, '1', null, 20764],
    ['RXQ24BYMG', 67.0, '1', null, 21467],
    // combinations
    ['RXQ24BMYM-SG', 67.0, '3', 'RXQ12BYMG + RXQ12BYMG + BHFP22R135-7', 22894],
    ['RXQ26BMYM', 73.0, '1', 'RXQ12BYMG + RXQ14BYMG + BHFP22R135-7', 24792],
    ['RXQ28BMYM', 78.5, '2 and above', 'RXQ12BYMG + RXQ16BYMG + BHFP22R135-7', 29316],
    ['RXQ30BMYM', 83.5, '2 and above', 'RXQ12BYMG + RXQ18BYMG + BHFP22R135-7', 30497],
    ['RXQ32BMYM', 89.5, '2', 'RXQ14BYMG + RXQ18BYMG + BHFP22R135-7', 31775],
    ['RXQ32BMYM-SG', 90.0, '2', 'RXQ16BYMG + RXQ16BYMG + BHFP22R135-7', 35738],
    ['RXQ34BMYM', 95.0, '2', 'RXQ16BYMG + RXQ18BYMG + BHFP22R135-7', 36919],
    ['RXQ36BMYM', 100.0, '2', 'RXQ18BYMG + RXQ18BYMG + BHFP22R135-7', 38100],
    ['RXQ36BMYM-SG', 101.0, '2', 'RXQ16BYMG + RXQ20BYMG + BHFP22R135-7', 38197],
    ['RXQ38BMYM', 106.0, '2', 'RXQ18BYMG + RXQ20BYMG + BHFP22R135-7', 39378],
    ['RXQ38BMYM-SG', 108.0, '1 and above', 'RXQ12BYMG + RXQ20BYMG + BHFP22R168-7', 38783],
    ['RXQ40BMYM', 112.0, '2', 'RXQ20BYMG + RXQ20BYMG + BHFP22R135-7', 40656],
    ['RXQ40BMYM-SG', 112.0, '2 and above', 'RXQ12BYMG + RXQ12BYMG + RXQ16BYMG + BHFP22R168-7', 40911],
    ['RXQ42BMYM', 117.0, '1', 'RXQ18BYMG + RXQ24BYMG + BHFP22R135-7', 40667],
    ['RXQ42BMYM-SG', 117.0, '1', 'RXQ20BYMG + RXQ22BYMG + BHFP22R135-7', 41242],
    ['RXQ44BMYM', 123.0, '1', 'RXQ18BYMG + RXQ26BYMG + BHFP22R135-7', 43992],
    ['RXQ44BMYM-SG', 123.0, '2 and above', 'RXQ12BYMG + RXQ12BYMG + RXQ20BYMG + BHFP22R168-7', 47333],
    ['RXQ44BMYM-SG1', 123.0, '2', 'RXQ12BYMG + RXQ12BYMG + RXQ20BYMG + BHFP22R168-7', 43370],
    ['RXQ46BMYM', 129.0, '2', 'RXQ20BYMG + RXQ26BYMG + BHFP22R135-7', 45270],
    ['RXQ46BMYM-SG', 128.0, '2 and above', 'RXQ12BYMG + RXQ16BYMG + RXQ16BYMG + BHFP22R168-7', 48514],
    ['RXQ48BMYM', 134.0, '1', 'RXQ22BYMG + RXQ26BYMG + BHFP22R135-7', 45856],
    ['RXQ48BMYM-SG', 133.0, '2 and above', 'RXQ12BYMG + RXQ16BYMG + RXQ16BYMG + BHFP22R168-7', 49695],
    ['RXQ48BMYM-SG1', 135.0, '2 and above', 'RXQ12BYMG + RXQ16BYMG + RXQ18BYMG + BHFP22R168-7', 53755],
    ['RXQ50BMYM', 140.0, '1', 'RXQ24BYMG + RXQ26BYMG + BHFP22R135-7', 48559],
    ['RXQ50BMYM-SG', 140.0, '2', 'RXQ16BYMG + RXQ16BYMG + RXQ18BYMG + BHFP22R168-7', 54936],
    ['RXQ50BMYM-SG1', 139.0, '1', 'RXQ12BYMG + RXQ18BYMG + RXQ20BYMG + BHFP22R168-7', 50973],
    ['RXQ52BMYM', 146.0, '1', 'RXQ26BYMG + RXQ26BYMG + BHFP22R135-7', 49884],
    ['RXQ52BMYM-SG', 145.0, '2', 'RXQ16BYMG + RXQ16BYMG + RXQ18BYMG + BHFP22R168-7', 56117],
    ['RXQ52BMYM-SG1', 146.0, '2', 'RXQ16BYMG + RXQ18BYMG + RXQ18BYMG + BHFP22R168-7', 56214],
    ['RXQ54BMYM', 150.0, '2', 'RXQ16BYMG + RXQ18BYMG + RXQ20BYMG + BHFP22R168-7', 57298],
    ['RXQ54BMYM-SG', 151.0, '2', 'RXQ16BYMG + RXQ20BYMG + RXQ20BYMG + BHFP22R168-7', 57395],
    ['RXQ56BMYM', 156.0, '2', 'RXQ18BYMG + RXQ18BYMG + RXQ20BYMG + BHFP22R168-7', 58576],
    ['RXQ56BMYM-SG', 157.0, '2', 'RXQ18BYMG + RXQ20BYMG + RXQ20BYMG + BHFP22R168-7', 58673],
    ['RXQ58BMYM', 162.0, '2', 'RXQ18BYMG + RXQ20BYMG + RXQ20BYMG + BHFP22R168-7', 59852],
    ['RXQ58BMYM-SG', 161.0, '1 and above', 'RXQ18BYMG + RXQ20BYMG + RXQ22BYMG + BHFP22R168-7', 59162],
    ['RXQ60BMYM', 168.0, '1', 'RXQ20BYMG + RXQ20BYMG + RXQ22BYMG + BHFP22R168-7', 61132],
    ['RXQ60BMYM-SG', 167.0, '1 and above', 'RXQ20BYMG + RXQ20BYMG + RXQ24BYMG + BHFP22R168-7', 59865],
    ['RXQ62BMYM', 173.0, '1', 'RXQ20BYMG + RXQ22BYMG + RXQ24BYMG + BHFP22R168-7', 61718],
    ['RXQ62BMYM-SG', 173.0, '1 and above', 'RXQ18BYMG + RXQ20BYMG + RXQ26BYMG + BHFP22R168-7', 63190],
    ['RXQ62BMYM-SG1', 173.0, '2', 'RXQ18BYMG + RXQ20BYMG + RXQ26BYMG + BHFP22R168-7', 62421],
    ['RXQ64BMYM-SG', 179.0, '1 and above', 'RXQ18BYMG + RXQ20BYMG + RXQ26BYMG + BHFP22R168-7', 64468],
    // top of range (page 2255)
    ['RXQ66BMYM', 185.0, '1 and above', 'RXQ20BYMG + RXQ20BYMG + RXQ26BYMG + BHFP22R168-7', 65746],
    ['RXQ66BMYM-SG', 184.0, '1 and above', 'RXQ18BYMG + RXQ24BYMG + RXQ24BYMG + BHFP22R168-7', 62432],
    ['RXQ68BMYM', 190.0, '1 and above', 'RXQ20BYMG + RXQ22BYMG + RXQ26BYMG + BHFP22R168-7', 66332],
    ['RXQ68BMYM-SG', 190.0, '1 and above', 'RXQ20BYMG + RXQ24BYMG + RXQ24BYMG + BHFP22R168-7', 63710],
    ['RXQ70BMYM', 196.0, '1 and above', 'RXQ20BYMG + RXQ24BYMG + RXQ26BYMG + BHFP22R168-7', 67035],
    ['RXQ70BMYM-SG', 196.0, '1 and above', 'RXQ18BYMG + RXQ26BYMG + RXQ26BYMG + BHFP22R168-7', 69082],
    ['RXQ72BMYM', 202.0, '1 and above', 'RXQ20BYMG + RXQ26BYMG + RXQ26BYMG + BHFP22R168-7', 70360],
    ['RXQ72BMYM-SG', 201.0, '1', 'RXQ24BYMG + RXQ24BYMG + RXQ24BYMG + BHFP22R168-7', 64999],
    ['RXQ74BMYM', 207.0, '1', 'RXQ22BYMG + RXQ26BYMG + RXQ26BYMG + BHFP22R168-7', 70946],
    ['RXQ74BMYM-SG', 207.0, '1', 'RXQ24BYMG + RXQ24BYMG + RXQ26BYMG + BHFP22R168-7', 68324],
    ['RXQ76BMYM', 213.0, '1', 'RXQ24BYMG + RXQ26BYMG + RXQ26BYMG + BHFP22R168-7', 71649],
    ['RXQ78BMYM', 219.0, '1', 'RXQ26BYMG + RXQ26BYMG + RXQ26BYMG + BHFP22R168-7', 74974],
  ]},
  { series: 'VRV 6X', desc: 'Daikin VRV 6X Series Condensing Unit (R410A)', items: [
    // single modules (50kW & 56kW corrected to RXUQ18/RXUQ20 per Daikin numbering)
    ['RXUQ06BYMG', 16.0, '5', null, 8873],
    ['RXUQ08BYMG', 22.4, '5', null, 10920],
    ['RXUQ10BYMG', 28.0, '5', null, 11981],
    ['RXUQ12BYMG', 33.5, '5', null, 13682],
    ['RXUQ14BYMG', 40.0, '4', null, 19688],
    ['RXUQ16BYMG', 45.0, '4', null, 21462],
    ['RXUQ18BYMG', 50.0, '3', null, 22890],
    ['RXUQ20BYMG', 56.0, '3', null, 24444],
    // free-combination (-SG) + combination variants
    ['RXUQ14BMYM-SG', 38.4, '5', 'RXUQ06BYMG + RXUQ08BYMG + BHFP22P100-7', 19893],
    ['RXUQ16BMYM-SG', 44.8, '5', 'RXUQ08BYMG + RXUQ08BYMG + BHFP22P100-7', 22140],
    ['RXUQ18BMYM-SG', 50.4, '5', 'RXUQ08BYMG + RXUQ10BYMG + BHFP22P100-7', 23201],
    ['RXUQ20BMYM-SG', 56.0, '5', 'RXUQ10BYMG + RXUQ10BYMG + BHFP22P100-7', 24262],
    ['RXUQ22BMYM', 61.5, '5', 'RXUQ10BYMG + RXUQ12BYMG + BHFP22R135-7', 25973],
    ['RXUQ24BMYM', 67.0, '5', 'RXUQ12BYMG + RXUQ12BYMG + BHFP22R135-7', 27684],
    ['RXUQ26BMYM', 73.5, '4 and above', 'RXUQ12BYMG + RXUQ14BYMG + BHFP22R168-7', 33680],
    ['RXUQ26BMYM-SG', 72.0, '5', 'RXUQ08BYMG + RXUQ12BYMG + RXUQ12BYMG + BHFP22P151-7', 33233],
    ['RXUQ28BMYM', 78.5, '4 and above', 'RXUQ14BYMG + RXUQ16BYMG + BHFP22R168-7', 35454],
    ['RXUQ28BMYM-SG', 78.4, '5', 'RXUQ08BYMG + RXUQ12BYMG + RXUQ14BYMG + BHFP22P151-7', 35480],
    ['RXUQ30BMYM', 83.5, '3 and above', 'RXUQ14BYMG + RXUQ16BYMG + BHFP22R168-7', 36882],
    ['RXUQ30BMYM-SG', 84.0, '5', 'RXUQ08BYMG + RXUQ10BYMG + RXUQ10BYMG + BHFP22P151-7', 36541],
    ['RXUQ32BMYM', 89.5, '3 and above', 'RXUQ12BYMG + RXUQ20BYMG + BHFP22R168-7', 38436],
    ['RXUQ32BMYM-SG', 89.5, '3 and above', 'RXUQ10BYMG + RXUQ12BYMG + RXUQ12BYMG + BHFP22P151-7', 38252],
    ['RXUQ34BMYM-SG', 96.0, '3 and above', 'RXUQ10BYMG + RXUQ12BYMG + RXUQ12BYMG + BHFP22P151-7', 44432],
    ['RXUQ36BMYM', 95.0, '5', 'RXUQ16BYMG + RXUQ20BYMG + RXUQ20BYMG + BHFP22R151-7', 39963],
    ['RXUQ36BMYM-SG', 101.0, '3 and above', 'RXUQ12BYMG + RXUQ12BYMG + RXUQ12BYMG + BHFP22P151-7', 46206],
    ['RXUQ38BMYM', 100.0, '5', 'RXUQ18BYMG + RXUQ20BYMG + BHFP22R135-7', 41674],
    ['RXUQ38BMYM-SG', 106.0, '3', 'RXUQ18BYMG + RXUQ20BYMG + BHFP22R135-7', 47634],
    ['RXUQ38BMYM-SG1', 107.0, '4 and above', 'RXUQ12BYMG + RXUQ12BYMG + RXUQ14BYMG + BHFP22P151-7', 47670],
    ['RXUQ40BMYM', 112.0, '3', 'RXUQ20BYMG + RXUQ20BYMG + BHFP22R135-7', 49188],
    ['RXUQ40BMYM-SG', 113.0, '4 and above', 'RXUQ14BYMG + RXUQ14BYMG + RXUQ18BYMG + BHFP22P151-7', 53666],
    ['RXUQ42BMYM', 117.0, '4 and above', 'RXUQ14BYMG + RXUQ14BYMG + RXUQ18BYMG + BHFP22R168-7', 50872],
    ['RXUQ42BMYM-SG', 120.0, '4', 'RXUQ14BYMG + RXUQ14BYMG + RXUQ14BYMG + BHFP22R168-7', 59662],
    ['RXUQ44BMYM', 123.0, '4 and above', 'RXUQ12BYMG + RXUQ14BYMG + RXUQ18BYMG + BHFP22R168-7', 52426],
    ['RXUQ44BMYM-SG', 125.0, '5', 'RXUQ14BYMG + RXUQ14BYMG + RXUQ16BYMG + BHFP22R151-7', 61436],
    ['RXUQ46BMYM', 129.0, '3 and above', 'RXUQ14BYMG + RXUQ16BYMG + RXUQ16BYMG + BHFP22R151-7', 58422],
    ['RXUQ46BMYM-SG', 130.0, '3', 'RXUQ14BYMG + RXUQ16BYMG + RXUQ16BYMG + BHFP22R168-7', 63210],
    ['RXUQ48BMYM', 134.0, '3 and above', 'RXUQ16BYMG + RXUQ16BYMG + RXUQ16BYMG + BHFP22R168-7', 60196],
    ['RXUQ48BMYM-SG', 135.0, '4', 'RXUQ16BYMG + RXUQ16BYMG + RXUQ16BYMG + BHFP22R168-7', 64984],
    ['RXUQ50BMYM', 139.0, '3 and above', 'RXUQ16BYMG + RXUQ16BYMG + RXUQ18BYMG + BHFP22R168-7', 61624],
    ['RXUQ52BMYM', 145.0, '3 and above', 'RXUQ16BYMG + RXUQ18BYMG + RXUQ18BYMG + BHFP22R168-7', 63179],
    ['RXUQ54BMYM', 150.0, '3', 'RXUQ18BYMG + RXUQ18BYMG + RXUQ18BYMG + BHFP22R168-7', 69174],
    ['RXUQ56BMYM', 162.0, '3', 'RXUQ18BYMG + RXUQ20BYMG + RXUQ20BYMG + BHFP22R168-7', 70948],
    ['RXUQ58BMYM', 162.0, '3', 'RXUQ18BYMG + RXUQ20BYMG + RXUQ20BYMG + BHFP22R168-7', 72376],
    ['RXUQ60BMYM', 168.0, '3', 'RXUQ20BYMG + RXUQ20BYMG + RXUQ20BYMG + BHFP22R168-7', 73930],
  ]},
];

// ===================== INDOOR / FAN COIL UNITS =====================
// item = [sku, wiredPrice, wirelessPrice|null]  (capacity derived from class)
const FCU = [
  { type: 'Ceiling Mounted Cassette (Double Flow) Type', items: [
    ['FXCQ20BVM', 1803, 1890], ['FXCQ25BVM', 1840, 1927], ['FXCQ32BVM', 1880, 1967],
    ['FXCQ40BVM', 2098, 2185], ['FXCQ50BVM', 2171, 2258], ['FXCQ63BVM', 2230, 2317],
    ['FXCQ80BVM', 2912, 2999], ['FXCQ125BVM', 3052, 3139],
  ]},
  { type: 'Ceiling Mounted Cassette (Single Flow) Type with Panel', items: [
    ['FXEQ20AV36', 2287, 2308], ['FXEQ25AV36', 2326, 2347], ['FXEQ32AV36', 2371, 2392],
    ['FXEQ40AV36', 2418, 2439], ['FXEQ50AV36', 2581, 2602], ['FXEQ63AV36', 2685, 2706],
  ]},
  { type: 'Slim Ceiling Mounted Duct Type (Standard Series) with Drain Pump', items: [
    ['FXDQ20PDVE', 1391, 1471], ['FXDQ25PDVE', 1414, 1494], ['FXDQ32PDVE', 1449, 1529],
    ['FXDQ40NDVE', 1540, 1620], ['FXDQ50NDVE', 1604, 1684], ['FXDQ63NDVE', 1768, 1848],
  ]},
  { type: 'Slim Ceiling Mounted Duct Type (Compact Series)', items: [
    ['FXDQ20SPV1', 2545, 2625], ['FXDQ25SPV1', 2605, 2685], ['FXDQ32SPV1', 2652, 2732],
    ['FXDQ40SPV1', 2843, 2923], ['FXDQ50SPV1', 2987, 3067], ['FXDQ63SPV1', 3320, 3400],
  ]},
  { type: 'Ceiling Mounted Cassette (Round Flow) Type with White Decoration Panel', items: [
    ['FXFQ25AVM', 1850, 1872], ['FXFQ32AVM', 1888, 1910], ['FXFQ40AVM', 2011, 2033],
    ['FXFQ50AVM', 2067, 2089], ['FXFQ63AVM', 2116, 2138], ['FXFQ80AVM', 2335, 2357],
    ['FXFQ100AVM', 2384, 2406], ['FXFQ125AVM', 2429, 2451], ['FXFQ140AVM', 2717, 2739],
  ]},
  { type: 'Ceiling Mounted Cassette (Round Flow with Sensing) Type with White Decoration Panel', items: [
    ['FXFSQ25AVM', 2086, 2108], ['FXFSQ32AVM', 2127, 2149], ['FXFSQ40AVM', 2270, 2292],
    ['FXFSQ50AVM', 2335, 2357], ['FXFSQ63AVM', 2392, 2414], ['FXFSQ80AVM', 2641, 2663],
    ['FXFSQ100AVM', 2699, 2721], ['FXFSQ125AVM', 2753, 2775], ['FXFSQ140AVM', 2865, 2887],
  ]},
  { type: 'Ceiling Mounted Ducted Type (FXMQ-PAVE)', items: [
    ['FXMQ20PAVE', 1691, 1771], ['FXMQ25PAVE', 1718, 1798], ['FXMQ32PAVE', 1757, 1837],
    ['FXMQ40PAVE', 1848, 1928], ['FXMQ50PAVE', 1886, 1966], ['FXMQ63PAVE', 1992, 2072],
    ['FXMQ80PAVE', 2303, 2383], ['FXMQ100PAVE', 2441, 2521], ['FXMQ125PAVE', 2554, 2634],
    ['FXMQ140PAVE', 3136, 3216],
  ]},
  { type: 'Ceiling Mounted Ducted Type (FXSQ-PAVE)', items: [
    ['FXSQ20PAVE', 1691, 1771], ['FXSQ25PAVE', 1718, 1798], ['FXSQ32PAVE', 1757, 1837],
    ['FXSQ40PAVE', 1848, 1928], ['FXSQ50PAVE', 1886, 1966], ['FXSQ63PAVE', 1992, 2072],
    ['FXSQ80PAVE', 2303, 2383], ['FXSQ100PAVE', 2441, 2521], ['FXSQ125PAVE', 2554, 2634],
    ['FXSQ140PAVE', 3136, 3216],
  ]},
  { type: 'Outdoor Air Processing Unit, Ceiling Ducted Type (FXMQ-BFVM)', items: [
    ['FXMQ80BFVM', 2511, 2591], ['FXMQ140BFVM', 3281, 3361],
    ['FXMQ200BFVM', 4791, 4871], ['FXMQ250BFVM', 5067, 5147],
  ]},
  { type: 'Outdoor Air Processing Unit, Ceiling Ducted Type (FXMQ-MFV1)', items: [
    ['FXMQ125MFV1', 3194, null], ['FXMQ200MFV1', 4660, null], ['FXMQ250MFV1', 4929, null],
  ]},
  { type: 'Outdoor Air Processing Unit, Ceiling Ducted Type (FXMQ-DSPFEC)', items: [
    ['FXMQ335DRMFECG', 10025, null], ['FXMQ350DRMFECG', 10454, null],
    ['FXMQ400DRMFECG', 10681, null], ['FXMQ500DRMFECG', 10844, null],
  ]},
  { type: 'Ceiling Mounted Duct Type, High Static Pressure (FXMQ-MVE9)', items: [
    ['FXMQ200MVE9', 4201, 4315], ['FXMQ250MVE9', 4443, 4557], ['FXMQ335MMECG', 12281, null],
  ]},
  { type: 'Ceiling Mounted Duct Type, High Static Pressure (FXMQ-PVM)', items: [
    ['FXMQ200PVM', 4619, 4699], ['FXMQ250PVM', 4886, 4966],
  ]},
  { type: 'Ceiling Suspended Type', items: [
    ['FXHQ32MAVE', 1702, 1749], ['FXHQ63MAVE', 1897, 1944], ['FXHQ100MAVE', 2123, 2170],
    ['FXHQ125BVM', 2187, 2234], ['FXHQ140BVM', 2455, 2502],
  ]},
  { type: 'Wall Mounted Type', items: [
    ['FXAQ20BVM', 1510, 1538], ['FXAQ25BVM', 1541, 1569], ['FXAQ32BVM', 1579, 1607],
    ['FXAQ40BVM', 1601, 1629], ['FXAQ50BVM', 1625, 1653], ['FXAQ63BVM', 1671, 1699],
    ['FXAQ71BVM', 1751, 1779], ['FXAQ80BVM', 1835, 1863], ['FXAQ100BVM', 2014, 2042],
  ]},
  { type: 'Floor Standing Type', items: [
    ['FXLQ20MAVE', 1881, 1995], ['FXLQ25MAVE', 1967, 2081], ['FXLQ32MAVE', 2096, 2210],
    ['FXLQ40MAVE', 2137, 2251], ['FXLQ50MAVE', 2249, 2363], ['FXLQ63MAVE', 2362, 2476],
  ]},
  { type: 'Compact Multi Flow Cassette Type', items: [
    ['FXZQ20BVM', 1854, 1868], ['FXZQ25BVM', 1909, 1923], ['FXZQ32BVM', 1945, 1959],
    ['FXZQ40BVM', 2069, 2083], ['FXZQ50BVM', 2125, 2139],
  ]},
  { type: 'Duct Connection Floor Standing Type', items: [
    ['FXVQ125NY1', 5233, null], ['FXVQ200NY1', 5902, null], ['FXVQ250NY1', 6857, null],
    ['FXVQ400NY1', 9242, null], ['FXVQ500NY1', 10866, null], ['FXVQ500NY16', 13402, null],
  ]},
  { type: 'Round Flow Cassette with Streamer Function (Wired BRC1H63W, c/w Panel & Refnet)', items: [
    ['FXFRQ25AVM', 2020, null], ['FXFRQ32AVM', 2058, null], ['FXFRQ40AVM', 2181, null],
    ['FXFRQ50AVM', 2237, null], ['FXFRQ63AVM', 2286, null], ['FXFRQ80AVM', 2505, null],
    ['FXFRQ100AVM', 2554, null], ['FXFRQ125AVM', 2599, null], ['FXFRQ140AVM', 2887, null],
  ]},
  { type: 'Round Flow Cassette with Sensing & Streamer (Wired BRC1H63W, White Panel & Refnet)', items: [
    ['FXFTQ25AVM', 2256, null], ['FXFTQ32AVM', 2297, null], ['FXFTQ40AVM', 2440, null],
    ['FXFTQ50AVM', 2505, null], ['FXFTQ63AVM', 2562, null], ['FXFTQ80AVM', 2811, null],
    ['FXFTQ100AVM', 2869, null], ['FXFTQ125AVM', 2923, null], ['FXFTQ140AVM', 3035, null],
  ]},
];

// ===================== ACCESSORIES / VENTILATION / KITS =====================
// item = [sku, listPrice, description]
const ACCESSORIES = [
  { type: 'Streamer Duct Chamber', items: [
    ['BDEZ500A60VE', 1287, 'Streamer Duct Chamber — Airflow 80–600'],
    ['BDEZ500A140VE', 1700, 'Streamer Duct Chamber — Airflow 500–1,400'],
    ['BDEZ500A540VE', 2500, 'Streamer Duct Chamber — Airflow 1,200–5,100'],
  ]},
  { type: 'VRV Heat Reclaim Ventilator (VAM-HVE)', items: [
    ['VAM150HVE', 1841, 'Heat Reclaim Ventilator — 150 CMH'],
    ['VAM250HVE', 1919, 'Heat Reclaim Ventilator — 250 CMH'],
    ['VAM350HVE', 2231, 'Heat Reclaim Ventilator — 350 CMH'],
    ['VAM500HVE', 2365, 'Heat Reclaim Ventilator — 500 CMH'],
    ['VAM650HVE', 2655, 'Heat Reclaim Ventilator — 650 CMH'],
    ['VAM800HVE', 2822, 'Heat Reclaim Ventilator — 800 CMH'],
    ['VAM1000HVE', 3101, 'Heat Reclaim Ventilator — 1000 CMH'],
    ['VAM1500HVE', 6691, 'Heat Reclaim Ventilator — 1500 CMH'],
    ['VAM2000HVE', 7639, 'Heat Reclaim Ventilator — 2000 CMH'],
  ]},
  { type: 'Outdoor Unit Multi-Connection Piping Kit', items: [
    ['BHFP22P100-7', 300, 'Multi-connection piping kit (VRV IV / 6X free-combination)'],
    ['BHFP22P151-7', 598, 'Multi-connection piping kit (VRV IV / 6X free-combination)'],
    ['BHFP22R135-7', 300, 'Multi-connection piping kit (VRV 6A / 6X)'],
    ['BHFP22R168-7', 598, 'Multi-connection piping kit (VRV 6A / 6X)'],
  ]},
];

async function getOrCreateCategory(name) {
  const existing = await prisma.category.findFirst({ where: { name, organizationId: ORG_ID } });
  return existing || prisma.category.create({ data: { name, organizationId: ORG_ID } });
}

async function main() {
  const cuCat = await getOrCreateCategory('Condensing Unit');
  const fcuCat = await getOrCreateCategory('Fan Coil Unit');
  const accCat = await getOrCreateCategory('Accessories');

  const seen = new Set();   // skuKeys already handled this run (collision guard)
  const collisions = [];
  let created = 0, skippedExisting = 0;

  async function createAsset({ sku, name, description, categoryId, price, customPrices, capacityKw }) {
    if (seen.has(sku)) { collisions.push(sku); return; }
    seen.add(sku);
    const dupe = await prisma.asset.findFirst({ where: { skuKey: sku, organizationId: ORG_ID, deletedAt: null } });
    if (dupe) { skippedExisting++; return; }
    await prisma.asset.create({
      data: {
        name: name || sku, skuKey: sku, description, categoryId, organizationId: ORG_ID,
        uom: 'UNIT', isTracked: false, quantity: 0, price,
        ...(capacityKw != null ? { capacityKw } : {}),
        ...(customPrices ? { customPrices } : {}),
      },
    });
    created++;
  }

  // Outdoor
  for (const grp of OUTDOOR) {
    for (const [sku, cap, tick, combo, list] of grp.items) {
      const desc = `${grp.desc}${combo ? ` — Combination: ${combo}` : ''}`;
      await createAsset({ sku, description: desc, categoryId: cuCat.id, price: list, capacityKw: cap });
    }
  }
  // Indoor (one SKU each at wired price; wireless price kept for reference)
  for (const grp of FCU) {
    for (const [sku, wired, wireless] of grp.items) {
      await createAsset({
        sku, description: `Daikin VRV ${grp.type} Fan Coil Unit (Wired BRC1E63 list)`,
        categoryId: fcuCat.id, price: wired, capacityKw: fcuCapacity(sku),
        customPrices: wireless != null ? [{ label: 'Wireless Price', value: wireless }] : undefined,
      });
    }
  }
  // Accessories
  for (const grp of ACCESSORIES) {
    for (const [sku, list, desc] of grp.items) {
      await createAsset({ sku, description: desc, categoryId: accCat.id, price: list, capacityKw: null });
    }
  }

  const total = await prisma.asset.count({ where: { organizationId: ORG_ID, deletedAt: null } });
  console.log(`\nDone. created=${created}, skipped (already existed)=${skippedExisting}.`);
  if (collisions.length) console.log(`In-batch duplicate skuKeys (NOT imported, need a clearer photo / correct code): ${collisions.join(', ')}`);
  console.log(`Cappitech active assets now: ${total}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error('ERROR:', e.message); await prisma.$disconnect(); process.exit(1); });
