/** Prisma selects shared by the contract and shipment services (kept apart so neither imports the other's file for them). */

export const STEP_SELECT = {
  id: true,
  code: true,
  title: true,
  displayNo: true,
  sortOrder: true,
  requiredDocTypes: true,
  optionalDocTypes: true,
  requiredFields: true,
  isOngoing: true,
  notApplicable: true,
  subtasks: true,
  payment: true,
  skipReason: true,
  status: true,
  holdOpen: true,
  updatedById: true,
  updatedByName: true,
  completedAt: true,
  updatedAt: true,
};

export const CONTRACT_LINE_SELECT = {
  id: true,
  grade: true,
  product: true,
  sizeSpec: true,
  quantityMt: true,
  tolerancePct: true,
  supplierPremium: true,
  clientPremium: true,
  qmjp: true,
  billetPremium: true,
  upcharge: true,
  sortOrder: true,
  notes: true,
};

/** Steps as needed for progress + "current step". */
export const STEP_SUMMARY_SELECT = { code: true, title: true, displayNo: true, sortOrder: true, status: true, isOngoing: true, notApplicable: true };

export const FILE_LINK_SELECT = {
  id: true,
  stepId: true,
  createdAt: true,
  file: {
    select: {
      id: true,
      docType: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      uploadedByName: true,
      notes: true,
      thumbKey: true,
      docRef: true,
      source: true,
      emailLogId: true,
      createdAt: true,
    },
  },
};

/** The order fields every list / detail shows. */
export const ORDER_SUMMARY_SELECT = {
  id: true,
  year: true,
  orderNo: true,
  contractId: true,
  customerId: true,
  supplierId: true,
  shipMonth: true,
  deliveryMonth: true,
  product: true,
  grade: true,
  size: true,
  qtyMt: true,
  tolPct: true,
  supplierPremium: true,
  clientPremium: true,
  upcharge: true,
  piNo: true,
  piDate: true,
  piAmount: true,
  depositPct: true,
  status: true,
};


/** Record detail file links: `hasThumb` instead of the thumbnail's storage key. */
export const shapeFileLinks = <L extends { file: { thumbKey?: string | null } }>(links: L[]) =>
  links.map((l) => {
    const { thumbKey, ...file } = l.file;
    return { ...l, file: { ...file, hasThumb: !!thumbKey } };
  });
