"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import TabbedDocumentCreator from "@/containers/DocumentTemplates/components/TabbedDocumentCreator";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { toast } from "react-toastify";
import { useGetCustomers } from "@/containers/DocumentTemplates/hooks/useGetCustomers";
import { useGetProjects } from "@/containers/DocumentTemplates/hooks/useGetProjects";
import { useGetDeliveryOrders } from "@/containers/DocumentTemplates/hooks/useGetDeliveryOrders";

export default function page() {
  const params = useParams();
  const router = useRouter();
  const { type, documentId } = params;
  const { getToken } = useAuth();
  const { organization } = useOrganization();

  // Fetch data
  const { customers } = useGetCustomers();
  const { projects } = useGetProjects();
  const { deliveryOrders } = useGetDeliveryOrders();

  const handleSave = async (data: any) => {
    try {
      const token = await getToken();
      // Save invoice logic here
      const response = await request(`/documents/${documentId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });

      if (response.success) {
        toast.success("Invoice saved successfully!");
        router.push("/portal/invoices");
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

  return (
    <TabbedDocumentCreator
      documentType={type as any}
      documentId={documentId as string}
      onSave={handleSave}
      onPrint={handlePrint}
      customers={customersList}
      projects={projectsList}
      deliveryOrders={deliveryOrdersList}
    />
  );
}
