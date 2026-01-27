/**
 * Template Field Synchronization Utility
 *
 * This utility manages template field definitions between the database and frontend.
 * Field definitions can be customized per-organization through the admin interface.
 */

import { TEMPLATE_FIELD_DEFINITIONS, getTemplateFields, TemplateFieldConfig } from '../config/templateFieldDefinitions';
import { request } from '@/helpers/request';

/**
 * Sync field definitions for a template to the database
 * @param templateId - The template ID to update
 * @param templateVariant - The template variant (TI, TI2, DO, etc.)
 * @param token - Auth token
 * @returns Updated template data
 */
export async function syncTemplateFields(
  templateId: string,
  templateVariant: string,
  token: string
) {
  try {
    // Get field definitions for this variant
    const fieldConfig = getTemplateFields(templateVariant);

    if (!fieldConfig) {
      console.warn(`No field definitions found for template variant: ${templateVariant}`);
      return null;
    }

    // Update the template's field definitions via the dedicated endpoint
    const response = await request(
      {
        path: `/documentTemplates/${templateId}/fields`,
        method: 'PUT',
      },
      {
        formFields: fieldConfig
      },
      token
    );

    if (response.success) {
      console.log(`✅ Synced field definitions for template ${templateId} (${templateVariant})`);
      return response.data;
    } else {
      console.error(`❌ Failed to sync field definitions:`, response.message);
      return null;
    }
  } catch (error) {
    console.error('Error syncing template fields:', error);
    return null;
  }
}

/**
 * Sync all templates in the organization with their field definitions
 * Useful for bulk updates or migrations
 */
export async function syncAllTemplates(organizationId: string, token: string) {
  try {
    // Use the populate-fields endpoint for bulk sync
    const response = await request(
      {
        path: `/documentTemplates/populate-fields`,
        method: 'POST',
      },
      {},
      token
    );

    if (response.success) {
      console.log('✅ Template field sync complete:', response.data);
      return response.data;
    } else {
      console.error('Failed to sync templates:', response.message);
      return null;
    }
  } catch (error) {
    console.error('Error in bulk template sync:', error);
    return null;
  }
}

/**
 * Get form fields config for a template
 * Priority: Database fields > Default definitions
 *
 * @param templateVariant - The template variant (TI, TI2, DO, etc.)
 * @param templateId - Optional template ID to fetch custom fields from database
 * @param token - Auth token for API requests
 * @returns Field configuration for the template
 */
export async function getTemplateFormFields(
  templateVariant: string,
  templateId?: string,
  token?: string
): Promise<TemplateFieldConfig | null> {
  try {
    // If template ID is provided, try to fetch from dedicated fields endpoint
    if (templateId && token) {
      const response = await request(
        {
          path: `/documentTemplates/${templateId}/fields`,
          method: 'GET',
        },
        {},
        token
      );

      if (response.success && response.data?.formFields) {
        console.log(`Using ${response.data.source} field definitions for template ${templateId}`);
        return response.data.formFields;
      }
    }

    // Fallback: Use default definitions for the variant
    console.log(`Using local default field definitions for ${templateVariant}`);
    const config = getTemplateFields(templateVariant);
    console.log(`getTemplateFields(${templateVariant}) returned:`, config);
    console.log(`Has tabs:`, config?.tabs?.length || 0);
    return config;
  } catch (error) {
    console.error('Error fetching template form fields:', error);
    // Fallback to default definitions
    return getTemplateFields(templateVariant);
  }
}

/**
 * Update field definitions for a template
 * @param templateId - The template ID to update
 * @param formFields - The new field configuration
 * @param token - Auth token
 * @returns Update result
 */
export async function updateTemplateFieldDefinitions(
  templateId: string,
  formFields: TemplateFieldConfig,
  token: string
) {
  try {
    const response = await request(
      {
        path: `/documentTemplates/${templateId}/fields`,
        method: 'PUT',
      },
      {
        formFields
      },
      token
    );

    if (response.success) {
      console.log(`✅ Updated field definitions for template ${templateId}`);
      return response.data;
    } else {
      console.error(`❌ Failed to update field definitions:`, response.message);
      return null;
    }
  } catch (error) {
    console.error('Error updating template fields:', error);
    return null;
  }
}

/**
 * Get default field definitions for a template variant (from hardcoded defaults)
 * Useful for resetting to defaults
 * @param templateVariant - The template variant
 * @returns Default field configuration
 */
export function getDefaultFieldDefinitions(templateVariant: string): TemplateFieldConfig | null {
  return getTemplateFields(templateVariant);
}
