"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Box,
  Paper,
  Typography,
  Button,
  Chip,
  Grid,
  Card,
  CardContent,
  CardHeader,
  IconButton,
  CircularProgress,
  Divider,
  List,
  ListItem,
  ListItemText,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import EditIcon from "@mui/icons-material/Edit";
import SettingsIcon from "@mui/icons-material/Settings";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { useGetDocumentTemplate, useGetTemplateFieldDefinitions } from "../hooks/useGetDocumentTemplates";

export default function DocumentTemplateDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { template, loading: templateLoading } = useGetDocumentTemplate(id);
  const { fieldDefinitions, source, loading: fieldsLoading } = useGetTemplateFieldDefinitions(id);

  if (templateLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "50vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!template) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h6">Template not found</Typography>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => router.push("/portal/admin/document-templates")}
          sx={{ mt: 2 }}
        >
          Back to Templates
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", mb: 3, gap: 2 }}>
        <IconButton onClick={() => router.push("/portal/admin/document-templates")}>
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5">{template.name}</Typography>
          <Typography variant="body2" color="text.secondary">
            Template ID: {template.id}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<SettingsIcon />}
          onClick={() => router.push(`/portal/admin/document-templates/${id}/fields`)}
        >
          Edit Fields
        </Button>
      </Box>

      <Grid container spacing={3}>
        {/* Template Info */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="Template Information" />
            <CardContent>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="body2" color="text.secondary">Document Type</Typography>
                  <Chip label={template.type} size="small" color="primary" />
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="body2" color="text.secondary">Variant</Typography>
                  <Chip label={template.templateVariant || template.designName || "Default"} size="small" color="secondary" />
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="body2" color="text.secondary">Status</Typography>
                  <Chip
                    label={template.isActive ? "Active" : "Inactive"}
                    size="small"
                    color={template.isActive ? "success" : "default"}
                    icon={template.isActive ? <CheckCircleIcon /> : undefined}
                  />
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="body2" color="text.secondary">Field Definitions</Typography>
                  <Chip
                    label={source === "database" ? "Custom" : "Default"}
                    size="small"
                    color={source === "database" ? "info" : "default"}
                    variant={source === "database" ? "filled" : "outlined"}
                  />
                </Box>
                {template.description && (
                  <Box>
                    <Typography variant="body2" color="text.secondary">Description</Typography>
                    <Typography variant="body1">{template.description}</Typography>
                  </Box>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Organization Info */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="Organization" />
            <CardContent>
              <Typography variant="body1">
                {template.organization?.name || template.organizationId}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Created: {new Date(template.createdAt).toLocaleString()}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Updated: {new Date(template.updatedAt).toLocaleString()}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Field Definitions */}
        <Grid item xs={12}>
          <Card>
            <CardHeader
              title="Field Definitions"
              subheader={`Source: ${source === "database" ? "Custom (Database)" : "Default (Hardcoded)"}`}
              action={
                fieldsLoading ? (
                  <CircularProgress size={24} />
                ) : null
              }
            />
            <CardContent>
              {fieldDefinitions?.tabs?.length > 0 ? (
                fieldDefinitions.tabs.map((tab: any, tabIndex: number) => (
                  <Accordion key={tab.tabId || tabIndex} defaultExpanded={tabIndex === 0}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="subtitle1" fontWeight="medium">
                        {tab.tabLabel}
                      </Typography>
                      <Chip
                        label={`${tab.fields?.length || 0} fields`}
                        size="small"
                        sx={{ ml: 2 }}
                      />
                    </AccordionSummary>
                    <AccordionDetails>
                      <List dense>
                        {tab.fields?.map((field: any, fieldIndex: number) => (
                          <ListItem key={field.fieldName || fieldIndex} divider>
                            <ListItemText
                              primary={
                                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                  <Typography variant="body2" fontWeight="medium">
                                    {field.displayLabel}
                                  </Typography>
                                  {field.required && (
                                    <Chip label="Required" size="small" color="error" variant="outlined" />
                                  )}
                                </Box>
                              }
                              secondary={
                                <Box sx={{ display: "flex", gap: 1, mt: 0.5 }}>
                                  <Chip label={field.fieldType} size="small" variant="outlined" />
                                  <Typography variant="caption" color="text.secondary">
                                    {field.fieldName}
                                  </Typography>
                                  {field.dataSource && (
                                    <Chip label={`Source: ${field.dataSource}`} size="small" variant="outlined" />
                                  )}
                                </Box>
                              }
                            />
                          </ListItem>
                        ))}
                      </List>
                    </AccordionDetails>
                  </Accordion>
                ))
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {fieldsLoading ? "Loading field definitions..." : "No field definitions available"}
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
