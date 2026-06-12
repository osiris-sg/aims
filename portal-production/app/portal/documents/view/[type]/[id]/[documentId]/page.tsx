"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Box, CircularProgress } from "@mui/material";
import TabbedDocumentCreator from "@/containers/DocumentTemplates/components/TabbedDocumentCreator";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { useGetCustomers, useGetSuppliers } from "@/app/portal/hooks/api";
import { useGetProjects } from "@/containers/DocumentTemplates/hooks/useGetProjects";
import { useGetDeliveryOrders } from "@/containers/DocumentTemplates/hooks/useGetDeliveryOrders";
import { useGetSiteOffices } from "@/containers/DocumentTemplates/hooks/useGetSiteOffices";
import { useGetSalesmen } from "@/containers/DocumentTemplates/hooks/useGetSalesmen";
import { getTemplateFormFields, TemplateFieldConfig } from "@/containers/DocumentTemplates/utils/templateFieldSync";
import { transformBackendDataForForm } from "@/containers/DocumentTemplates/utils/documentDataTransformer";

export default function ViewDocumentPage() {
  const params = useParams();
  const { type, id, documentId } = params;
  const { getToken } = useAuth();
  const { organization } = useOrganization();

  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [existingData, setExistingData] = useState<any>(null);
  const [documentMetadata, setDocumentMetadata] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fieldConfig, setFieldConfig] = useState<TemplateFieldConfig | null>(null);

  const fetchDocumentData = useCallback(async () => {
    if (!documentId) {
      setIsLoading(false);
      return;
    }

    try {
      const token = await getToken();
      if (!token) {
        setIsLoading(false);
        return;
      }

      const response = await request(
        { path: `/documents/${documentId}`, method: "GET" },
        {},
        token
      );

      if (!response.success || !response.data) {
        setIsLoading(false);
        return;
      }

      let templateVariant = Array.isArray(type) ? type[0] : (type as string);
      let templateData = null;

      // Fetch template to get the correct variant
      if (response.data.documentTemplateId) {
        try {
          const templateResponse = await request(
            { path: `/documentTemplates/${response.data.documentTemplateId}`, method: "GET" },
            {},
            token
          );
          if (templateResponse.success && templateResponse.data) {
            templateData = templateResponse.data;
          }
        } catch (error) {
          console.error("Error fetching template:", error);
        }

        if (templateData) {
          templateVariant = templateData.templateVariant || templateData.designName || templateVariant;
        }
      }

      // Get field definitions
      const templateId = response.data.documentTemplateId;
      const fetchedFieldConfig = await getTemplateFormFields(templateVariant, templateId, token);
      setFieldConfig(fetchedFieldConfig);

      // Transform data
      const config = response.data.config || {};
      const documentData = transformBackendDataForForm(config, fetchedFieldConfig);
      documentData.name = response.data.name;
      documentData.documentNumber = response.data.name;
      documentData.status = response.data.status;
      // Forward linked field-tech delivery reports so the DO preview/print can
      // render the Proof of Delivery section (see CleanDocumentPreview DO block).
      documentData.maintenanceReports = response.data.maintenanceReports;

      setExistingData(documentData);
      setSelectedCustomerId(config.customerId || response.data.customerId || "");
      setDocumentMetadata({
        ...response.data,
        variant: templateVariant,
        actualDocumentType: templateData?.type,
      });
    } catch (error) {
      console.error("Error loading document:", error);
    } finally {
      setIsLoading(false);
    }
  }, [documentId, getToken, type]);

  useEffect(() => {
    fetchDocumentData();
  }, [fetchDocumentData]);

  // Fetch related data
  const { customers = [] } = useGetCustomers({ limit: 1000 });
  const { suppliers = [] } = useGetSuppliers({ limit: 1000 });
  const { projects } = useGetProjects(selectedCustomerId);
  const { deliveryOrders } = useGetDeliveryOrders(selectedCustomerId);
  const { siteOffices, fetchSiteOffices } = useGetSiteOffices();
  const { salesmen } = useGetSalesmen();

  const handleCustomerChange = (customerId: string) => {
    setSelectedCustomerId(customerId);
    if (customerId) {
      fetchSiteOffices(customerId);
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", width: "100%", flex: 1, minHeight: "60vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  // Determine template variant
  let templateVariant = documentMetadata?.variant || existingData?.variant || type;
  const urlType = Array.isArray(type) ? type[0] : (type as string);
  const quotationTypes = ["QUOTATION", "QT", "QO"];
  if (quotationTypes.includes(urlType?.toUpperCase() || "")) {
    templateVariant = urlType;
  }

  const actualDocumentType = documentMetadata?.actualDocumentType || documentMetadata?.type || existingData?.type || type;

  const customersList = customers?.map((customer: any) => ({
    id: customer.id,
    customerCode: customer.customerCode || "",
    name: customer.name,
    address: customer.address || "",
    phone: customer.phone || "",
    email: customer.email || "",
    gstRegNo: customer.gstRegNo || "",
    salesman: customer.salesman || null,
    contacts: customer.contacts || [],
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

  return (
    <TabbedDocumentCreator
      documentType={templateVariant as any}
      actualDocumentType={actualDocumentType as string}
      documentId={documentId as string}
      templateId={documentMetadata?.documentTemplateId || (id as string)}
      existingData={existingData}
      customers={customersList}
      suppliers={suppliers?.map((s: any) => ({ id: s.id, customerCode: s.supplierCode || "", supplierCode: s.supplierCode || "", name: s.name, address: s.address || "", phone: s.phone || "", email: s.email || "" })) || []}
      projects={projectsList}
      deliveryOrders={deliveryOrdersList}
      siteOffices={siteOfficesList}
      salesmen={salesmen}
      onCustomerChange={handleCustomerChange}
      organization={organization}
      initialPreviewMode={true}
    />
  );
}
