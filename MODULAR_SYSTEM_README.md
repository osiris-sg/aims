# AIMS Modular Configuration System

## Overview

The AIMS ERP solution now features a fully modular, configuration-driven architecture that allows complete customization for each client organization without modifying core code. This system enables you to:

- 🎯 **Customize UI Navigation** - Enable/disable modules, reorder, rename
- 🎨 **Brand Customization** - Colors, logos, terminology
- 📝 **Dynamic Custom Fields** - Add fields to any entity without code changes
- 🏢 **Multi-Tenant Architecture** - Each organization has isolated configuration
- 🚀 **Quick Client Onboarding** - Scripts for rapid deployment

## Architecture Components

### 1. Database Models

```
OrganizationModule     - Module visibility and configuration per org
CustomField           - Dynamic fields for entities
CustomFieldValue      - Stores custom field data
OrganizationUIConfig  - UI theme, terminology, features
```

### 2. Backend Services

- **ConfigurationService** (`/api-server-production/src/configuration/`)
  - Manages modules, custom fields, and UI configuration
  - Provides complete configuration API

- **Custom Fields Interceptor**
  - Automatically handles custom fields in requests/responses
  - Applied via `@WithCustomFields()` decorator

### 3. Frontend Components

- **ConfigurationContext** - Provides configuration data throughout the app
- **DynamicSidebarContent** - Renders navigation based on enabled modules
- **DynamicForm** - Renders forms with custom fields
- **Configuration Admin Page** - UI for managing all configuration

## Quick Start Guide

### 1. Initialize Default Configuration

For existing organizations:
```bash
cd api-server-production
npm run db:push  # Apply schema changes
ts-node scripts/migrate-existing-organizations.ts
```

### 2. Onboard New Client

Interactive wizard for new clients:
```bash
ts-node scripts/onboard-client.ts
```

This wizard will:
- Create organization
- Set up branding
- Configure terminology
- Initialize modules
- Add default custom fields

### 3. Manual Configuration via API

Initialize modules for an organization:
```bash
curl -X POST http://localhost:3001/configuration/modules/initialize \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "x-organization-id: ORG_ID"
```

## Usage Examples

### Adding Custom Fields to Assets

1. **Via Admin UI:**
   - Navigate to `/portal/admin/configuration`
   - Select "Custom Fields" tab
   - Choose "Asset" entity type
   - Click "Add Custom Field"
   - Configure field properties

2. **Via API:**
```javascript
POST /configuration/custom-fields
{
  "entityType": "Asset",
  "fieldName": "warranty_date",
  "displayLabel": "Warranty Expiry",
  "fieldType": "date",
  "required": false,
  "groupName": "Warranty Information"
}
```

3. **In Frontend Forms:**
```tsx
import { DynamicForm } from "@/components/DynamicForm";

<DynamicForm
  entityType="Asset"
  form={form}
  baseFields={<YourBaseFields />}
  includeCustomFields={true}
/>
```

### Customizing Navigation

1. **Disable a Module:**
```javascript
PUT /configuration/modules/PROJECTS
{
  "enabled": false
}
```

2. **Rename a Module:**
```javascript
PUT /configuration/modules/ASSETS
{
  "displayName": "Equipment"
}
```

3. **Reorder Modules:**
```javascript
PUT /configuration/modules/INVENTORY
{
  "sortOrder": 1
}
```

### Customizing Terminology

Change how entities are labeled:
```javascript
PUT /configuration/ui
{
  "terminology": {
    "asset": "Equipment",
    "customer": "Client",
    "inventory": "Stock"
  }
}
```

## Client Templates

Three pre-configured templates are available:

### Standard Template
- All core modules enabled
- Standard custom fields
- Basic features

### Enterprise Template
- All modules enabled
- Advanced custom fields
- Analytics & integrations
- API access

### Minimal Template
- Basic modules only
- Essential custom fields
- Simplified UI

## Migration Path

### For Existing Installations

1. **Backup Database**
2. **Update Codebase**
3. **Run Migration Script:**
   ```bash
   ts-node scripts/migrate-existing-organizations.ts
   ```
4. **Verify Configuration:**
   - Check navigation renders correctly
   - Test custom fields
   - Validate permissions

