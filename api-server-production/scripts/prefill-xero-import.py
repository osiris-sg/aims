#!/usr/bin/env python3
"""
Pre-fill Xero invoice import data with AI-matched assets, projects, and customers.
Reads the raw xero-import-report.json and produces a pre-filled version with
high/medium/low confidence matches for each line item.
"""

import json
import re
import os
from collections import defaultdict, Counter

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPORT_PATH = os.path.join(SCRIPT_DIR, 'xero-import-report.json')
OUTPUT_PATH = os.path.join(SCRIPT_DIR, 'xero-import-prefilled.json')

# ============================================================
# EXISTING ASSETS IN DB (name | skuKey)
# ============================================================
EXISTING_ASSETS = {
    'AF100': {'name': 'AF-100', 'sku': 'AF100', 'category': 'Equipment'},
    'AF30': {'name': 'AF-30', 'sku': 'AF30', 'category': 'Equipment'},
    'AF40': {'name': 'AF-40', 'sku': 'AF40', 'category': 'Equipment'},
    'AF60': {'name': 'AF-60', 'sku': 'AF60', 'category': 'Equipment'},
    'AF5': {'name': 'AF5', 'sku': 'AF5', 'category': 'Equipment'},
    'AF80': {'name': 'AF80', 'sku': 'AF80', 'category': 'Equipment'},
    'MBR-10': {'name': 'Membrane 10-Capacity', 'sku': 'MBR-10', 'category': 'Equipment'},
    'MBR10': {'name': 'Membrane 10-Capacity', 'sku': 'MBR10', 'category': 'Equipment'},
    'MBR-15': {'name': 'Membrane 15-Capacity', 'sku': 'MBR-15', 'category': 'Equipment'},
    'MBR-20': {'name': 'Membrane 20-Capacity', 'sku': 'MBR-20', 'category': 'Equipment'},
    'MBR30': {'name': 'Membrane 30-Capacity', 'sku': 'MBR30', 'category': 'Equipment'},
    'MBR-30': {'name': 'Membrane 30-Capacity', 'sku': 'MBR-30', 'category': 'Equipment'},
    'MBR40': {'name': 'Membrane 40-Capacity', 'sku': 'MBR40', 'category': 'Equipment'},
    'MBR-4050': {'name': 'Membrane 40/50-Capacity', 'sku': 'MBR-4050', 'category': 'Equipment'},
    'MBR-60': {'name': 'Membrane 60-Capacity', 'sku': 'MBR-60', 'category': 'Equipment'},
    'AIS': {'name': 'Automated Intervention System', 'sku': 'AIS', 'category': 'Equipment'},
    'SIDS': {'name': 'Silt Imagery Detection System', 'sku': 'SIDS', 'category': 'Equipment'},
    'TSS': {'name': 'TSS Sensor', 'sku': 'TSS', 'category': 'Equipment'},
    'LION-125': {'name': 'LION-125', 'sku': 'LION125', 'category': 'Equipment'},
    'LION-135': {'name': 'LION-135', 'sku': 'LION135', 'category': 'Equipment'},
    'LION-250': {'name': 'LION-250', 'sku': 'LION250', 'category': 'Equipment'},
    'LION-375': {'name': 'LION-375', 'sku': 'LION375', 'category': 'Equipment'},
    'LION-500': {'name': 'LION-500', 'sku': 'LION500', 'category': 'Equipment'},
}

# Submersible pump variants
for sku in ['KBZ23.7','KBZ21.5','KBZ22.2','KBZ31.5','KBZ32.2','KBZ33.7','KBZ35.5',
            'KBZ43.7','KBZ45.5','KBZ47.5','KBZ411','KBZ67.5','KBZ611','KBZ415','KBZ615']:
    EXISTING_ASSETS[sku] = {'name': f'Submersible Dewatering Pump', 'sku': sku, 'category': 'Pump'}

