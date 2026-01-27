/**
 * Template Field Synchronization Utility
 *
 * This utility manages template field definitions between the database and frontend.
 * Field definitions are stored in the database and fetched via API.
 * All field definitions are now database-driven - no local hardcoded fallbacks.
 */

import { TemplateFieldConfig } from '../types/templateFieldTypes';
import { request } from '@/helpers/request';

// Re-export types for convenience
export type { TemplateFieldConfig, TabDefinition, FieldDefinition } from '../types/templateFieldTypes';

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
    // Fetch default field definitions from API
    const defaultFields = await fetchDefaultFieldDefinitions(templateVariant, token);

    if (!defaultFields) {
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
        formFields: defaultFields
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
 * Fetch default field definitions for a template variant from the API
 * @param templateVariant - The template variant (TI, TI2, DO, etc.)
 * @param token - Auth token
 * @returns Default field configuration or null
 */
export async function fetchDefaultFieldDefinitions(
  templateVariant: string,
  token: string
): Promise<TemplateFieldConfig | null> {
  try {
    const response = await request(
      {
        path: `/documentTemplates/defaults/${templateVariant}`,
        method: 'GET',
      },
      {},
      token
    );

    if (response.success && response.data?.formFields) {
      return response.data.formFields;
    }
    return null;
  } catch (error) {
    console.error('Error fetching default field definitions:', error);
    return null;
  }
}

/**
 * Get form fields config for a template
 * Fetches from database via API. No local fallback.
 *
 * @param templateVariant - The template variant (TI, TI2, DO, etc.)
 * @param templateId - Template ID to fetch custom fields from database
 * @param token - Auth token for API requests
 * @returns Field configuration for the template
 */
export async function getTemplateFormFields(
  templateVariant: string,
  templateId?: string,
  token?: string
): Promise<TemplateFieldConfig | null> {
  if (!token) {
    console.error('Token is required to fetch template form fields');
    return null;
  }

  try {
    // If template ID is provided, fetch fields for that specific template
    if (templateId) {
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

    // Fallback: Fetch default definitions for the variant from API
    console.log(`Fetching default field definitions for ${templateVariant} from API`);
    return await fetchDefaultFieldDefinitions(templateVariant, token);
  } catch (error) {
    console.error('Error fetching template form fields:', error);
    return null;
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
 * Get default field definitions for a template variant from the API
 * Useful for resetting to defaults
 * @param templateVariant - The template variant
 * @param token - Auth token
 * @returns Default field configuration
 */
export async function getDefaultFieldDefinitions(
  templateVariant: string,
  token: string
): Promise<TemplateFieldConfig | null> {
  return fetchDefaultFieldDefinitions(templateVariant, token);
}
