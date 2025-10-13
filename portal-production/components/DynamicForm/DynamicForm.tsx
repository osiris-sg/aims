import React, { useEffect } from "react";
import { UseFormReturn } from "react-hook-form";
import { Box, Typography, Divider, Accordion, AccordionSummary, AccordionDetails, Grid } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { DynamicField } from "./DynamicField";
import { useConfiguration } from "@/app/portal/context/ConfigurationContext";

interface DynamicFormProps {
  entityType: string;
  form: UseFormReturn<any>;
  baseFields?: React.ReactNode;
  includeCustomFields?: boolean;
  customFieldsOnly?: boolean;
}

export const DynamicForm: React.FC<DynamicFormProps> = ({
  entityType,
  form,
  baseFields,
  includeCustomFields = true,
  customFieldsOnly = false,
}) => {
  const { control, formState: { errors }, setValue } = form;
  const { getCustomFieldsForEntity, loading } = useConfiguration();
  const customFields = getCustomFieldsForEntity(entityType);

  // Initialize custom fields with default values
  useEffect(() => {
    customFields.forEach(field => {
      if (field.defaultValue) {
        setValue(`customFields.${field.fieldName}`, field.defaultValue);
      }
    });
  }, [customFields, setValue]);

  // Group custom fields by groupName
  const groupedCustomFields = customFields.reduce((groups, field) => {
    const groupName = field.groupName || "Additional Information";
    if (!groups[groupName]) {
      groups[groupName] = [];
    }
    groups[groupName].push(field);
    return groups;
  }, {} as Record<string, typeof customFields>);

  // Sort fields within each group by sortOrder
  Object.keys(groupedCustomFields).forEach(groupName => {
    groupedCustomFields[groupName].sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
  });

  if (loading) {
    return <Box>Loading form configuration...</Box>;
  }

  if (customFieldsOnly) {
    return (
      <Box>
        {Object.entries(groupedCustomFields).map(([groupName, fields]) => (
          <Box key={groupName} sx={{ mb: 3 }}>
            {Object.keys(groupedCustomFields).length > 1 && (
              <>
                <Typography variant="h6" sx={{ mb: 2 }}>
                  {groupName}
                </Typography>
                <Divider sx={{ mb: 2 }} />
              </>
            )}
            <Grid container spacing={2}>
              {fields.map(field => (
                <Grid item xs={12} md={field.fieldType === 'richtext' ? 12 : 6} key={field.id}>
                  <DynamicField field={field} control={control} errors={errors.customFields} />
                </Grid>
              ))}
            </Grid>
          </Box>
        ))}
      </Box>
    );
  }

  return (
    <Box>
      {/* Base fields section */}
      {!customFieldsOnly && baseFields && (
        <Box sx={{ mb: 3 }}>
          {baseFields}
        </Box>
      )}

      {/* Custom fields section */}
      {includeCustomFields && customFields.length > 0 && (
        <>
          {!customFieldsOnly && <Divider sx={{ my: 3 }} />}

          {Object.entries(groupedCustomFields).map(([groupName, fields]) => {
            const hasMultipleGroups = Object.keys(groupedCustomFields).length > 1;

            if (hasMultipleGroups) {
              // Use accordion for multiple groups
              return (
                <Accordion key={groupName} defaultExpanded={groupName === "Additional Information"}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography>{groupName}</Typography>
                    {fields.filter(f => f.required).length > 0 && (
                      <Typography variant="caption" sx={{ ml: 1, color: "text.secondary" }}>
                        ({fields.filter(f => f.required).length} required)
                      </Typography>
                    )}
                  </AccordionSummary>
                  <AccordionDetails>
                    <Grid container spacing={2}>
                      {fields.map(field => (
                        <Grid item xs={12} md={field.fieldType === 'richtext' ? 12 : 6} key={field.id}>
                          <DynamicField field={field} control={control} errors={errors.customFields} />
                        </Grid>
                      ))}
                    </Grid>
                  </AccordionDetails>
                </Accordion>
              );
            } else {
              // Simple display for single group
              return (
                <Box key={groupName}>
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    {groupName}
                  </Typography>
                  <Grid container spacing={2}>
                    {fields.map(field => (
                      <Grid item xs={12} md={field.fieldType === 'richtext' ? 12 : 6} key={field.id}>
                        <DynamicField field={field} control={control} errors={errors.customFields} />
                      </Grid>
                    ))}
                  </Grid>
                </Box>
              );
            }
          })}
        </>
      )}
    </Box>
  );
};

// Hook to handle custom fields in form submission
export const useCustomFieldsSubmission = () => {
  const processFormDataWithCustomFields = (formData: any, entityType: string) => {
    const { customFields, ...baseData } = formData;

    // Return separated data for backend processing
    return {
      baseData,
      customFields: customFields || {},
    };
  };

  const submitWithCustomFields = async (
    formData: any,
    entityType: string,
    submitFunction: (data: any) => Promise<any>,
    token: string,
    organizationId: string
  ) => {
    const { baseData, customFields } = processFormDataWithCustomFields(formData, entityType);

    // Include custom fields in the request body
    // The backend interceptor will handle extracting and storing them
    const dataToSubmit = {
      ...baseData,
      customFields,
    };

    return submitFunction(dataToSubmit);
  };

  return {
    processFormDataWithCustomFields,
    submitWithCustomFields,
  };
};