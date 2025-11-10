"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import TabbedDocumentCreator from "@/containers/DocumentTemplates/components/TabbedDocumentCreator";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { toast } from "react-toastify";
import { useGetCustomers } from "@/app/portal/hooks/api";
import { useGetProjects } from "@/containers/DocumentTemplates/hooks/useGetProjects";
import { useGetDeliveryOrders } from "@/containers/DocumentTemplates/hooks/useGetDeliveryOrders";
import { useGetSiteOffices } from "@/containers/DocumentTemplates/hooks/useGetSiteOffices";

export default function page() {
  const params = useParams();
  const router = useRouter();
  const { type, documentId } = params;
  const { getToken } = useAuth();
  const { organization } = useOrganization();

  // Track selected customer for filtering
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [existingData, setExistingData] = useState<any>(null);
  const [documentMetadata, setDocumentMetadata] = useState<any>(null); // Store full document response
  const [loading, setLoading] = useState(true);

  // Fetch data
  const { customers = [] } = useGetCustomers({ limit: 1000 });
  const { projects } = useGetProjects(selectedCustomerId); // Filter by customer
  const { deliveryOrders } = useGetDeliveryOrders(selectedCustomerId); // Filter by customer
  const { siteOffices, fetchSiteOffices } = useGetSiteOffices();

  // Load existing document data
  useEffect(() => {
    const loadDocument = async () => {
      if (!documentId) return;

      try {
        const token = await getToken();
        if (!token) return;

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

          // Extract config data for the form
          const documentData = response.data.config || response.data;

          // Include the document status
          documentData.status = response.data.status;

          setExistingData(documentData);

          // Set customer ID if available for filtering
          if (documentData.customer?.id) {
            setSelectedCustomerId(documentData.customer.id);
          } else if (response.data.customerId) {
            // Fallback to customerId field
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
  }, [documentId, getToken]);

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
        status: data.status || documentMetadata?.status || 'draft', // Use provided status, then existing, then default
        customerId: data.customer?.id,
        projectId: data.project?.id,
        documentTemplateId: documentMetadata?.documentTemplateId,
      };

      console.log('Saving document with payload:', updatePayload);

      // Save invoice using correct request helper syntax and endpoint
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
        router.push("/portal/invoices");
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

  // Show loading state while fetching document
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <p>Loading document...</p>
      </div>
    );
  }

  return (
    <TabbedDocumentCreator
      documentType={type as any}
      documentId={documentId as string}
      onSave={handleSave}
      onPrint={handlePrint}
      existingData={existingData}
      customers={customersList}
      projects={projectsList}
      deliveryOrders={deliveryOrdersList}
      siteOffices={siteOfficesList}
      onCustomerChange={handleCustomerChange}
      organization={organization}
    />
  );
}
