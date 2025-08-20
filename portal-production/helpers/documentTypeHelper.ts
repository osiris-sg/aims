/**
 * Helper functions for resolving custom document type display names
 */

export interface Organization {
  customDocumentTypes?: Record<string, string> | null;
}

/**
 * Get the display name for a document type based on organization settings
 * @param documentType - The internal document type code (e.g., "TI", "QO1")
 * @param organization - The organization object with custom document types
 * @param fallbackLabel - Optional fallback label if no custom name is set
 * @returns The custom display name or fallback
 */
export function getDocumentTypeDisplayName(documentType: string, organization?: Organization | null, fallbackLabel?: string): string {
  // Check if organization has custom document types defined
  const customTypes = organization?.customDocumentTypes;

  if (customTypes && customTypes[documentType]) {
    return customTypes[documentType];
  }

  // Return fallback label or the document type code itself
  return fallbackLabel || documentType;
}

/**
 * Default document type labels for fallback
 */
export const DEFAULT_DOCUMENT_TYPE_LABELS: Record<string, string> = {
  TI: "Tax Invoice",
  QO1: "Quotation 1",
  QO2: "Quotation 2",
  DO: "Delivery Order",
  RDO: "Return Delivery Order",
  MSR: "Maintenance Service Report",
};

/**
 * Get the display name with default fallback labels
 * @param documentType - The internal document type code
 * @param organization - The organization object with custom document types
 * @returns The custom display name or default label
 */
export function getDocumentTypeDisplayNameWithDefaults(documentType: string, organization?: Organization | null): string {
  return getDocumentTypeDisplayName(documentType, organization, DEFAULT_DOCUMENT_TYPE_LABELS[documentType]);
}
