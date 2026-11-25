"use client";

import React, { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { Box, CircularProgress } from "@mui/material";
import TabbedDocumentCreator from "@/containers/DocumentTemplates/components/TabbedDocumentCreator";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { failureLine, failureText, requestFailed } from "@/helpers/requestOutcome";
import LoadErrorAlert from "@/components/LoadErrorAlert";
import { useGetSuppliers } from "@/app/portal/hooks/api";
import { useCustomerPool } from "@/app/portal/hooks/api/useCustomerPicker";
import { useGetProjects } from "@/containers/DocumentTemplates/hooks/useGetProjects";
import { useGetDeliveryOrders } from "@/containers/DocumentTemplates/hooks/useGetDeliveryOrders";
import { useGetSiteOffices } from "@/containers/DocumentTemplates/hooks/useGetSiteOffices";
import { useGetSalesmen } from "@/containers/DocumentTemplates/hooks/useGetSalesmen";

export default function EditDocumentPage() {
  const params = useParams();
  const { type, id } = params;
  const { getToken } = useAuth();
  const { organization } = useOrganization();

  // Track selected customer for filtering
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [templateData, setTemplateData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch existing template data. (Round 16: this used to pass a URL string as request()'s first argument, so
  // every load and save failed and the page spun forever. Linked from the Document Templates list row and the
  // legacy QO1 "Save as new template".)
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // The template's config as last loaded / saved (a ref: re-rendering the editor with new data could reset it).
  const savedConfigRef = useRef<Record<string, unknown>>({});
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const token = await getToken();
        if (!token) return;
        const response = await request({ path: `/documentTemplates/${id}`, method: "GET", ownError: true }, {}, token);
        if (cancelled) return;
        if (requestFailed(response) || !response?.data?.id) {
          setLoadError(failureLine(response, "Could not load the template"));
          return;
        }
        savedConfigRef.current = response.data.config ?? {};
        setTemplateData(response.data);
      } catch (error: any) {
        if (!cancelled) setLoadError(error?.message || "Could not load the template");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, getToken, attempt]);

  // Fetch data
  // Customers: the document's own customer (by id) plus every customer the
  // pickers have seen. Never a capped "first N" list: orgs have thousands
  // (WCT ~4,000), and a capped list lost the selected customer.
  const customers = useCustomerPool([selectedCustomerId]);
  const { suppliers = [] } = useGetSuppliers({ limit: 1000 });
  const { projects } = useGetProjects(selectedCustomerId); // Filter by customer
  const { deliveryOrders } = useGetDeliveryOrders(selectedCustomerId); // Filter by customer
  const { siteOffices, fetchSiteOffices } = useGetSiteOffices();
  const { salesmen } = useGetSalesmen();

  // The template editor (TabbedDocumentCreator in template mode) saves { ...formData, config }. The API's
  // POST /documentTemplates/update REPLACES the template config with everything but id/name/type, so the saved
  // config is merged over the loaded one: settings this editor does not show are kept.
  // The editor's "Save Template" button says "Template saved" itself.
  const handleSave = async (data: any) => {
    const token = await getToken();
    const config = { ...savedConfigRef.current, ...(data?.config ?? {}) };
    const response = await request(
      { path: "/documentTemplates/update", method: "POST" },
      { ...config, id, name: templateData?.name, type: templateData?.type },
      token ?? undefined,
    );
    // A failure already shows the global error toast; `reported` stops the editor stacking its own on it.
    if (requestFailed(response)) throw Object.assign(new Error(failureText(response, "Could not save the template")), { reported: true });
    savedConfigRef.current = config;
    return response?.data ?? response;
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
    contacts: customer.contacts || [],
    // Master-file currency + GST no.: a typed code + Enter must set the
    // document's currency and rate exactly as the Locate dialog's pick does.
    currency: customer.currency || null,
    gstRegNo: customer.gstRegNo || "",
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

  if (loadError) {
    return (
      <Box sx={{ p: 3, width: "100%" }}>
        <LoadErrorAlert message={loadError} onRetry={() => setAttempt((n) => n + 1)} />
      </Box>
    );
  }

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", width: "100%", flex: 1, minHeight: "60vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  // Use template's variant if available, otherwise fall back to URL type
  const templateVariant = templateData?.templateVariant || templateData?.designName || type;

  return (
    <TabbedDocumentCreator
      documentType={templateVariant as any}
      documentId={id as string}
      templateId={id as string}
      existingData={templateData}
      onSave={handleSave}
      onPrint={handlePrint}
      customers={customersList}
      suppliers={suppliers?.map((s: any) => ({ id: s.id, customerCode: s.supplierCode || "", supplierCode: s.supplierCode || "", name: s.name, address: s.address || "", phone: s.phone || "", email: s.email || "" })) || []}
      projects={projectsList}
      deliveryOrders={deliveryOrdersList}
      siteOffices={siteOfficesList}
      salesmen={salesmen}
      onCustomerChange={handleCustomerChange}
      organization={organization}
    />
  );
}
