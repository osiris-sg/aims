/**
 * Template Field Definition Types
 *
 * These types define the structure for document template field definitions.
 * Field definitions are stored in the database and fetched via API.
 */

export interface FieldDefinition {
  fieldName: string; // Technical field name (path in data object) - how it appears in the form
  displayLabel: string; // User-facing label
  fieldType: "text" | "number" | "date" | "select" | "autocomplete" | "textarea" | "table" | "customer" | "salesman" | "supplier";
  required: boolean;
  gridSize?: 6 | 12; // Grid column size (6 = half width, 12 = full width)
  dataSource?: string; // For select/autocomplete: 'customers', 'projects', 'deliveryOrders', etc.
  options?: { value: string; label: string }[]; // For select: static options (overrides dataSource)
  placeholder?: string;
  defaultValue?: any;
  filterBy?: string; // For dependent dropdowns: filter by this field (e.g., 'customerId')
  storagePath?: string; // Where this field is stored in the database (if different from fieldName)
}

export interface TabDefinition {
  tabId: string; // Unique identifier for the tab
  tabLabel: string; // Display label for the tab
  fields: FieldDefinition[];
}

export interface TemplateFieldConfig {
  tabs: TabDefinition[];
}
