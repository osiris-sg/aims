#!/usr/bin/env python3
"""
Re-run AI extraction for invoices that failed (no asset matches).
Updates directly in the DB via the import API.
"""

import json
import os
import sys
import time
import re
import anthropic
import openpyxl

DETAIL_FILE = os.path.expanduser("~/Downloads/Receivable_Invoice_Detail (1).xlsx")

client = anthropic.Anthropic()

SYSTEM_PROMPT = '''You extract structured data from Biofuel Industries invoices. Return ONLY raw JSON (no markdown fences, no ```).

Known assets: AF-40 (AF40), AF-100 (AF100), AF-60 (AF60), AF-30 (AF30), AF5, AF80, MBR-10, MBR-15, MBR-20, MBR-30, MBR-40 (MBR40), MBR-60, MBR-4050, LION-125 (LION125), LION-135 (LION135), LION-250 (LION250), LION-375 (LION375), LION-500 (LION500), Micro-Grid System (MICROGRID), Generator 125KVA (GEN125), Denyo Soundproof Generator (DENYOGEN), SIDS, TSS, AIS, APF-10 (APF10), APF-30 (APF30), APF-40 (APF40), APF-80 (APF80), APF-90 (APF90), APF-100 (APF100), ECM Plant (ECMPLANT), Submersible Pump (KBZ*), Solar Panel (SOLARPANEL), FRP Holding Tank (HOLDINGTANK), Tipper Lorry (TIPPERLORRY), Excavator (EXCAVATOR), Disposal Service (SVC-DISPOSAL), Transport Service (SVC-TRANSPORT), Supply of Materials (SVC-SUPPLY), Desilting Service (SVC-DESILT), Installation Service (SVC-INSTALL), Manpower/Labour (SVC-MANPOWER), Credit Note (SVC-CN), Balance B/F (SVC-BF), Piping Works (SVC-PIPING), Reimbursement (SVC-REIMB), Commission (SVC-COMMISSION)

Rules:
- "MBR 01 at Site Office" with "MBR 10-capacity S/No. 2021051070" means asset_name=Membrane 10-Capacity, sku_key=MBR-10, serial=2021051070
- If qty>1, extract ALL serial numbers from the description
- Qty=0 lines are reference lines
- Extract project, location, site office, DO date (as YYYY-MM-DD), contact from reference lines
- For disposal/transport/supply services use the SVC-* sku_keys

Return: {"product_lines": [{"line_index": N, "asset_name": "", "sku_key": "", "serial_numbers": [], "category": "", "uom": "UNIT"}], "reference_lines": [indices], "project_name": null, "site_office_name": null, "site_office_address": null, "do_date": null, "do_number": null, "contact_name": null, "contact_phone": null}'''


def load_detail():
    wb = openpyxl.load_workbook(DETAIL_FILE, data_only=True)
    ws = wb['Receivable Invoice Detail']
    invoices = {}
    current_invoice = None
    for row in ws.iter_rows(min_row=5, values_only=True):
        date, source, ref, item_code, desc, qty, unit_price, discount, tax, gross, inv_total, status = row
        if date is None and source is None: continue
        col_a = str(date).strip() if date else ''
        if col_a.startswith('Total '): current_invoice = None; continue
        if source is None and desc is None and col_a:
            current_invoice = col_a
            if current_invoice not in invoices: invoices[current_invoice] = []
            continue
        if current_invoice and source:
            invoices[current_invoice].append({
                'reference': str(ref) if ref else '',
                'description': str(desc) if desc else '',
                'quantity': float(qty) if qty else 0,
                'unit_price': float(unit_price) if unit_price else 0,
                'discount': float(discount) if discount else 0,
                'tax': float(tax) if tax else 0,
                'gross': float(gross) if gross else 0,
            })
    wb.close()
    return invoices


def extract_with_ai(inv_number, items, reference):
    user_msg = f"Invoice: {inv_number}\nFull Reference: {reference}\n\nLine items:\n"
    for i, item in enumerate(items):
        user_msg += f"\n[{i}] Qty: {item['quantity']} | Unit: ${item['unit_price']} | Gross: ${item['gross']}\n"
        user_msg += f"    Description: {item['description'][:500]}\n"

    for attempt in range(3):
        try:
            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=2000,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_msg}],
            )
            text = response.content[0].text.strip()
            text = re.sub(r'^```json\s*', '', text)
            text = re.sub(r'\s*```$', '', text)
            text = text.strip()
            if text.startswith('{'):
                return json.loads(text)
            match = re.search(r'\{[\s\S]*\}', text)
            if match:
                return json.loads(match.group())
            print(f"  WARNING: Could not parse for {inv_number}", flush=True)
            return None
        except anthropic.RateLimitError:
            print(f"  Rate limited, waiting 15s...", flush=True)
            time.sleep(15)
        except json.JSONDecodeError as e:
            print(f"  JSON parse error for {inv_number}: {e}", flush=True)
            return None
        except Exception as e:
            if '429' in str(e):
                time.sleep(15)
            else:
                print(f"  ERROR for {inv_number}: {e}", flush=True)
                return None
    return None


