import { BadRequestException } from '@nestjs/common';
import type { CreateSupplierOrderDto } from './dto/supplier-order.dto';
import type { TradeActor } from './shipments.request';
import { depositOf, tradeToday } from './shipments.rules';
import { Db, isUniqueViolation, optText, TradeConfigService } from './trade-config.service';
import { premiumAt } from './trade-contract';

/** The next free supplier-order number for a year. */
export async function nextSoNo(db: Db, organizationId: string, year: number): Promise<number> {
  const last: { soNo: number } | null = await db.supplierOrder.findFirst({ where: { organizationId, year }, orderBy: { soNo: 'desc' }, select: { soNo: true } });
  return (last?.soNo ?? 0) + 1;
}

/**
 * Create a supplier order (Vedanta's PI) inside a transaction: defaults from
 * the contract (grade, size, QP basis, the month's supplier premium), steps
 * 0 / 1 snapshotted with the supplier's profile (no PI → step 1 N/A), and the
 * PI file linked to step 1. Shared by the supplier-order service, the
 * Declaration and "New Order" (which makes a 1:1 supplier order).
 */
export async function createSupplierOrderInTx(tx: Db, config: TradeConfigService, organizationId: string, dto: CreateSupplierOrderDto, actor: TradeActor): Promise<string> {
  const contract = dto.contractId
    ? await tx.contract.findFirst({
        where: { id: dto.contractId, organizationId },
        select: { id: true, supplierId: true, grade: true, sizeSpec: true, qpBasis: true, premiumSchedule: true, lines: { orderBy: { sortOrder: 'asc' } } },
      })
    : null;
  if (dto.contractId && !contract) throw new BadRequestException('Contract not found in this organization');
  const supplierId = dto.supplierId ?? contract?.supplierId;
  if (!supplierId) throw new BadRequestException('Pick the supplier (or a contract)');
  if (!(await tx.supplier.findFirst({ where: { id: supplierId, organizationId }, select: { id: true } }))) throw new BadRequestException('Supplier not found in this organization');
  const year = dto.year ?? (dto.declarationMonth ? Number(dto.declarationMonth.slice(0, 4)) : Number(tradeToday().slice(0, 4)));
  const soNo = await nextSoNo(tx, organizationId, year);
  const lines: Array<{ grade: string | null; supplierPremium: unknown; product: string | null; sizeSpec: string | null }> = contract?.lines ?? [];
  const g = (dto.grade ?? '').trim();
  const line = (g ? lines.find((l) => (l.grade ?? '').trim() === g) : null) ?? (lines.length === 1 ? lines[0] : null);
  const sched = premiumAt(contract?.premiumSchedule, dto.declarationMonth ?? null);
  let created: { id: string };
  try {
    created = await tx.supplierOrder.create({
      data: {
        organizationId,
        year,
        soNo,
        supplierId,
        contractId: contract?.id ?? null,
        declarationMonth: dto.declarationMonth ?? null,
        product: optText(dto.product) ?? line?.product ?? null,
        grade: optText(dto.grade) ?? line?.grade ?? contract?.grade ?? null,
        size: optText(dto.size) ?? line?.sizeSpec ?? contract?.sizeSpec ?? null,
        qtyMt: dto.qtyMt ?? null,
        qpBasis: optText(dto.qpBasis) ?? contract?.qpBasis ?? null,
        provisionalPricePerMt: dto.provisionalPricePerMt ?? null,
        supplierPremium: dto.supplierPremium ?? sched?.supplierPremium ?? (line?.supplierPremium as number | null) ?? null,
        currency: dto.currency ?? 'USD',
        piNo: optText(dto.piNo) ?? null,
        piDate: dto.piDate ? new Date(dto.piDate) : null,
        piAmount: dto.piAmount ?? null,
        depositPct: dto.depositPct ?? 10,
        depositAmount: dto.depositAmount ?? depositOf(dto.piAmount, dto.depositPct ?? 10),
        depositPaidAt: dto.depositPaidAt ? new Date(dto.depositPaidAt) : null,
        notes: optText(dto.notes) ?? null,
        createdById: actor.id,
      },
      select: { id: true },
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new BadRequestException('Two supplier orders were created at once — try again');
    throw e;
  }
  const sp = await config.supplierProfileOf(organizationId, supplierId, tx);
  await config.snapshotSteps(tx, organizationId, 'SUPPLIER_ORDER', { supplierOrderId: created.id }, undefined, sp);
  if (dto.piFileId) await config.linkSourceFile(tx, organizationId, dto.piFileId, 'PI', { supplierOrderId: created.id }, 'PI_PAYMENT');
  return created.id;
}