# ============================================================
# NEW ASSETS TO CREATE (suggested from analysis)
# ============================================================
NEW_ASSETS = {
    'APF-10': {'name': 'APF-10', 'sku': 'APF10', 'category': 'Equipment'},
    'APF-30': {'name': 'APF-30', 'sku': 'APF30', 'category': 'Equipment'},
    'APF-40': {'name': 'APF-40', 'sku': 'APF40', 'category': 'Equipment'},
    'APF-80': {'name': 'APF-80', 'sku': 'APF80', 'category': 'Equipment'},
    'APF-90': {'name': 'APF-90', 'sku': 'APF90', 'category': 'Equipment'},
    'APF-100': {'name': 'APF-100', 'sku': 'APF100', 'category': 'Equipment'},
    'MBR-50': {'name': 'Membrane 50-Capacity', 'sku': 'MBR-50', 'category': 'Equipment'},
    'MBR-120': {'name': 'Membrane 120-Capacity', 'sku': 'MBR-120', 'category': 'Equipment'},
    'MBR-150': {'name': 'Membrane 150-Capacity', 'sku': 'MBR-150', 'category': 'Equipment'},
    'ECM-PLANT': {'name': 'ECM Plant', 'sku': 'ECMPLANT', 'category': 'Equipment'},
    'GENERATOR-125KVA': {'name': 'Generator 125KVA', 'sku': 'GEN125', 'category': 'Generator'},
    'MICRO-GRID': {'name': 'Micro-Grid System', 'sku': 'MICROGRID', 'category': 'Power System'},
    'SOLAR-PANEL': {'name': 'Solar Panel', 'sku': 'SOLARPANEL', 'category': 'Accessory'},
    'HOLDING-TANK': {'name': 'FRP Holding Tank', 'sku': 'HOLDINGTANK', 'category': 'Equipment'},
    'TIPPER-LORRY': {'name': 'Tipper Lorry', 'sku': 'TIPPERLORRY', 'category': 'Vehicle'},
    'EXCAVATOR': {'name': 'Excavator', 'sku': 'EXCAVATOR', 'category': 'Vehicle'},
    'SCISSORS-LIFT': {'name': 'Battery Scissors Lift', 'sku': 'SCISSORSLIFT', 'category': 'Equipment'},
    'ROAD-ROLLER': {'name': 'Vibratory Road Roller', 'sku': 'ROADROLLER', 'category': 'Equipment'},
    'DENYO-GENERATOR': {'name': 'Denyo Soundproof Generator', 'sku': 'DENYOGEN', 'category': 'Generator'},
}

# Service items (untracked)
SERVICE_ASSETS = {
    'SVC-DISPOSAL': {'name': 'Disposal Service', 'sku': 'SVC-DISPOSAL', 'category': 'Service', 'is_tracked': False},
    'SVC-TRANSPORT': {'name': 'Transport Service', 'sku': 'SVC-TRANSPORT', 'category': 'Service', 'is_tracked': False},
    'SVC-INSTALLATION': {'name': 'Installation Service', 'sku': 'SVC-INSTALL', 'category': 'Service', 'is_tracked': False},
    'SVC-DESILTING': {'name': 'Desilting Service', 'sku': 'SVC-DESILT', 'category': 'Service', 'is_tracked': False},
    'SVC-MAINTENANCE': {'name': 'Maintenance Service', 'sku': 'SVC-MAINT', 'category': 'Service', 'is_tracked': False},
    'SVC-PIPING': {'name': 'Piping Works', 'sku': 'SVC-PIPING', 'category': 'Service', 'is_tracked': False},
    'SVC-MANPOWER': {'name': 'Manpower / Labour', 'sku': 'SVC-MANPOWER', 'category': 'Service', 'is_tracked': False},
    'SVC-SUPPLY': {'name': 'Supply of Materials', 'sku': 'SVC-SUPPLY', 'category': 'Service', 'is_tracked': False},
    'SVC-LEW': {'name': 'LEW Check', 'sku': 'SVC-LEW', 'category': 'Service', 'is_tracked': False},
    'SVC-COMMISSION': {'name': 'Commission', 'sku': 'SVC-COMMISSION', 'category': 'Service', 'is_tracked': False},
    'SVC-RENTAL-OTHER': {'name': 'Equipment Rental (Other)', 'sku': 'SVC-RENTAL', 'category': 'Service', 'is_tracked': False},
    'SVC-SALES-OTHER': {'name': 'General Sales', 'sku': 'SVC-SALES', 'category': 'Service', 'is_tracked': False},
    'SVC-CREDIT-NOTE': {'name': 'Credit Note Adjustment', 'sku': 'SVC-CN', 'category': 'Service', 'is_tracked': False},
    'SVC-BF': {'name': 'Balance Brought Forward', 'sku': 'SVC-BF', 'category': 'Service', 'is_tracked': False},
    'SVC-REIMBURSEMENT': {'name': 'Reimbursement', 'sku': 'SVC-REIMB', 'category': 'Service', 'is_tracked': False},
    'SVC-CABLE': {'name': 'Cable / Electrical', 'sku': 'SVC-CABLE', 'category': 'Service', 'is_tracked': False},
}

ALL_ASSETS = {**EXISTING_ASSETS, **NEW_ASSETS, **SERVICE_ASSETS}