def main():
    print("Loading prefilled JSON to find failed invoices...", flush=True)
    with open(os.path.join(os.path.dirname(__file__), 'xero-import-prefilled.json')) as f:
        data = json.load(f)

    # Find invoices where no product lines have asset matches (the failed ones)
    failed_invoices = []
    for inv in data['invoices']:
        product_lines = [li for li in inv['line_items'] if not li.get('is_reference_line')]
        has_match = any(li.get('asset_match') and li['asset_match'].get('sku') for li in product_lines)
        if not has_match and product_lines:
            failed_invoices.append(inv['invoice_number'])

    print(f"Failed invoices to re-process: {len(failed_invoices)}", flush=True)

    # Load raw Excel data
    print("Loading Excel...", flush=True)
    detail = load_detail()

    processed = 0
    errors = 0
    results = {}

    for inv_num in failed_invoices:
        if inv_num not in detail:
            errors += 1
            continue

        items = detail[inv_num]
        reference = items[0]['reference'] if items else ''

        ai_result = extract_with_ai(inv_num, items, reference)
        processed += 1

        if processed % 50 == 0:
            print(f"  Progress: {processed}/{len(failed_invoices)}", flush=True)

        if ai_result:
            # Build updated line items
            product_map = {pl.get('line_index', -1): pl for pl in ai_result.get('product_lines', [])}
            ref_lines = set(ai_result.get('reference_lines', []))

            new_line_items = []
            for i, item in enumerate(items):
                is_ref = i in ref_lines or item['quantity'] == 0

                if i in product_map:
                    pl = product_map[i]
                    new_line_items.append({
                        'description': item['description'],
                        'quantity': item['quantity'],
                        'unit_price': item['unit_price'],
                        'discount': item.get('discount', 0),
                        'tax': item.get('tax', 0),
                        'gross': item['gross'],
                        'is_reference_line': False,
                        'asset_match': {
                            'key': pl.get('sku_key', ''),
                            'name': pl.get('asset_name', ''),
                            'sku': pl.get('sku_key', ''),
                            'category': pl.get('category', ''),
                            'exists_in_db': False,
                            'needs_sku': not pl.get('sku_key'),
                        },
                        'confidence': 'high' if pl.get('sku_key') else 'medium',
                        'match_reason': 'AI extraction',
                        'location': None,
                        'serial_numbers': pl.get('serial_numbers', []),
                    })
                elif is_ref:
                    new_line_items.append({
                        'description': item['description'],
                        'quantity': item['quantity'],
                        'unit_price': item['unit_price'],
                        'discount': item.get('discount', 0),
                        'tax': item.get('tax', 0),
                        'gross': item['gross'],
                        'is_reference_line': True,
                        'asset_match': None,
                        'confidence': None,
                        'match_reason': 'Reference line',
                        'location': None,
                        'serial_numbers': [],
                    })
                else:
                    new_line_items.append({
                        'description': item['description'],
                        'quantity': item['quantity'],
                        'unit_price': item['unit_price'],
                        'discount': item.get('discount', 0),
                        'tax': item.get('tax', 0),
                        'gross': item['gross'],
                        'is_reference_line': False,
                        'asset_match': None,
                        'confidence': None,
                        'match_reason': 'Unmatched',
                        'location': None,
                        'serial_numbers': [],
                    })

            results[inv_num] = {
                'line_items': new_line_items,
                'project_name': ai_result.get('project_name'),
                'project_location': ai_result.get('site_office_address') or ai_result.get('project_name'),
                'site_office_name': ai_result.get('site_office_name'),
                'site_office_address': ai_result.get('site_office_address'),
                'do_date': ai_result.get('do_date'),
                'do_number': ai_result.get('do_number'),
                'contact_name': ai_result.get('contact_name'),
                'contact_phone': ai_result.get('contact_phone'),
            }
        else:
            errors += 1

        time.sleep(0.3)

    # Save results to a file for DB update
    output_path = os.path.join(os.path.dirname(__file__), 'ai-extract-updates.json')
    with open(output_path, 'w') as f:
        json.dump(results, f, indent=2, default=str)

    print(f"\nDone!", flush=True)
    print(f"  Processed: {processed}", flush=True)
    print(f"  Successfully extracted: {len(results)}", flush=True)
    print(f"  Errors: {errors}", flush=True)
    print(f"  Saved to: {output_path}", flush=True)


if __name__ == '__main__':
    main()
