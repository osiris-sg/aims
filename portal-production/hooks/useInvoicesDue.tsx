"use client";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import moment from "moment";

interface Invoice {
  id: string;
  name: string;
  dueDate: string;
  customerName?: string;
}

interface InvoicesDueData {
  totalDue: number;
  urgentInvoices: Invoice[];
}

const API = {
  GET_INVOICES_DUE: {
    path: "/dashboard/invoices-due",
    method: "GET",
  },
};

export default function useInvoicesDue() {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  const [invoicesData, setInvoicesData] = useState<InvoicesDueData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInvoicesDue = useCallback(async () => {
    if (!organizationId) return;

    setLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) return;

      // Fetch invoices due data
      const response = await request(API.GET_INVOICES_DUE, {}, token);

      if (response.success && response.data) {
        setInvoicesData(response.data);
      } else {
        setError(response.message || "Failed to fetch invoices data");
      }
    } catch (err) {
      console.error("Error fetching invoices due:", err);
      setError("An error occurred while fetching invoices data");
    } finally {
      setLoading(false);
    }
  }, [organizationId, getToken]);

  useEffect(() => {
    fetchInvoicesDue();
  }, [fetchInvoicesDue]);

  return {
    invoicesData,
    loading,
    error,
    refetch: fetchInvoicesDue,
  };
}