# ============================================================
# REFERENCE LINE PATTERNS (not product lines)
# ============================================================
REFERENCE_PATTERNS = [
    r'^our qtn',
    r'^our quotation',
    r'^our ref',
    r'^our do',
    r'^your (wo|po|ref|fi|sub-contract|service order|works order|work order|contract)',
    r'^project location',
    r'^project/location',
    r'^project site',
    r'^site location',
    r'^contract ref',
    r'^work order',
    r'^agreement number',
    r'^please refer',
    r'^attached with',
    r'^delivered to',
    r'^revised tax invoice',
    r'^as per business',
    r'^less:',
    r'^overtime \d',
    r'^location:',
    r'^remarks\s*:',
    r'^attn\s*:',
    r'^service order',
    r'^\d+[a-d]?\)\.\s*(installation|to provide|labour)',
    r'^\d+[a-d]?\)\.\s*\d+ meters? of',
    r'^adjustment of gst',
    r'^desilting date',
    r'^desilting services by',  # This references the subcon, not a product
    r'^site:',
    r'^for the period',
    r'^dated the',
    r'^pending for po',
    r'^rounding diff',
    r'^\d+[a-d]?\)\.\s*less:',
    r'^\d+[a-d]?\)\.\s*web access',
    r'^\d+[a-d]?\)\.\s*jetty service',
    r'^six \(\d+\) monthly subscription',
    r'^as per their invoice',
    r'^\d+\)\.\s*rental period from',
]

REFERENCE_REGEXES = [re.compile(p, re.IGNORECASE) for p in REFERENCE_PATTERNS]


def is_reference_line(desc: str) -> bool:
    """Check if a description line is a reference/metadata line, not a product."""
    first_line = desc.split('\n')[0].strip()
    dl = first_line.lower()

    for regex in REFERENCE_REGEXES:
        if regex.search(dl):
            return True

    return False


