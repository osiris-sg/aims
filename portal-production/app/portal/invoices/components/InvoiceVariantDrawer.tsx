"use client";

import React, { useState, useEffect } from "react";
import {
  Drawer,
  Box,
  Typography,
  Button,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Avatar,
  CircularProgress,
  Alert,
  Divider,
  Chip,
} from "@mui/material";
import DescriptionIcon from "@mui/icons-material/Description";
import CloseIcon from "@mui/icons-material/Close";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";

interface InvoiceVariant {
  id: string;
  name: string;
  type: string; // The actual document type from DB (e.g., "INVOICE", "DOCUMENT", etc.)
  templateVariant: string;
  description?: string;
  isDefault?: boolean;
}

interface InvoiceVariantDrawerProps {
  open: boolean;
  onClose: () => void;
  onSelectVariant: (variant: InvoiceVariant) => void;
  selectedCustomer: {
    id: string;
    name: string;
  } | null;
}

export default function InvoiceVariantDrawer({
  open,
  onClose,
  onSelectVariant,
  selectedCustomer,
}: InvoiceVariantDrawerProps) {
  const [variants, setVariants] = useState<InvoiceVariant[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  // Fetch invoice templates/variants for the organization
  useEffect(() => {
    const fetchVariants = async () => {
      if (!open || !organizationId) return;

      setIsLoading(true);
      setError(null);

      try {
        const token = await getToken();
        if (!token) {
          setError("Authentication required");
          return;
        }

        // Fetch document templates using POST with organizationId
        const response = await request(
          {
            path: "/documentTemplates",
            method: "POST",
          },
          {
            organizationId,
            page: 1, // Required pagination parameter
            limit: 100, // Get all templates
            search: "", // Optional search parameter
            filters: {
              type: "INVOICE" // Filter for invoice templates only
            },
          },
          token
        );

        if (response.success && response.data) {
          // Access the docs array from the response
          const templates = response.data.docs || [];
          console.log("=== FETCHED TEMPLATES ===");
          console.log("All templates:", templates);

          // Filter for INVOICE type templates (additional check)
          const invoiceTemplates = templates.filter(
            (template: any) => template.type === "INVOICE"
          );
          console.log("Invoice templates:", invoiceTemplates);

          // Transform to our variant format
          const variantList = invoiceTemplates.map((template: any) => ({
            id: template.id,
            name: template.name || template.templateVariant || "Standard Invoice",
            type: template.type, // Store the actual document type from DB
            templateVariant: template.templateVariant || template.designName || "TI",
            description: template.description || "",
            isDefault: template.isDefault || false,
          }));
          console.log("Transformed variant list:", variantList);

          // If no templates exist, provide default options
          if (variantList.length === 0) {
            variantList.push(
              {
                id: "default-ti",
                name: "Tax Invoice",
                type: "INVOICE",
                templateVariant: "TI",
                description: "Standard tax invoice with GST",
                isDefault: true,
              },
              {
                id: "default-proforma",
                name: "Proforma Invoice",
                type: "INVOICE",
                templateVariant: "PI",
                description: "Preliminary invoice before delivery",
                isDefault: false,
              },
              {
                id: "default-commercial",
                name: "Commercial Invoice",
                type: "INVOICE",
                templateVariant: "CI",
                description: "Invoice for commercial transactions",
                isDefault: false,
              }
            );
          }

          setVariants(variantList);
        } else {
          setError(response.message || "Failed to fetch invoice templates");
        }
      } catch (err) {
        console.error("Error fetching invoice variants:", err);
        setError("Failed to load invoice templates");

        // Provide default options on error
        setVariants([
          {
            id: "default-ti",
            name: "Tax Invoice",
            type: "INVOICE",
            templateVariant: "TI",
            description: "Standard tax invoice with GST",
            isDefault: true,
          },
          {
            id: "default-proforma",
            name: "Proforma Invoice",
            type: "INVOICE",
            templateVariant: "PI",
            description: "Preliminary invoice before delivery",
            isDefault: false,
          },
          {
            id: "default-commercial",
            name: "Commercial Invoice",
            type: "INVOICE",
            templateVariant: "CI",
            description: "Invoice for commercial transactions",
            isDefault: false,
          }
        ]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchVariants();
  }, [open, getToken, organizationId]);

  const handleSelectVariant = (variant: InvoiceVariant) => {
    onSelectVariant(variant);
  };

  const handleClose = () => {
    onClose();
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={handleClose}
      PaperProps={{
        sx: {
          width: { xs: "100%", sm: 450 },
          maxWidth: "100vw",
        },
      }}
    >
      <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <Box
          sx={{
            p: 3,
            borderBottom: "1px solid",
            borderColor: "divider",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Box>
            <Typography variant="h6" component="h2">
              Select Invoice Type
            </Typography>
            {selectedCustomer && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                For: {selectedCustomer.name}
              </Typography>
            )}
          </Box>
          <Button onClick={handleClose} sx={{ minWidth: "auto", p: 1 }} color="inherit">
            <CloseIcon />
          </Button>
        </Box>

        {/* Content */}
        <Box sx={{ flex: 1, overflow: "hidden", p: 2 }}>
          {isLoading ? (
            <Box
              sx={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: "200px",
              }}
            >
              <CircularProgress />
            </Box>
          ) : error ? (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {error}
              <Typography variant="body2" sx={{ mt: 1 }}>
                Showing default invoice types
              </Typography>
            </Alert>
          ) : variants.length === 0 ? (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "200px",
                color: "text.secondary",
              }}
            >
              <DescriptionIcon sx={{ fontSize: "3rem", mb: 2, opacity: 0.5 }} />
              <Typography variant="body1">No invoice templates available</Typography>
            </Box>
          ) : (
            <List sx={{ overflow: "auto", height: "100%" }}>
              {variants.map((variant, index) => (
                <React.Fragment key={variant.id}>
                  <ListItem disablePadding>
                    <ListItemButton
                      onClick={() => handleSelectVariant(variant)}
                      sx={{
                        py: 2.5,
                        px: 2,
                        borderRadius: 2,
                        mb: 1,
                        border: "1px solid",
                        borderColor: "divider",
                        "&:hover": {
                          backgroundColor: "action.hover",
                          borderColor: "primary.main",
                        },
                      }}
                    >
                      <Box sx={{ display: "flex", alignItems: "flex-start", width: "100%", gap: 2 }}>
                        <Avatar
                          sx={{
                            bgcolor: variant.isDefault ? "primary.main" : "grey.400",
                            width: 48,
                            height: 48,
                          }}
                        >
                          <DescriptionIcon />
                        </Avatar>
                        <Box sx={{ flex: 1 }}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
                            <Typography variant="subtitle1" fontWeight="medium">
                              {variant.name}
                            </Typography>
                            {variant.isDefault && (
                              <Chip
                                label="Default"
                                size="small"
                                color="primary"
                                variant="outlined"
                                sx={{ height: 20 }}
                              />
                            )}
                          </Box>
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            Template: {variant.templateVariant}
                          </Typography>
                          {variant.description && (
                            <Typography variant="body2" color="text.secondary">
                              {variant.description}
                            </Typography>
                          )}
                        </Box>
                        <CheckCircleIcon
                          sx={{
                            color: "action.disabled",
                            fontSize: 20,
                            ".MuiListItemButton-root:hover &": {
                              color: "primary.main",
                            },
                          }}
                        />
                      </Box>
                    </ListItemButton>
                  </ListItem>
                </React.Fragment>
              ))}
            </List>
          )}
        </Box>

        {/* Footer */}
        <Box
          sx={{
            p: 2,
            borderTop: "1px solid",
            borderColor: "divider",
            backgroundColor: "background.paper",
          }}
        >
          <Typography variant="body2" color="text.secondary" textAlign="center">
            Choose an invoice template to continue
          </Typography>
        </Box>
      </Box>
    </Drawer>
  );
}