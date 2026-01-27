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
import { useGetSalesmen } from "@/containers/DocumentTemplates/hooks/useGetSalesmen";

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
  const [loading, setLoading] = useState(true);

  // Fetch data
  const { customers = [] } = useGetCustomers({ limit: 1000 });
  const { projects } = useGetProjects(selectedCustomerId);
  const { deliveryOrders } = useGetDeliveryOrders(selectedCustomerId);
  const { siteOffices, fetchSiteOffices } = useGetSiteOffices();
  const { salesmen } = useGetSalesmen();

  // Load existing document data and fetch template for variant
  useEffect(() => {
    const loadDocument = async () => {
      if (!documentId) {
        setLoading(false);
        return;
      }

      try {
        const token = await getToken();
        if (!token) {
          setLoading(false);
          return;
        }

        // Fetch the document
        const response = await request(
          {
            path: `/documents/${documentId}`,
            method: "GET",
          },
          {},
          token
        );

        if (response.success && response.data) {
          // Store full document metadata
          setDocumentMetadata(response.data);

          // Fetch the document template to get the variant
          let templateVariant = type;
          if (response.data.documentTemplateId) {
            try {
              const templateResponse = await request(
                {
                  path: `/documentTemplates/${response.data.documentTemplateId}`,
                  method: "GET",
                },
                {},
                token
              );

              if (templateResponse.success && templateResponse.data) {
                templateVariant = templateResponse.data.templateVariant || templateResponse.data.designName || type;
                setDocumentMetadata((prev: any) => ({
                  ...prev,
                  variant: templateVariant,
                  actualDocumentType: templateResponse.data.type,
                }));
              }
            } catch (error) {
              console.error("Error fetching template:", error);
            }
          }

          // Extract config data for the form
          const documentData = response.data.config || response.data;

          // Include the document status and name
          documentData.status = response.data.status;
          documentData.name = response.data.name;
          documentData.documentNumber = response.data.name;

          setExistingData(documentData);

          // Set customer ID if available for filtering
          if (documentData.customerId) {
            setSelectedCustomerId(documentData.customerId);
          } else if (documentData.customer?.id) {
            setSelectedCustomerId(documentData.customer.id);
          } else if (response.data.customerId) {
            setSelectedCustomerId(response.data.customerId);
          }

          console.log('Loaded document data:', documentData);
        }
      } catch (error) {
        console.error("Error loading document:", error);
        toast.error("Failed to load document");
      } finally {
        setLoading(false);
      }
    };

    loadDocument();
  }, [documentId, getToken, type]);

  const handleSave = async (data: any) => {
    try {
      const token = await getToken();
      if (!token) {
        toast.error("Authentication required");
        return;
      }

      // Prepare update payload - data goes into config object
      const updatePayload = {
        id: documentId,
        type: type as string,
        config: data,
        status: data.status || documentMetadata?.status || 'draft',
        customerId: data.customer?.id || data.customerId || null,
        projectId: data.project?.id || data.projectId || null,
        documentTemplateId: documentMetadata?.documentTemplateId || id,
        name: data.name || data.documentInfo?.documentNumber || documentMetadata?.name,
      };

      console.log('Saving document with payload:', updatePayload);

      const response = await request(
        {
          path: `/documents/update`,
          method: "POST",
        },
        updatePayload,
        token
      );

      if (response.success) {
        toast.success("Invoice saved successfully!");
      } else {
        toast.error(response.message || "Failed to save invoice");
      }
    } catch (error) {
      toast.error("Failed to save invoice");
      console.error("Error saving invoice:", error);
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

  // Show loading state while fetching document
  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  // Determine the template variant to use
  // Priority: document's stored variant > template variant from documentTemplate > URL type
  const templateVariant = documentMetadata?.variant || existingData?.variant || type;

  // Get actual document type for creating new documents
  const actualDocumentType = documentMetadata?.actualDocumentType || documentMetadata?.type || existingData?.type || type;

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
    />
  );
}