def match_asset(desc: str) -> dict:
    """
    Try to match a line item description to an asset.
    Returns: {asset_key, asset_info, confidence, match_reason}
    """
    first_line = desc.split('\n')[0].strip()
    dl = first_line.lower()
    full_dl = desc.lower()

    # ---- MBR matching ----
    # IMPORTANT: Check "MBR 01 at Location" FIRST — these are unit numbers, not model sizes
    mbr_unit = re.search(r'mbr\s*0*(\d{1,2})\s+at\s+(.+?)(?:\n|$)', dl)
    if mbr_unit:
        unit_num = mbr_unit.group(1)
        location = mbr_unit.group(2).strip()
        return {'asset_key': 'MBR-UNIT', 'asset_info': {'name': f'MBR System (unit #{unit_num})', 'sku': '', 'category': 'Equipment'},
                'confidence': 'low', 'match_reason': f'MBR unit #{unit_num} at {location} - model unknown, need to check invoice context',
                'exists': False, 'needs_sku': True, 'extracted_location': location}

    # "MBR-120" "MBR 120" "MBR-120/150" "mbr-10 system" "mbr 10-capacity"
    # Only match model sizes (typically 10, 15, 20, 30, 40, 50, 60, 120, 150)
    mbr_match = re.search(r'mbr[\s-]*(\d+)(?:/(\d+))?(?:\s*-?\s*(?:capacity|system|m3))?', dl)
    if mbr_match:
        size = mbr_match.group(1)
        size_int = int(size)

        # Skip if this looks like a unit number (small number not matching known sizes)
        known_sizes = {10, 15, 20, 30, 40, 50, 60, 80, 100, 120, 150}
        if size_int in known_sizes or size_int > 9:
            key = f'MBR-{size}'

            # Check existing
            if key in EXISTING_ASSETS:
                return {'asset_key': key, 'asset_info': EXISTING_ASSETS[key], 'confidence': 'high',
                        'match_reason': f'MBR size {size} matched', 'exists': True}
            if f'MBR{size}' in EXISTING_ASSETS:
                return {'asset_key': f'MBR{size}', 'asset_info': EXISTING_ASSETS[f'MBR{size}'], 'confidence': 'high',
                        'match_reason': f'MBR size {size} matched', 'exists': True}
            # Check new
            if key in NEW_ASSETS:
                return {'asset_key': key, 'asset_info': NEW_ASSETS[key], 'confidence': 'high',
                        'match_reason': f'MBR size {size} - new asset needed', 'exists': False}
            # Unknown MBR size
            return {'asset_key': key, 'asset_info': {'name': f'Membrane {size}-Capacity', 'sku': f'MBR-{size}', 'category': 'Equipment'},
                    'confidence': 'medium', 'match_reason': f'MBR size {size} - unknown size', 'exists': False}
        else:
            # Small number like MBR 1, MBR 2 — likely unit number without "at"
            return {'asset_key': 'MBR-UNIT', 'asset_info': {'name': f'MBR System (unit #{size})', 'sku': '', 'category': 'Equipment'},
                    'confidence': 'low', 'match_reason': f'MBR unit #{size} - model unknown',
                    'exists': False, 'needs_sku': True}

    # "Rental of membrane bio-reactor" without specific size
    if 'membrane bio-reactor' in dl or 'membrane bioreactor' in dl or ('membran' in dl and 'bio' in dl):
        return {'asset_key': 'MBR-GENERIC', 'asset_info': {'name': 'MBR System (unspecified)', 'sku': '', 'category': 'Equipment'},
                'confidence': 'low', 'match_reason': 'Generic MBR reference - size unknown',
                'exists': False, 'needs_sku': True}

    # PVDF membrane
    if 'pvdf' in dl and 'membrane' in dl:
        return {'asset_key': 'MBR-GENERIC', 'asset_info': {'name': 'MBR System (PVDF)', 'sku': '', 'category': 'Equipment'},
                'confidence': 'low', 'match_reason': 'PVDF membrane reference',
                'exists': False, 'needs_sku': True}

    # ---- APF matching ----
    apf_match = re.search(r'apf[\s-]*(\d+)', dl)
    if apf_match:
        size = apf_match.group(1)
        # "APF system 90m3/hr" → APF-90
        key = f'APF-{size}'
        if key in NEW_ASSETS:
            return {'asset_key': key, 'asset_info': NEW_ASSETS[key], 'confidence': 'high',
                    'match_reason': f'APF size {size} matched', 'exists': False}
        return {'asset_key': key, 'asset_info': {'name': f'APF-{size}', 'sku': f'APF{size}', 'category': 'Equipment'},
                'confidence': 'medium', 'match_reason': f'APF size {size} - unknown size', 'exists': False}

    # "APF System 30m3/hr" without APF-30 pattern
    apf_flow = re.search(r'apf\s+system\s+(\d+)\s*m3', dl)
    if apf_flow:
        size = apf_flow.group(1)
        key = f'APF-{size}'
        if key in NEW_ASSETS:
            return {'asset_key': key, 'asset_info': NEW_ASSETS[key], 'confidence': 'high',
                    'match_reason': f'APF flow rate {size}m3/hr matched', 'exists': False}

    # ---- AF matching ----
    af_match = re.search(r'\baf[\s-]*(\d+)\b', dl)
    if af_match:
        size = af_match.group(1)
        key = f'AF{size}'
        if key in EXISTING_ASSETS:
            return {'asset_key': key, 'asset_info': EXISTING_ASSETS[key], 'confidence': 'high',
                    'match_reason': f'AF size {size} matched', 'exists': True}
        return {'asset_key': f'AF-{size}', 'asset_info': {'name': f'AF-{size}', 'sku': f'AF{size}', 'category': 'Equipment'},
                'confidence': 'medium', 'match_reason': f'AF size {size} - may be new', 'exists': False}

    # ---- LION matching ----
    lion_match = re.search(r'lion[\s-]*(\d+)', dl)
    if lion_match:
        size = lion_match.group(1)
        key = f'LION-{size}'
        if key in EXISTING_ASSETS:
            return {'asset_key': key, 'asset_info': EXISTING_ASSETS[key], 'confidence': 'high',
                    'match_reason': f'LION-{size} matched', 'exists': True}

    # ---- SIDS matching ----
    if 'sids' in dl or 'silt imagery' in dl:
        return {'asset_key': 'SIDS', 'asset_info': EXISTING_ASSETS['SIDS'], 'confidence': 'high',
                'match_reason': 'SIDS matched', 'exists': True}

    # ---- TSS matching ----
    if 'tss' in dl and ('sensor' in dl or 'monitoring' in dl or 'cctv' in dl):
        return {'asset_key': 'TSS', 'asset_info': EXISTING_ASSETS['TSS'], 'confidence': 'high',
                'match_reason': 'TSS sensor matched', 'exists': True}

    # ---- AIS matching ----
    if 'automated intervention' in dl or (' ais ' in dl and 'system' in dl):
        return {'asset_key': 'AIS', 'asset_info': EXISTING_ASSETS['AIS'], 'confidence': 'high',
                'match_reason': 'AIS matched', 'exists': True}

    # ---- ECM Plant ----
    if 'ecm' in dl and ('plant' in dl or 'system' in dl or 'rental' in dl):
        return {'asset_key': 'ECM-PLANT', 'asset_info': NEW_ASSETS['ECM-PLANT'], 'confidence': 'high',
                'match_reason': 'ECM Plant matched', 'exists': False}

    # ---- Generator ----
    if 'generator' in dl or 'genset' in dl or '125kva' in dl or 'kva' in dl:
        if 'denyo' in dl or 'soundproof' in dl:
            return {'asset_key': 'DENYO-GENERATOR', 'asset_info': NEW_ASSETS['DENYO-GENERATOR'], 'confidence': 'high',
                    'match_reason': 'Denyo generator matched', 'exists': False}
        return {'asset_key': 'GENERATOR-125KVA', 'asset_info': NEW_ASSETS['GENERATOR-125KVA'], 'confidence': 'high',
                'match_reason': 'Generator matched', 'exists': False}

    # ---- Micro-Grid ----
    if 'micro-grid' in dl or 'micro grid' in dl or 'microgrid' in dl:
        return {'asset_key': 'MICRO-GRID', 'asset_info': NEW_ASSETS['MICRO-GRID'], 'confidence': 'high',
                'match_reason': 'Micro-Grid matched', 'exists': False}

    # ---- Solar Panel ----
    if 'solar panel' in dl or 'solar system' in dl:
        return {'asset_key': 'SOLAR-PANEL', 'asset_info': NEW_ASSETS['SOLAR-PANEL'], 'confidence': 'high',
                'match_reason': 'Solar Panel matched', 'exists': False}

    # ---- Submersible Pump ----
    if 'submersible' in dl and ('pump' in dl or 'water pump' in dl):
        # Try to match specific KBZ model
        kbz_match = re.search(r'kbz\s*(\d+[\.\d]*)', dl)
        if kbz_match:
            model = kbz_match.group(1)
            sku = f'KBZ{model}'
            if sku in EXISTING_ASSETS:
                return {'asset_key': sku, 'asset_info': EXISTING_ASSETS[sku], 'confidence': 'high',
                        'match_reason': f'KBZ pump {model} matched', 'exists': True}
        return {'asset_key': 'SUBMERSIBLE-PUMP', 'asset_info': {'name': 'Submersible Pump', 'sku': '', 'category': 'Pump'},
                'confidence': 'medium', 'match_reason': 'Submersible pump - model unknown', 'exists': False, 'needs_sku': True}

    # ---- Holding Tank ----
    if 'holding tank' in dl:
        return {'asset_key': 'HOLDING-TANK', 'asset_info': NEW_ASSETS['HOLDING-TANK'], 'confidence': 'high',
                'match_reason': 'Holding tank matched', 'exists': False}

    # ---- Tipper Lorry ----
    if 'tipper lorry' in dl or 'tiper lorry' in dl:
        return {'asset_key': 'TIPPER-LORRY', 'asset_info': NEW_ASSETS['TIPPER-LORRY'], 'confidence': 'high',
                'match_reason': 'Tipper lorry matched', 'exists': False}

    # ---- Excavator ----
    if 'excavator' in dl:
        return {'asset_key': 'EXCAVATOR', 'asset_info': NEW_ASSETS['EXCAVATOR'], 'confidence': 'high',
                'match_reason': 'Excavator matched', 'exists': False}

    # ---- Scissors Lift ----
    if 'scissors lift' in dl or 'scissor lift' in dl:
        return {'asset_key': 'SCISSORS-LIFT', 'asset_info': NEW_ASSETS['SCISSORS-LIFT'], 'confidence': 'high',
                'match_reason': 'Scissors lift matched', 'exists': False}

    # ---- Road Roller ----
    if 'road roller' in dl or 'vibratory roller' in dl:
        return {'asset_key': 'ROAD-ROLLER', 'asset_info': NEW_ASSETS['ROAD-ROLLER'], 'confidence': 'high',
                'match_reason': 'Road roller matched', 'exists': False}

    # ---- SERVICE MATCHING ----

    # Balance brought forward
    if dl in ('b/f', 'b/f from roger', 'balance b/f') or 'b/f' == dl.strip() or 'unknown customer b/f' in dl:
        return {'asset_key': 'SVC-BF', 'asset_info': SERVICE_ASSETS['SVC-BF'], 'confidence': 'high',
                'match_reason': 'Balance brought forward', 'exists': False}

    # Credit note
    if 'credit note' in dl:
        return {'asset_key': 'SVC-CREDIT-NOTE', 'asset_info': SERVICE_ASSETS['SVC-CREDIT-NOTE'], 'confidence': 'high',
                'match_reason': 'Credit note reference', 'exists': False}

    # Disposal
    if 'disposal' in dl:
        return {'asset_key': 'SVC-DISPOSAL', 'asset_info': SERVICE_ASSETS['SVC-DISPOSAL'], 'confidence': 'high',
                'match_reason': 'Disposal service', 'exists': False}

    # Desilting
    if 'desilting' in dl:
        return {'asset_key': 'SVC-DESILTING', 'asset_info': SERVICE_ASSETS['SVC-DESILTING'], 'confidence': 'high',
                'match_reason': 'Desilting service', 'exists': False}

    # Transport / delivery
    if any(w in dl for w in ['transport', 'delivery', 'lorry crane', 'trucking']):
        return {'asset_key': 'SVC-TRANSPORT', 'asset_info': SERVICE_ASSETS['SVC-TRANSPORT'], 'confidence': 'high',
                'match_reason': 'Transport/delivery service', 'exists': False}

    # Installation
    if 'install' in dl and ('charge' in dl or 'one-time' in dl or 'service' in dl):
        return {'asset_key': 'SVC-INSTALLATION', 'asset_info': SERVICE_ASSETS['SVC-INSTALLATION'], 'confidence': 'high',
                'match_reason': 'Installation service', 'exists': False}

    # LEW check
    if 'lew' in dl:
        return {'asset_key': 'SVC-LEW', 'asset_info': SERVICE_ASSETS['SVC-LEW'], 'confidence': 'high',
                'match_reason': 'LEW check service', 'exists': False}

    # Manpower / Labour
    if any(w in dl for w in ['manpower', 'labour', 'labor', 'labour charge']):
        return {'asset_key': 'SVC-MANPOWER', 'asset_info': SERVICE_ASSETS['SVC-MANPOWER'], 'confidence': 'high',
                'match_reason': 'Manpower/labour', 'exists': False}

    # Piping
    if 'piping' in dl or ('pipe' in dl and ('pvc' in dl or 'discharge' in dl)):
        return {'asset_key': 'SVC-PIPING', 'asset_info': SERVICE_ASSETS['SVC-PIPING'], 'confidence': 'high',
                'match_reason': 'Piping works', 'exists': False}

    # Supply of materials
    if dl.startswith('supply of') or dl.startswith('supply and'):
        return {'asset_key': 'SVC-SUPPLY', 'asset_info': SERVICE_ASSETS['SVC-SUPPLY'], 'confidence': 'high',
                'match_reason': 'Supply of materials', 'exists': False}

    # Commission
    if 'commission' in dl:
        return {'asset_key': 'SVC-COMMISSION', 'asset_info': SERVICE_ASSETS['SVC-COMMISSION'], 'confidence': 'high',
                'match_reason': 'Commission', 'exists': False}

    # Reimbursement
    if 'reimbursement' in dl:
        return {'asset_key': 'SVC-REIMBURSEMENT', 'asset_info': SERVICE_ASSETS['SVC-REIMBURSEMENT'], 'confidence': 'high',
                'match_reason': 'Reimbursement', 'exists': False}

    # Cable / electrical
    if any(w in dl for w in ['cable', 'electrical control panel', 'rewiring', 'cu/x/swa', 'cu/p']):
        return {'asset_key': 'SVC-CABLE', 'asset_info': SERVICE_ASSETS['SVC-CABLE'], 'confidence': 'high',
                'match_reason': 'Cable/electrical work', 'exists': False}

    # Generic sales
    if dl.startswith('sales of'):
        return {'asset_key': 'SVC-SALES-OTHER', 'asset_info': SERVICE_ASSETS['SVC-SALES-OTHER'], 'confidence': 'medium',
                'match_reason': 'Generic sales item', 'exists': False, 'needs_sku': True}

    # Generic rental
    if dl.startswith('rental of'):
        return {'asset_key': 'SVC-RENTAL-OTHER', 'asset_info': SERVICE_ASSETS['SVC-RENTAL-OTHER'], 'confidence': 'medium',
                'match_reason': 'Generic rental - equipment unknown', 'exists': False, 'needs_sku': True}

    # No match
    return None


