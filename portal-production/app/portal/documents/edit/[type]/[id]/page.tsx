"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Box, CircularProgress } from "@mui/material";
import TabbedDocumentCreator from "@/containers/DocumentTemplates/components/TabbedDocumentCreator";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { toast } from "react-toastify";
import { useGetCustomers, useGetSuppliers } from "@/app/portal/hooks/api";
import { useGetProjects } from "@/containers/DocumentTemplates/hooks/useGetProjects";
import { useGetDeliveryOrders } from "@/containers/DocumentTemplates/hooks/useGetDeliveryOrders";
import { useGetSiteOffices } from "@/containers/DocumentTemplates/hooks/useGetSiteOffices";
import { useGetSalesmen } from "@/containers/DocumentTemplates/hooks/useGetSalesmen";

export default function EditDocumentPage() {
  const params = useParams();
  const router = useRouter();
  const { type, id } = params;
  const { getToken } = useAuth();
  const { organization } = useOrganization();

  // Track selected customer for filtering
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [templateData, setTemplateData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch existing template data
  useEffect(() => {
    const fetchTemplate = async () => {
      try {
        const token = await getToken();
        if (!token) return;

        console.log("Fetching template from:", `/documentTemplates/${id}`);
        const response = await request(`/documentTemplates/${id}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        console.log("Template API Response:", response);
        console.log("Template Data:", response.data);
        console.log("Template name:", response.data?.name);

        if (response.success) {
          setTemplateData(response.data);
        } else {
          console.error("Failed to fetch template:", response);
        }
      } catch (error) {
        console.error("Error fetching template:", error);
        toast.error("Failed to load template");
      } finally {
        setIsLoading(false);
      }
    };

    if (id) {
      fetchTemplate();
    }
  }, [id, getToken]);

  // Fetch data
  const { customers = [] } = useGetCustomers({ limit: 1000 });
  const { suppliers = [] } = useGetSuppliers({ limit: 1000 });
  const { projects } = useGetProjects(selectedCustomerId); // Filter by customer
  const { deliveryOrders } = useGetDeliveryOrders(selectedCustomerId); // Filter by customer
  const { siteOffices, fetchSiteOffices } = useGetSiteOffices();
  const { salesmen } = useGetSalesmen();

  const handleSave = async (data: any) => {
    try {
      const token = await getToken();
      // Update document logic here
      const response = await request(`/documentTemplates/${id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });

      if (response.success) {
        toast.success("Document updated successfully!");
        router.push("/portal/documents/templates");
      }
    } catch (error) {
      toast.error("Failed to update document");
      console.error("Error updating document:", error);
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

  // Handle customer change to fetch related data
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
