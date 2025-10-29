"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Box, CircularProgress } from "@mui/material";
import TabbedDocumentCreator from "@/containers/DocumentTemplates/components/TabbedDocumentCreator";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { toast } from "react-toastify";
import { useGetCustomers } from "@/containers/DocumentTemplates/hooks/useGetCustomers";
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
  const [documentData, setDocumentData] = useState<any>(null);
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

        if (response.success) {
          console.log("Setting document data...");
          setDocumentData(response.data);
          console.log("Document name from DB:", response.data?.name);
          // Set the selected customer ID if document has one
          if (response.data?.customerId) {
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
  const { customers } = useGetCustomers();
  const { projects } = useGetProjects(selectedCustomerId); // Filter by customer
  const { deliveryOrders } = useGetDeliveryOrders(selectedCustomerId); // Filter by customer
  const { siteOffices, fetchSiteOffices } = useGetSiteOffices();

  const handleSave = async (data: any) => {
    try {
      const token = await getToken();
      if (!token) return;

      // Format data according to UpdateDocumentDto structure
      const updatePayload = {
        id: documentId as string,
        type: type as string, // Required field from URL params
        documentTemplateId: params.id as string, // The template ID from URL
        customerId: data.customer?.id || null,
        projectId: data.projectId || null,
        status: "draft", // Set status to draft
        config: {
          company: {
            // Use organization settings as the source of truth for company info
            name: data.company?.name || organization?.name || "Company Name", // Required field
            address: data.company?.address || organization?.address || "",
            phoneNumber: data.company?.phoneNumber || organization?.phoneNumber || "",
          },
          customerId: data.customer?.id,
          items: data.items || [],
          attention: {
            name: data.deliveryAddress?.attention,
            phoneNumber: data.deliveryAddress?.phone,
          },
          date: data.documentInfo?.date,
          referenceNo: data.documentInfo?.referenceNo,
          poNo: data.documentInfo?.poNo,
          doNo: data.documentInfo?.doNo,
          returnOrderNo: data.documentInfo?.returnOrderNo,
          gstRegNo: data.company?.gstRegNo || organization?.registrationNumber,
          note: data.note,
          dueDate: data.dueDate,
          deliveryTo: data.deliveryTo || data.deliveryAddress?.address,
          collectFrom: data.collectFrom,
        },
        name: data.name || data.documentInfo?.documentNumber, // Save the document name
      };

      // Save document logic here - backend uses POST /documents/update
      const response = await request(
        {
          path: `/documents/update`,
          method: "POST",
        },
        updatePayload,
        token
      );

      if (response.success) {
        toast.success("Document saved as draft!");
        // Navigate back to document list page
        router.push("/portal/documents");
      } else {
        toast.error(response.message || "Failed to save document");
      }
    } catch (error) {
      toast.error("Failed to save document");
      console.error("Error saving document:", error);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  // Format data for the component
  const customersList = customers?.docs?.map((customer: any) => ({
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

  return (
    <TabbedDocumentCreator
      documentType={type as any}
      documentId={documentId as string}
      existingData={documentData}
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
