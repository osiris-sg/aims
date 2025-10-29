# Dynamic Form System for Document Templates

This system allows you to define form fields per template variant without hardcoding them in TabbedDocumentCreator.

## How It Works

1. **Design your template** (e.g., TI2 layout in `CleanDocumentPreview.tsx`)
2. **Define the fields** it uses in `templateFieldDefinitions.ts`
3. **System auto-generates forms** based on those definitions

## Files Created

### 1. `/config/templateFieldDefinitions.ts`
Defines all form fields for each template variant (TI, TI2, DO, etc.)

**Features:**
- ✅ Supports unlimited tabs per template
- ✅ Each tab has: `tabId`, `tabLabel`, and `fields[]`
- ✅ Fields support: text, number, date, select, autocomplete, textarea, customer
- ✅ NO company fields (those come from organization backend)
- ✅ Dependent dropdowns (e.g., projects filtered by customer)

**Example structure:**
```typescript
TI2: {
  tabs: [
    {
      tabId: 'general',
      tabLabel: 'GENERAL',
      fields: [
        {
          fieldName: 'customer',
          displayLabel: 'Customer',
          fieldType: 'customer',
          required: true,
          gridSize: 12,
          dataSource: 'customers'
        },
        {
          fieldName: 'documentInfo.documentNumber',
          displayLabel: 'Invoice No.',
          fieldType: 'text',
          required: true,
          gridSize: 6
        }
        // ... more fields
      ]
    },
    {
      tabId: 'details',
      tabLabel: 'DETAILS',
      fields: [...]
    },
    // Can add more tabs:
    {
      tabId: 'payment',
      tabLabel: 'PAYMENT INFO',
      fields: [...]
    }
  ]
}
```

### 2. `/utils/templateFieldSync.ts`
Utilities to sync field definitions to database

**Functions:**
- `syncTemplateFields(templateId, variant, token)` - Sync one template
- `syncAllTemplates(organizationId, token)` - Bulk sync all templates
- `getTemplateFormFields(templateId, variant, token)` - Get fields from DB or defaults

### 3. `/components/DynamicFormFields.tsx`
Component that renders fields dynamically

**Props:**
- `fields` - Array of field definitions to render
- `formData` - Current form state
- `setFormData` - Form state setter
- `customers`, `projects`, `deliveryOrders`, `siteOffices` - Data sources

## Usage in TabbedDocumentCreator

```typescript
import { getTemplateFormFields } from '../utils/templateFieldSync';
import DynamicFormFields from './DynamicFormFields';

// 1. Load template field config
const [fieldConfig, setFieldConfig] = useState(null);

useEffect(() => {
  async function loadFields() {
    const token = await getToken();
    const config = await getTemplateFormFields(
      documentTemplateId,
      documentType,
      token
    );
    setFieldConfig(config);
  }
  loadFields();
}, [documentTemplateId, documentType]);

// 2. Render tabs dynamically
{fieldConfig?.tabs.map((tab, index) => (
  <Tab key={tab.tabId} label={tab.tabLabel} />
))}

// 3. Render fields for each tab
{fieldConfig?.tabs.map((tab, index) => (
  <TabPanel key={tab.tabId} value={mainTabValue} index={index}>
    <DynamicFormFields
      fields={tab.fields}
      formData={formData}
      setFormData={setFormData}
      customers={customers}
      projects={projects}
      deliveryOrders={deliveryOrders}
      siteOffices={siteOffices}
    />
  </TabPanel>
))}
```

## Adding a New Template Variant

1. **Design the template** in `CleanDocumentPreview.tsx`
2. **Add field definitions** in `templateFieldDefinitions.ts`:

```typescript
export const TEMPLATE_FIELD_DEFINITIONS = {
  // ... existing templates

  MY_NEW_TEMPLATE: {
    tabs: [
      {
        tabId: 'general',
        tabLabel: 'GENERAL',
        fields: [
          {
            fieldName: 'customer',
            displayLabel: 'Customer',
            fieldType: 'customer',
            required: true,
            gridSize: 12,
            dataSource: 'customers'
          },
          // ... your fields
        ]
      },
      {
        tabId: 'advanced',
        tabLabel: 'ADVANCED OPTIONS',
        fields: [
          // ... more fields
        ]
      }
    ]
  }
};
```

3. **Sync to database** (run once):
```typescript
await syncTemplateFields(templateId, 'MY_NEW_TEMPLATE', token);
```

4. **Done!** Forms will render automatically.

## Field Types Supported

- `text` - Regular text input
- `number` - Number input
- `date` - Date picker
- `select` - Dropdown with options
- `autocomplete` - Searchable dropdown
- `textarea` - Multi-line text input
- `customer` - Special customer selector with autocomplete

## Data Sources

- `customers` - Customer list
- `projects` - Project list (can be filtered by customer)
- `deliveryOrders` - Delivery orders (filtered by customer)
- `siteOffices` - Site offices
- `currencies` - Currency options (SGD, USD, EUR, etc.)

## Benefits

✅ **No more hardcoded fields** in TabbedDocumentCreator
✅ **Easy to add new templates** - just define fields
✅ **Unlimited tabs** per template
✅ **Template variants** can have completely different forms
✅ **Company data excluded** - comes from organization backend
✅ **Type-safe** with TypeScript interfaces