def extract_location(desc: str) -> str | None:
    """Extract project location from description."""
    patterns = [
        r'(?:location|project location|site location|project/location)\s*:\s*(.+?)(?:\n|$)',
        r'(?:at|@)\s+([A-Z][A-Za-z0-9\s,]+(?:Road|Ave|Drive|Link|Lane|Park|Street|Crescent|Walk|Station|Camp|Mall|Hospital))',
    ]
    for pattern in patterns:
        match = re.search(pattern, desc, re.IGNORECASE)
        if match:
            loc = match.group(1).strip()
            if len(loc) > 3:
                return loc

    # "MBR 01 at Site Office" → extract "Site Office" as context, not project
    mbr_at = re.search(r'mbr\s*\d+\s+at\s+(.+?)(?:\n|$)', desc, re.IGNORECASE)
    if mbr_at:
        return mbr_at.group(1).strip()

    return None


def extract_serial_number(desc: str) -> str | None:
    """Extract serial/inventory number from description."""
    # S/No. 2021051069, S/NO. 2021051067, S/No: MG20250079
    m = re.search(r'[Ss]/[Nn][Oo]+\.?\s*[:.]?\s*([A-Za-z0-9]+)', desc)
    if m and len(m.group(1)) > 3:
        return m.group(1)

    # Serial No. / Serial Number
    m = re.search(r'[Ss]erial\s*[Nn]o\.?\s*[:.]?\s*([A-Za-z0-9]+)', desc)
    if m and len(m.group(1)) > 3:
        return m.group(1)

    # MG pattern (Micro-Grid serials)
    m = re.search(r'\b(MG\d{5,})\b', desc)
    if m:
        return m.group(1)

    # S/N pattern
    m = re.search(r'[Ss]/[Nn]\s*[:.]?\s*([A-Za-z0-9]+)', desc)
    if m and len(m.group(1)) > 4:
        return m.group(1)

    return None