### Rollback Procedure

If issues occur:
```bash
ts-node scripts/migrate-existing-organizations.ts --cleanup ORG_ID
```

## API Endpoints

### Module Management
- `GET /configuration/modules` - List all modules
- `POST /configuration/modules` - Create/update module
- `PUT /configuration/modules/:code` - Update specific module
- `DELETE /configuration/modules/:code` - Delete module
- `POST /configuration/modules/initialize` - Initialize defaults

### Custom Fields
- `GET /configuration/custom-fields?entityType=Asset` - List fields
- `POST /configuration/custom-fields` - Create field
- `PUT /configuration/custom-fields/:id` - Update field
- `DELETE /configuration/custom-fields/:id` - Delete field
- `GET /configuration/custom-fields/values/:entityId` - Get values
- `POST /configuration/custom-fields/values` - Set values

### UI Configuration
- `GET /configuration/ui` - Get UI config
- `PUT /configuration/ui` - Update UI config

### Complete Configuration
- `GET /configuration/complete` - Get all configuration

## Custom Field Types

Supported field types:
- `text` - Single line text
- `number` - Numeric input
- `date` - Date picker
- `boolean` - Checkbox
- `select` - Dropdown single selection
- `multiselect` - Multiple selection
- `email` - Email validation
- `phone` - Phone number
- `url` - URL validation
- `richtext` - Multi-line formatted text
- `file` - File upload

## Feature Flags

Control feature availability:
```javascript
{
  "features": {
    "enableProjects": true,
    "enableDocumentAI": false,
    "enableXeroIntegration": true,
    "enableCustomFields": true,
    "enableAdvancedReporting": false
  }
}
```

## Best Practices

### 1. Organization Setup
- Always initialize configuration after creating organization
- Use templates for consistency
- Document custom configurations

### 2. Custom Fields
- Use descriptive field names (snake_case)
- Group related fields together
- Set appropriate validation rules
- Consider performance with many fields

### 3. Module Management
- Test module dependencies before disabling
- Maintain consistent sort order
- Document module purposes

### 4. Client Onboarding
- Use the onboarding script for consistency
- Keep configuration summaries
- Test in staging first

## Troubleshooting

### Navigation Not Updating
1. Check ConfigurationContext is wrapped around components
2. Verify organization has modules initialized
3. Clear browser cache

### Custom Fields Not Appearing
1. Ensure field has `showInForm: true`
2. Check entity type matches
3. Verify ConfigurationModule is imported

### Module Not Found
1. Run initialization script
2. Check module is enabled
3. Verify correct organization context

## Security Considerations

- Custom field values are organization-scoped
- Configuration changes require admin permissions
- Field validation happens server-side
- HTML in rich text fields is sanitized

## Performance Tips

- Cache configuration in frontend
- Limit custom fields per entity (< 50 recommended)
- Use field groups to organize large forms
- Enable only needed modules

## Future Enhancements

Planned improvements:
- [ ] Configuration import/export
- [ ] Field dependencies and conditionals
- [ ] Custom validation rules UI
- [ ] Module marketplace
- [ ] Configuration versioning
- [ ] A/B testing support

## Support

For issues or questions:
1. Check this documentation
2. Review example implementations
3. Contact development team

## Scripts Reference

### Initialize Organization Config
```bash
ts-node scripts/initialize-organization-config.ts ORG_ID [template]
# template: standard | enterprise | minimal
```

### Onboard New Client
```bash
ts-node scripts/onboard-client.ts
# Interactive wizard
```

### Migrate Existing Organizations
```bash
ts-node scripts/migrate-existing-organizations.ts
# Migrates all organizations

ts-node scripts/migrate-existing-organizations.ts --cleanup ORG_ID
# Cleanup failed migration
```

---

## Summary

The modular configuration system transforms AIMS from a rigid ERP to a flexible, customizable platform that can adapt to any client's needs without code changes. By leveraging configuration over customization, you can:

- Onboard clients in minutes, not days
- Maintain a single codebase for all clients
- Provide self-service customization options
- Scale efficiently across different industries
- Reduce maintenance overhead

The system is production-ready and backward-compatible with existing installations.