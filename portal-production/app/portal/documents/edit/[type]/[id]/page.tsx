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

export default function EditDocumentPage() {
  const params = useParams();
  const router = useRouter();
  const { type, id } = params;
  const { getToken } = useAuth();
  const { organization } = useOrganization();

  // Fetch data
  const { customers } = useGetCustomers();
  const { projects } = useGetProjects();
  const { deliveryOrders } = useGetDeliveryOrders(); // Will be filtered by customer when selected

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
      documentId={id as string}
      onSave={handleSave}
      onPrint={handlePrint}
      customers={customersList}
      projects={projectsList}
      deliveryOrders={deliveryOrdersList}
    />
  );
}