def extract_invoice_metadata(line_items: list) -> dict:
    """Extract project, site office, DO date, contact info from reference lines."""
    meta = {
        'project_name': None,
        'site_office_name': None,
        'site_office_address': None,
        'do_number': None,
        'do_date': None,  # Use as start date
        'contact_name': None,
        'contact_phone': None,
    }

    for item in line_items:
        desc = item.get('description', '')
        for line in desc.split('\n'):
            line = line.strip()
            ll = line.lower()

            # Project: Canberra Crescent Residences
            m = re.match(r'^project\s*:\s*(.+)', line, re.IGNORECASE)
            if m and not meta['project_name']:
                meta['project_name'] = m.group(1).strip()

            # Location: 51 Canberra Cres, Singapore 752106
            m = re.match(r'^(?:location|site location|project location|project/location)\s*:\s*(.+)', line, re.IGNORECASE)
            if m:
                addr = m.group(1).strip()
                if addr and not meta['site_office_address']:
                    meta['site_office_address'] = addr
                    # Use the location as site office name if no project name
                    if not meta['site_office_name']:
                        # Short name from address: take first part before comma
                        meta['site_office_name'] = addr.split(',')[0].strip()

            # Our DO No. DO/BT202508-001 dated 16/08/2025
            m = re.search(r'(?:our\s+)?DO\s+No\.?\s*[:.]?\s*(\S+)\s+dated\s+(\d{1,2}/\d{1,2}/\d{4})', line, re.IGNORECASE)
            if m and not meta['do_date']:
                meta['do_number'] = m.group(1)
                date_str = m.group(2)
                try:
                    from datetime import datetime as dt
                    meta['do_date'] = dt.strptime(date_str, '%d/%m/%Y').strftime('%Y-%m-%d')
                except ValueError:
                    pass

            # Attn: Mr Feng Tianru
            m = re.match(r'^attn\s*:\s*(.+)', line, re.IGNORECASE)
            if m and not meta['contact_name']:
                meta['contact_name'] = m.group(1).strip()

            # Mobile: 9649 6903
            m = re.match(r'^(?:mobile|tel|phone|hp)\s*:\s*(.+)', line, re.IGNORECASE)
            if m and not meta['contact_phone']:
                meta['contact_phone'] = m.group(1).strip()

    return meta


