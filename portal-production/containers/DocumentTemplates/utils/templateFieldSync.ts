/**
 * Template Field Synchronization Utility
 *
 * This utility syncs template field definitions to the database.
 * When a template is created or its variant is changed, this updates
 * the template's config.formFields in the database.
 */

import { TEMPLATE_FIELD_DEFINITIONS, getTemplateFields } from '../config/templateFieldDefinitions';
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

    // Update the template's config with form field definitions
    const response = await request(
      {
        path: `/documentTemplates/update`,
        method: 'POST',
      },
      {
        id: templateId,
        config: {
          formFields: fieldConfig
        }
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
    // Fetch all templates for the organization
    const response = await request(
      {
        path: `/documentTemplates?limit=100`,
        method: 'GET',
      },
      {},
      token
    );

    if (!response.success || !response.data?.docs) {
      console.error('Failed to fetch templates');
      return;
    }

    const templates = response.data.docs;
    console.log(`Found ${templates.length} templates to sync`);

    // Sync each template
    for (const template of templates) {
      const variant = template.templateVariant || template.designName || 'Default';

      if (TEMPLATE_FIELD_DEFINITIONS[variant]) {
        await syncTemplateFields(template.id, variant, token);
      } else {
        console.log(`⏭️  Skipping template ${template.id} - no field definitions for variant: ${variant}`);
      }
    }

    console.log('✅ Template field sync complete');
  } catch (error) {
    console.error('Error in bulk template sync:', error);
  }
}

/**
 * Get form fields config for a template variant
 * Returns the default field definitions for the variant
 * In the future, this could fetch from database if template ID is available
 */
export async function getTemplateFormFields(
  templateVariant: string,
  templateId?: string,
  token?: string
) {
  try {
    // If template ID is provided, try to fetch from database
    if (templateId && token) {
      const response = await request(
        {
          path: `/documentTemplates/${templateId}`,
          method: 'GET',
        },
        {},
        token
      );

      if (response.success && response.data?.config?.formFields) {
        // Return fields from database
        console.log(`Using database field definitions for template ${templateId}`);
        return response.data.config.formFields;
      }
    }

    // Use default definitions for the variant
    console.log(`Using default field definitions for ${templateVariant}`);
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
