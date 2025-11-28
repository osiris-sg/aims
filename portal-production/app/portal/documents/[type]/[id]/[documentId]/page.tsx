"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Box, CircularProgress } from "@mui/material";
import TabbedDocumentCreator from "@/containers/DocumentTemplates/components/TabbedDocumentCreator";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { toast } from "react-toastify";
import { useGetCustomers } from "@/app/portal/hooks/api";
import { useGetProjects } from "@/containers/DocumentTemplates/hooks/useGetProjects";
import { useGetDeliveryOrders } from "@/containers/DocumentTemplates/hooks/useGetDeliveryOrders";
import { useGetSiteOffices } from "@/containers/DocumentTemplates/hooks/useGetSiteOffices";
import { getTemplateFields } from "@/containers/DocumentTemplates/config/templateFieldDefinitions";
import {
  transformFormDataForBackend,
  transformBackendDataForForm
} from "@/containers/DocumentTemplates/utils/documentDataTransformer";

export default function page() {
  const params = useParams();
  const router = useRouter();
  const { type, documentId } = params;
  const { getToken } = useAuth();
  const { organization } = useOrganization();

  // Track selected customer for filtering
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [existingData, setExistingData] = useState<any>(null);
  const [documentMetadata, setDocumentMetadata] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

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

          // Get field definitions for the template variant
          const fieldConfig = getTemplateFields(templateVariant);
          console.log("Field config for variant:", fieldConfig);

          // Transform flat backend data to nested structure for form
          const documentData = transformBackendDataForForm(config, fieldConfig);

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

  const handleSave = async (data: any) => {
    console.log("handleSave - Received data from TabbedDocumentCreator:", data);
    console.log("handleSave - Items in received data:", JSON.stringify(data.items, null, 2));

    try {
      const token = await getToken();
      if (!token) {
        toast.error("Authentication required");
        return;
      }

      // Get field definitions for the template variant
      const templateVariant = documentMetadata?.variant || type;
      const fieldConfig = getTemplateFields(templateVariant);

      console.log("handleSave - Before transform - data.items:", data.items);
      // Transform form data dynamically based on field definitions
      const configData = transformFormDataForBackend(data, fieldConfig, organization);
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
        toast.success("Document saved successfully!");
        // Navigate back to document list page
        router.push("/portal/documents");
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
    name: customer.name,
    address: customer.address || "",
    phone: customer.phone || "",
    email: customer.email || "",
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
  const templateVariant = documentMetadata?.variant || existingData?.variant || type;

  console.log("=== TEMPLATE VARIANT SELECTION ===");
  console.log("documentMetadata:", documentMetadata);
  console.log("documentMetadata?.variant:", documentMetadata?.variant);
  console.log("existingData?.variant:", existingData?.variant);
  console.log("type from URL:", type);
  console.log("Final templateVariant being passed to TabbedDocumentCreator:", templateVariant);

  return (
    <TabbedDocumentCreator
      documentType={templateVariant as any}
      documentId={documentId as string}
      existingData={existingData}
      onSave={handleSave}
      onPrint={handlePrint}
      customers={customersList}
      projects={projectsList}
      deliveryOrders={deliveryOrdersList}
      siteOffices={siteOfficesList}
      onCustomerChange={handleCustomerChange}
      organization={organization}
    />
  );
}