def main():
    print("Loading report...")
    with open(REPORT_PATH) as f:
        data = json.load(f)

    invoices = data['invoices']
    print(f"Processing {len(invoices)} invoices...")

    # Stats
    stats = {
        'total_invoices': len(invoices),
        'total_line_items': 0,
        'reference_lines': 0,
        'matched_high': 0,
        'matched_medium': 0,
        'matched_low': 0,
        'unmatched': 0,
        'existing_assets_used': Counter(),
        'new_assets_needed': Counter(),
        'locations_found': Counter(),
    }

    prefilled_invoices = []

    for inv in invoices:
        prefilled_items = []
        invoice_location = None

        for item in inv['line_items']:
            stats['total_line_items'] += 1
            desc = item['description']

            # Check if reference line (improved detection)
            if item.get('is_reference_line') or is_reference_line(desc):
                # Still extract location from reference lines
                loc = extract_location(desc)
                if loc:
                    invoice_location = loc
                    stats['locations_found'][loc] += 1

                prefilled_items.append({
                    **item,
                    'is_reference_line': True,
                    'asset_match': None,
                    'confidence': None,
                    'location': loc,
                })
                stats['reference_lines'] += 1
                continue

            # Extract location
            loc = extract_location(desc)
            if loc:
                invoice_location = loc
                stats['locations_found'][loc] += 1

            # Try to match asset
            match = match_asset(desc)

            if match:
                confidence = match['confidence']
                if confidence == 'high':
                    stats['matched_high'] += 1
                elif confidence == 'medium':
                    stats['matched_medium'] += 1
                else:
                    stats['matched_low'] += 1

                if match.get('exists'):
                    stats['existing_assets_used'][match['asset_key']] += 1
                else:
                    stats['new_assets_needed'][match['asset_key']] += 1

                serial = extract_serial_number(desc)

                prefilled_items.append({
                    **item,
                    'is_reference_line': False,
                    'asset_match': {
                        'key': match['asset_key'],
                        'name': match['asset_info']['name'],
                        'sku': match['asset_info'].get('sku', ''),
                        'category': match['asset_info'].get('category', ''),
                        'exists_in_db': match.get('exists', False),
                        'needs_sku': match.get('needs_sku', False),
                    },
                    'confidence': confidence,
                    'match_reason': match['match_reason'],
                    'location': loc,
                    'serial_number': serial,
                })
            else:
                serial = extract_serial_number(desc)
                stats['unmatched'] += 1
                prefilled_items.append({
                    **item,
                    'is_reference_line': False,
                    'asset_match': None,
                    'confidence': None,
                    'match_reason': 'No match found',
                    'location': loc,
                    'needs_sku': True,
                    'serial_number': serial,
                })

        # Extract metadata from reference lines (project, site office, DO date, contacts)
        metadata = extract_invoice_metadata(inv['line_items'])

        # Use metadata to fill in project location if not already found
        if not invoice_location and metadata['site_office_address']:
            invoice_location = metadata['site_office_address']
        if not invoice_location and metadata['project_name']:
            invoice_location = metadata['project_name']

        prefilled_invoices.append({
            **{k: v for k, v in inv.items() if k != 'line_items'},
            'line_items': prefilled_items,
            'project_location': invoice_location,
            'project_name': metadata['project_name'],
            'site_office_name': metadata['site_office_name'],
            'site_office_address': metadata['site_office_address'],
            'do_number': metadata['do_number'],
            'do_date': metadata['do_date'],
            'contact_name': metadata['contact_name'],
            'contact_phone': metadata['contact_phone'],
            'review_status': 'pending',
        })

    # Build output
    output = {
        'summary': {
            'total_invoices': stats['total_invoices'],
            'total_line_items': stats['total_line_items'],
            'reference_lines': stats['reference_lines'],
            'product_lines': stats['total_line_items'] - stats['reference_lines'],
            'matched_high_confidence': stats['matched_high'],
            'matched_medium_confidence': stats['matched_medium'],
            'matched_low_confidence': stats['matched_low'],
            'unmatched': stats['unmatched'],
            'match_rate': f"{(stats['matched_high'] + stats['matched_medium'] + stats['matched_low']) / max(1, stats['total_line_items'] - stats['reference_lines']) * 100:.1f}%",
            'auto_confirmable': f"{stats['matched_high'] / max(1, stats['total_line_items'] - stats['reference_lines']) * 100:.1f}%",
        },
        'existing_assets_used': [
            {'sku': k, 'name': ALL_ASSETS.get(k, {}).get('name', k), 'count': v}
            for k, v in stats['existing_assets_used'].most_common()
        ],
        'new_assets_needed': [
            {'key': k, 'name': ALL_ASSETS.get(k, {}).get('name', k),
             'sku': ALL_ASSETS.get(k, {}).get('sku', ''), 'count': v,
             'category': ALL_ASSETS.get(k, {}).get('category', '')}
            for k, v in stats['new_assets_needed'].most_common()
        ],
        'locations_found': [
            {'location': k, 'count': v}
            for k, v in stats['locations_found'].most_common()
        ],
        'invoices': prefilled_invoices,
    }

    print(f"\nWriting pre-filled data to {OUTPUT_PATH}...")
    with open(OUTPUT_PATH, 'w') as f:
        json.dump(output, f, indent=2, default=str)

    print("\n=== PRE-FILL SUMMARY ===")
    print(f"Total line items: {stats['total_line_items']}")
    print(f"Reference lines (skipped): {stats['reference_lines']}")
    print(f"Product lines: {stats['total_line_items'] - stats['reference_lines']}")
    print(f"  High confidence: {stats['matched_high']}")
    print(f"  Medium confidence: {stats['matched_medium']}")
    print(f"  Low confidence: {stats['matched_low']}")
    print(f"  Unmatched: {stats['unmatched']}")
    print(f"Match rate: {output['summary']['match_rate']}")
    print(f"Auto-confirmable: {output['summary']['auto_confirmable']}")

    print(f"\nExisting assets used: {len(stats['existing_assets_used'])}")
    for k, v in stats['existing_assets_used'].most_common(10):
        print(f"  {k}: {v}")

    print(f"\nNew assets needed: {len(stats['new_assets_needed'])}")
    for k, v in stats['new_assets_needed'].most_common():
        name = ALL_ASSETS.get(k, {}).get('name', k)
        print(f"  {name}: {v}")

    print(f"\nDone! Output: {OUTPUT_PATH}")


if __name__ == '__main__':
    main()
