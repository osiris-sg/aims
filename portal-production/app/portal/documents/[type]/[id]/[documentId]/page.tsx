"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { Box, CircularProgress } from "@mui/material";
import TabbedDocumentCreator from "@/containers/DocumentTemplates/components/TabbedDocumentCreator";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { toast } from "react-toastify";
import { useGetCustomers, useGetDocuments } from "@/app/portal/hooks/api";
import { useGetProjects } from "@/containers/DocumentTemplates/hooks/useGetProjects";
import { useGetDeliveryOrders } from "@/containers/DocumentTemplates/hooks/useGetDeliveryOrders";
import { useGetSiteOffices } from "@/containers/DocumentTemplates/hooks/useGetSiteOffices";
import { useGetSalesmen } from "@/containers/DocumentTemplates/hooks/useGetSalesmen";
import { getTemplateFormFields, TemplateFieldConfig } from "@/containers/DocumentTemplates/utils/templateFieldSync";
import {
  transformFormDataForBackend,
  transformBackendDataForForm
} from "@/containers/DocumentTemplates/utils/documentDataTransformer";

export default function page() {
  const params = useParams();
  const router = useRouter();
  const { type, id, documentId } = params;
  const { getToken } = useAuth();
  const { organization } = useOrganization();

  // Track selected customer for filtering
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [existingData, setExistingData] = useState<any>(null);
  const [documentMetadata, setDocumentMetadata] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fieldConfig, setFieldConfig] = useState<TemplateFieldConfig | null>(null);

  // Fetch all documents for navigation
  const { documents: allDocuments = [] } = useGetDocuments({});

  // Filter documents by the same template and sort by creation date (newest first)
  // The 'id' in the URL is the documentTemplateId
  // Backend returns 'templateId' field for each document
  const filteredDocuments = useMemo(() => {
    if (!allDocuments.length || !id) return [];

    // Filter documents that use the same document template
    // Backend returns templateId (not documentTemplateId)
    return allDocuments
      .filter((doc: any) => doc.templateId === id)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [allDocuments, id]);

  // Find current document index and calculate navigation
  const currentIndex = useMemo(() => {
    if (!filteredDocuments.length || !documentId) return -1;
    return filteredDocuments.findIndex((doc: any) => doc.id === documentId);
  }, [filteredDocuments, documentId]);

  // Documents are sorted newest-first, so:
  // - "Previous" goes to older documents (higher index)
  // - "Next" goes to newer documents (lower index)
  const hasPrevious = currentIndex >= 0 && currentIndex < filteredDocuments.length - 1;
  const hasNext = currentIndex > 0;

  // Navigation handlers
  const handlePrevious = useCallback(() => {
    // Go to older document (higher index in newest-first array)
    if (hasPrevious && filteredDocuments[currentIndex + 1]) {
      const prevDoc = filteredDocuments[currentIndex + 1];
      router.push(`/portal/documents/${type}/${id}/${prevDoc.id}`);
    }
  }, [hasPrevious, filteredDocuments, currentIndex, router, type, id]);

  const handleNext = useCallback(() => {
    // Go to newer document (lower index in newest-first array)
    if (hasNext && filteredDocuments[currentIndex - 1]) {
      const nextDoc = filteredDocuments[currentIndex - 1];
      router.push(`/portal/documents/${type}/${id}/${nextDoc.id}`);
    }
  }, [hasNext, filteredDocuments, currentIndex, router, type, id]);

  // Fetch existing document data
  useEffect(() => {
    console.log("=== FETCH DOCUMENT EFFECT TRIGGERED ===");
    console.log("documentId:", documentId);
    console.log("type:", type);
    console.log("All params:", params);

    const fetchDocument = async () => {
      try {
        const token = await getToken();
        console.log("Token obtained:", !!token);
        if (!token) {
          console.log("No token, returning early");
          setIsLoading(false);
          return;
        }

        const url = `/documents/${documentId}`;
        console.log("Fetching document from URL:", url);

        const response = await request(
          {
            path: url,
            method: "GET",
          },
          {},
          token
        );

        console.log("Document API Response:", response);
        console.log("Document Data:", response.data);
        console.log("Response success:", response.success);

        if (response.success && response.data) {
          // Store full document metadata
          setDocumentMetadata(response.data);

          // Fetch the document template to get the variant
          let templateVariant = Array.isArray(type) ? type[0] : type; // Default to type from URL

          if (response.data.documentTemplateId) {
            try {
              console.log("Fetching template with ID:", response.data.documentTemplateId);
              const templateResponse = await request(
                {
                  path: `/documentTemplates/${response.data.documentTemplateId}`,
                  method: "GET",
                },
                {},
                token
              );

              console.log("Template Response:", templateResponse);
              console.log("Template Data:", templateResponse.data);

              if (templateResponse.success && templateResponse.data) {
                // Store variant from template
                templateVariant = templateResponse.data.templateVariant || templateResponse.data.designName || "TI";
                setDocumentMetadata((prev: any) => ({
                  ...prev,
                  variant: templateVariant,
                  actualDocumentType: templateResponse.data.type, // Store the actual document type (INVOICE, QUOTATION, etc.)
                }));
                console.log("Template variant set to:", templateVariant);
                console.log("Template full data:", {
                  id: templateResponse.data.id,
                  type: templateResponse.data.type,
                  templateVariant: templateResponse.data.templateVariant,
                  designName: templateResponse.data.designName,
                });
              }
            } catch (error) {
              console.error("Error fetching template:", error);
            }
          }

          // Extract config data and transform for form display
          const config = response.data.config || {};

          console.log("Raw config from database:", config);
          console.log("Template variant being used:", templateVariant);

          // Get field definitions for the template from API
          const templateId = response.data.documentTemplateId;
          const fetchedFieldConfig = await getTemplateFormFields(templateVariant, templateId, token);
          console.log("Field config for variant:", fetchedFieldConfig);
          setFieldConfig(fetchedFieldConfig);

          // Transform flat backend data to nested structure for form
          const documentData = transformBackendDataForForm(config, fetchedFieldConfig);

          // Ensure document name is set
          documentData.name = response.data.name;
          documentData.documentNumber = response.data.name;

          // Include the document status
          documentData.status = response.data.status;

          console.log("Transformed document data:", documentData);
          console.log("documentInfo after transform:", documentData.documentInfo);
          console.log("Document status:", response.data.status);

          setExistingData(documentData);

          console.log("Document name from DB:", response.data?.name);
          console.log("Extracted form data:", documentData);

          // Set the selected customer ID if document has one
          if (config.customerId) {
            setSelectedCustomerId(config.customerId);
          } else if (response.data.customerId) {
            setSelectedCustomerId(response.data.customerId);
          }
        } else {
          console.error("Response was not successful:", response);
        }
      } catch (error) {
        console.error("Error fetching document:", error);
        toast.error("Failed to load document");
      } finally {
        console.log("Setting isLoading to false");
        setIsLoading(false);
      }
    };

    if (documentId) {
      console.log("documentId exists, calling fetchDocument");
      fetchDocument();
    } else {
      console.log("No documentId, setting isLoading to false");
      setIsLoading(false);
    }
  }, [documentId, getToken]);

  // Fetch data
  const { customers = [] } = useGetCustomers({ limit: 1000 });
  const { projects } = useGetProjects(selectedCustomerId); // Filter by customer
  const { deliveryOrders } = useGetDeliveryOrders(selectedCustomerId); // Filter by customer
  const { siteOffices, fetchSiteOffices } = useGetSiteOffices();
  const { salesmen } = useGetSalesmen();

  const handleSave = async (data: any) => {
    console.log("handleSave - Received data from TabbedDocumentCreator:", data);
    console.log("handleSave - Items in received data:", JSON.stringify(data.items, null, 2));

    try {
      const token = await getToken();
      if (!token) {
        toast.error("Authentication required");
        return;
      }

      // Use the field config that was loaded when the document was fetched
      // If not available, fetch it now
      let currentFieldConfig = fieldConfig;
      if (!currentFieldConfig) {
        const urlTypeForSave = Array.isArray(type) ? type[0] : type;
        const quotationTypesForSave = ["QUOTATION", "QT", "QO"];
        const templateVariant = quotationTypesForSave.includes(urlTypeForSave?.toUpperCase() || "")
          ? urlTypeForSave
          : (documentMetadata?.variant || type);
        const templateId = documentMetadata?.documentTemplateId || params.id as string;
        currentFieldConfig = await getTemplateFormFields(templateVariant, templateId, token);
      }

      console.log("handleSave - Before transform - data.items:", data.items);
      // Transform form data dynamically based on field definitions
      const configData = transformFormDataForBackend(data, currentFieldConfig, organization);
      console.log("handleSave - After transform - configData:", configData);
      console.log("handleSave - After transform - configData.items:", JSON.stringify(configData.items, null, 2));

      // Prepare update payload with transformed config
      const updatePayload = {
        id: documentId as string,
        type: type as string,
        config: configData,
        status: data.status || 'draft', // Use provided status or default to draft
        customerId: data.customer?.id || null,
        projectId: data.project?.id || data.projectId || null,
        documentTemplateId: documentMetadata?.documentTemplateId || params.id as string,
        name: data.name || data.documentInfo?.documentNumber || documentMetadata?.name,
      };

      console.log('Saving document with payload:', updatePayload);

      // Save document using correct endpoint
      const response = await request(
        {
          path: `/documents/update`,
          method: "POST",
        },
        updatePayload,
        token
      );

      if (response.success) {
        // Don't show toast or navigate here - let the caller handle it
        // (e.g., handleConfirmDocument will refresh the page)
        return;
      } else {
        console.error("Save failed - Full response:", response);
        console.error("Save failed - Data sent:", updatePayload);
        toast.error(response.message || "Failed to save document");
      }
    } catch (error: any) {
      console.error("Error saving document - Full error:", error);
      console.error("Error response data:", error?.response?.data);
      toast.error("Failed to save document");
    }
  };

  const handlePrint = () => {
    window.print();
  };

  // Format data for the component
  const customersList = customers?.map((customer: any) => ({
    id: customer.id,
    customerCode: customer.customerCode || "",
    name: customer.name,
    address: customer.address || "",
    phone: customer.phone || "",
    email: customer.email || "",
    salesman: customer.salesman || null,
  })) || [];

  const projectsList = projects?.map((project: any) => ({
    id: project.id,
    name: project.name,
    customerId: project.customerId,
  })) || [];

  const deliveryOrdersList = deliveryOrders?.map((order: any) => ({
    id: order.id,
    doNo: order.doNo || order.name,
    customerId: order.customerId,
  })) || [];

  const siteOfficesList = siteOffices?.map((office: any) => ({
    id: office.id,
    name: office.name,
    address: office.address || "",
  })) || [];

  // Handle customer change to fetch related data
  const handleCustomerChange = (customerId: string) => {
    setSelectedCustomerId(customerId);
    if (customerId) {
      fetchSiteOffices(customerId);
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  // Determine the template variant to use
  // Priority: document's stored variant > template variant from documentTemplate > URL type
  // Special handling: if URL type is QUOTATION/QT/QO but variant is different, prefer URL type
  let templateVariant = documentMetadata?.variant || existingData?.variant || type;

  // For quotation types, prefer the URL type to ensure correct template is used
  const urlType = Array.isArray(type) ? type[0] : type;
  const quotationTypes = ["QUOTATION", "QT", "QO"];
  if (quotationTypes.includes(urlType?.toUpperCase() || "")) {
    templateVariant = urlType;
  }

  console.log("=== TEMPLATE VARIANT SELECTION ===");
  console.log("documentMetadata:", documentMetadata);
  console.log("documentMetadata?.variant:", documentMetadata?.variant);
  console.log("existingData?.variant:", existingData?.variant);
  console.log("type from URL:", type);
  console.log("Final templateVariant being passed to TabbedDocumentCreator:", templateVariant);

  // Get actual document type (INVOICE, QUOTATION, etc.) for creating new documents
  // Priority: actualDocumentType from template > document's own type field > existingData type > URL type
  const actualDocumentType = documentMetadata?.actualDocumentType || documentMetadata?.type || existingData?.type || type;

  console.log("=== ACTUAL DOCUMENT TYPE SELECTION ===");
  console.log("documentMetadata?.actualDocumentType:", documentMetadata?.actualDocumentType);
  console.log("documentMetadata?.type:", documentMetadata?.type);
  console.log("existingData?.type:", existingData?.type);
  console.log("type from URL:", type);
  console.log("Final actualDocumentType:", actualDocumentType);

  return (
    <TabbedDocumentCreator
      documentType={templateVariant as any}
      actualDocumentType={actualDocumentType as string}
      documentId={documentId as string}
      templateId={documentMetadata?.documentTemplateId || id as string}
      existingData={existingData}
      onSave={handleSave}
      onPrint={handlePrint}
      customers={customersList}
      projects={projectsList}
      deliveryOrders={deliveryOrdersList}
      siteOffices={siteOfficesList}
      salesmen={salesmen}
      onCustomerChange={handleCustomerChange}
      organization={organization}
      onPrevious={handlePrevious}
      onNext={handleNext}
      hasPrevious={hasPrevious}
      hasNext={hasNext}
    />
  );
}
