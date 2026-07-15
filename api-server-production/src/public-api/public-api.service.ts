import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { UnitBySidResponseDto } from './dto/unit-by-sid.dto';

// water-sg is single-tenant to Biofuel; SID skus exist only under this org, so
// every lookup is scoped here. (Same convention as ingestion/import services,
// which each pin their own Biofuel org id.)
const BIOFUEL_ORG_ID = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';

@Injectable()
export class PublicApiService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve a SIDS ID (bare "45"/"045" or "SID 045") to the AIMS unit's current
   * state. Canonicalizes to the exact sku "SID NNN", matches only SIDS-line
   * assets within Biofuel, and returns a whitelisted projection.
   */
  async getUnitBySid(rawSidId: string): Promise<UnitBySidResponseDto> {
    const canonical = this.canonicalizeSid(rawSidId); // { sidId: "045", sku: "SID 045" }

    const unit = await this.prisma.inventory.findFirst({
      where: {
        organizationId: BIOFUEL_ORG_ID,
        sku: canonical.sku,
        // Belt-and-braces: only ever resolve SIDS-line units through this path.
        asset: { is: { waterSgProductLine: 'SIDS' } },
      },
      select: {
        sku: true,
        status: true,
        taggedLatitude: true,
        taggedLongitude: true,
        asset: { select: { name: true } },
        // Active assignment only (endDate null). A unit has at most one.
        assignments: {
          where: { endDate: null },
          take: 1,
          select: {
            project: {
              select: { name: true, customer: { select: { name: true } } },
            },
            projectDeployment: { select: { type: true, deployedDate: true } },
          },
        },
        // The linked Sim Card child unit (the SIM holder — replaces TSS in this
        // role). A SIDS system has at most one Sim Card child; scope to the
        // SIMCARD asset. TSS is still a child but is never the SIM source here.
        childInventories: {
          where: { asset: { is: { skuKey: 'SIMCARD' } } },
          take: 1,
          select: { sku: true, simCardId: true },
        },
      },
    });

    if (!unit) {
      throw new NotFoundException(`No SIDS unit found for SID ${canonical.sidId}.`);
    }

    const active = unit.assignments[0] ?? null;
    const child = unit.childInventories[0] ?? null;

    // Build the response field-by-field — never spread the Prisma row.
    return {
      sidId: canonical.sidId,
      sku: unit.sku,
      assetName: unit.asset?.name ?? '',
      status: unit.status,
      project: active?.project
        ? { name: active.project.name, customer: active.project.customer?.name ?? null }
        : null,
      deploymentType: active?.projectDeployment?.type ?? null,
      deployedDate: active?.projectDeployment?.deployedDate?.toISOString() ?? null,
      taggedLatitude: unit.taggedLatitude ?? null,
      taggedLongitude: unit.taggedLongitude ?? null,
      // The Sim Card child + its SIM, or null when no Sim Card child exists.
      child: child ? { sku: child.sku, simCardId: child.simCardId ?? null } : null,
    };
  }

  /**
   * List ALL SIDS-line units for water-sg's "link a site" dropdown.
   *
   * DESIGN: AIMS does not know which SIDS units are already linked to a
   * water-sg site — that link lives only in water-sg (Site.aimsUnitId). So this
   * returns EVERY SIDS unit; water-sg excludes the ones its own sites already
   * reference (matching each unit's `sidId` against its Site.aimsUnitId values).
   */
  async getSidsUnits(): Promise<{ units: Array<{ sidId: string | null; sku: string; status: string }> }> {
    const units = await this.prisma.inventory.findMany({
      where: { organizationId: BIOFUEL_ORG_ID, asset: { is: { waterSgProductLine: 'SIDS' } } },
      select: { sku: true, status: true },
      orderBy: { sku: 'asc' },
    });
    return {
      units: units.map((u) => ({ sidId: this.sidIdFromSku(u.sku), sku: u.sku, status: u.status })),
    };
  }

  /** Digits of a value → integer 1..999 → zero-padded to 3 ("SID 045"/"45" →
   *  "045"). Returns null when there's no usable SID number. */
  private sidIdFromSku(value: string): string | null {
    const digits = (value ?? '').replace(/\D/g, '');
    const n = Number(digits);
    if (!digits || !Number.isInteger(n) || n < 1 || n > 999) return null;
    return String(n).padStart(3, '0');
  }

  /**
   * Accept "45", "045", "SID 045", "SID045", "sid-045" → { sidId: "045",
   * sku: "SID 045" }. Rejects anything without a 1..999 numeric part.
   */
  private canonicalizeSid(raw: string): { sidId: string; sku: string } {
    const sidId = this.sidIdFromSku(raw);
    if (!sidId) {
      throw new BadRequestException(
        `Invalid SIDS ID "${raw}". Expected a number 1-999 (e.g. "45", "045", or "SID 045").`,
      );
    }
    return { sidId, sku: `SID ${sidId}` };
  }
}
