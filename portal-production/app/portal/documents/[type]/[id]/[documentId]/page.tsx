"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Box, CircularProgress } from "@mui/material";
import TabbedDocumentCreator from "@/containers/DocumentTemplates/components/TabbedDocumentCreator";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { toast } from "react-toastify";
import { useGetCustomers, useGetSuppliers, useGetDocuments } from "@/app/portal/hooks/api";
import { useGetProjects } from "@/containers/DocumentTemplates/hooks/useGetProjects";
import { useGetDeliveryOrders } from "@/containers/DocumentTemplates/hooks/useGetDeliveryOrders";
import { useGetSiteOffices } from "@/containers/DocumentTemplates/hooks/useGetSiteOffices";
import { useGetSalesmen } from "@/containers/DocumentTemplates/hooks/useGetSalesmen";
import { getTemplateFormFields, TemplateFieldConfig } from "@/containers/DocumentTemplates/utils/templateFieldSync";
import {
  transformFormDataForBackend,
  transformBackendDataForForm
} from "@/containers/DocumentTemplates/utils/documentDataTransformer";

// Cache structure for prefetched documents
interface CachedDocument {
  existingData: any;
  documentMetadata: any;
  fieldConfig: TemplateFieldConfig | null;
  customerId: string;
}

// Global cache that persists across navigations (but resets on page refresh)
const documentCache = new Map<string, CachedDocument>();
const fetchingDocs = new Set<string>();
const templateCache = new Map<string, any>(); // Cache templates by ID

// Prefetch configuration
const PREFETCH_COUNT = 5; // How many documents to prefetch in each direction
const PREFETCH_THRESHOLD = 3; // When buffer drops to this, prefetch more
const MAX_CONCURRENT_FETCHES = 3; // Limit concurrent API calls
let activeFetches = 0; // Track active fetches

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
  const [isLoading, setIsLoading] = useState(true);
  const [fieldConfig, setFieldConfig] = useState<TemplateFieldConfig | null>(null);

  // Prevent rapid navigation clicks
  const isNavigatingRef = useRef(false);

  // Fetch all documents for navigation
  const { documents: allDocuments = [], refetch: refetchDocuments } = useGetDocuments({});

  // Filter documents by the same template and sort by creation date (newest first)
  const filteredDocuments = useMemo(() => {
    if (!allDocuments.length || !id) return [];
    return allDocuments
      .filter((doc: any) => doc.templateId === id)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [allDocuments, id]);

  // Find current document index and calculate navigation
  const currentIndex = useMemo(() => {
    if (!filteredDocuments.length || !documentId) return -1;
    return filteredDocuments.findIndex((doc: any) => doc.id === documentId);
  }, [filteredDocuments, documentId]);

  // Documents are sorted newest-first, so:
  // - "Previous" goes to older documents (higher index)
  // - "Next" goes to newer documents (lower index)
  const hasPrevious = currentIndex >= 0 && currentIndex < filteredDocuments.length - 1;
  const hasNext = currentIndex > 0;

  // Function to fetch and process a single document (used for both main load and prefetch)
  const fetchDocumentData = useCallback(async (docId: string, token: string, urlType: string | string[]): Promise<CachedDocument | null> => {
    try {
      const response = await request(
        { path: `/documents/${docId}`, method: "GET" },
        {},
        token
      );

      if (!response.success || !response.data) {
        return null;
      }

      let templateVariant = Array.isArray(urlType) ? urlType[0] : urlType;
      let templateData = null;

      // Fetch template (with caching)
      if (response.data.documentTemplateId) {
        const templateId = response.data.documentTemplateId;

        if (templateCache.has(templateId)) {
          templateData = templateCache.get(templateId);
        } else {
          try {
            const templateResponse = await request(
              { path: `/documentTemplates/${templateId}`, method: "GET" },
              {},
              token
            );
            if (templateResponse.success && templateResponse.data) {
              templateData = templateResponse.data;
              templateCache.set(templateId, templateData);
            }
          } catch (error) {
            console.error("Error fetching template:", error);
          }
        }

        if (templateData) {
          templateVariant = templateData.templateVariant || templateData.designName || "TI";
        }
      }

      // Get field definitions
      const templateId = response.data.documentTemplateId;
      const fetchedFieldConfig = await getTemplateFormFields(templateVariant, templateId, token);

      // Transform data
      const config = response.data.config || {};
      console.log("fetchDocumentData - config from backend:", config);
      console.log("fetchDocumentData - config.deliveryTo:", config.deliveryTo);
      console.log("fetchDocumentData - config.issueBy:", config.issueBy);
      const documentData = transformBackendDataForForm(config, fetchedFieldConfig);
      console.log("fetchDocumentData - documentData after transform:", documentData);
      console.log("fetchDocumentData - documentData.deliveryTo:", documentData.deliveryTo);
      documentData.name = response.data.name;
      documentData.documentNumber = response.data.name;
      documentData.status = response.data.status;
      // Forward linked field-tech delivery reports so the DO preview/print can
      // render the Proof of Delivery section (see CleanDocumentPreview DO block).
      documentData.maintenanceReports = response.data.maintenanceReports;

      // Column layout (tableColumnOrder / columnLabels / internalColumns) is a
      // template-level concern. Always take it from the template so it renders
      // correctly even for saved docs that never persisted the layout, and so
      // template layout changes propagate to existing documents.
      const tmplCfg = (templateData && (templateData as any).config) || {};
      if (Array.isArray(tmplCfg.tableColumnOrder) && tmplCfg.tableColumnOrder.length > 0) {
        documentData.tableColumnOrder = tmplCfg.tableColumnOrder;
        if (tmplCfg.columnLabels) documentData.columnLabels = tmplCfg.columnLabels;
        if (tmplCfg.internalColumns) documentData.internalColumns = tmplCfg.internalColumns;
      }

      // Build metadata
      const metadata = {
        ...response.data,
        variant: templateVariant,
        actualDocumentType: templateData?.type,
      };

      // Get customer ID
      const customerId = config.customerId || response.data.customerId || "";

      return {
        existingData: documentData,
        documentMetadata: metadata,
        fieldConfig: fetchedFieldConfig,
        customerId,
      };
    } catch (error) {
      console.error("Error fetching document:", docId, error);
      return null;
    }
  }, []);

  // Prefetch documents silently in the background with rate limiting
  const prefetchDocuments = useCallback(async (docIds: string[], token: string, urlType: string | string[]) => {
    for (const docId of docIds) {
      // Skip if already cached or being fetched
      if (documentCache.has(docId) || fetchingDocs.has(docId)) {
        continue;
      }

      // Wait if too many concurrent fetches
      if (activeFetches >= MAX_CONCURRENT_FETCHES) {
        continue; // Skip for now, will be picked up next time
      }

      // Mark as being fetched
      fetchingDocs.add(docId);
      activeFetches++;

      // Fetch in background (don't await, let it run silently)
      fetchDocumentData(docId, token, urlType)
        .then((result) => {
          if (result) {
            documentCache.set(docId, result);
            console.log(`Prefetched document: ${docId}`);
          }
        })
        .catch((error) => {
          console.error(`Failed to prefetch document: ${docId}`, error);
        })
        .finally(() => {
          fetchingDocs.delete(docId);
          activeFetches = Math.max(0, activeFetches - 1);
        });
    }
  }, [fetchDocumentData]);

  // Get document IDs to prefetch based on current position
  const getDocumentsToPrefetch = useCallback((direction: 'both' | 'previous' | 'next', count: number = PREFETCH_COUNT): string[] => {
    if (currentIndex < 0 || !filteredDocuments.length) return [];

    const docIds: string[] = [];

    if (direction === 'both' || direction === 'previous') {
      // Previous = older = higher index
      for (let i = 1; i <= count; i++) {
        const idx = currentIndex + i;
        if (idx < filteredDocuments.length) {
          docIds.push(filteredDocuments[idx].id);
        }
      }
    }

    if (direction === 'both' || direction === 'next') {
      // Next = newer = lower index
      for (let i = 1; i <= count; i++) {
        const idx = currentIndex - i;
        if (idx >= 0) {
          docIds.push(filteredDocuments[idx].id);
        }
      }
    }

    return docIds;
  }, [currentIndex, filteredDocuments]);

  // Check prefetch buffer and fetch more if needed
  const checkAndPrefetchMore = useCallback(async (direction: 'previous' | 'next') => {
    const token = await getToken();
    if (!token || currentIndex < 0) return;

    // Count how many documents are cached in the given direction
    let cachedCount = 0;
    const checkCount = PREFETCH_COUNT;

    if (direction === 'previous') {
      for (let i = 1; i <= checkCount; i++) {
        const idx = currentIndex + i;
        if (idx < filteredDocuments.length && documentCache.has(filteredDocuments[idx].id)) {
          cachedCount++;
        }
      }

      // If buffer is running low, prefetch more
      if (cachedCount <= PREFETCH_THRESHOLD) {
        const startIdx = currentIndex + cachedCount + 1;
        const docsToFetch: string[] = [];
        for (let i = 0; i < PREFETCH_COUNT; i++) {
          const idx = startIdx + i;
          if (idx < filteredDocuments.length) {
            docsToFetch.push(filteredDocuments[idx].id);
          }
        }
        if (docsToFetch.length > 0) {
          console.log(`Buffer low for previous, prefetching ${docsToFetch.length} more documents`);
          prefetchDocuments(docsToFetch, token, type as string);
        }
      }
    } else {
      for (let i = 1; i <= checkCount; i++) {
        const idx = currentIndex - i;
        if (idx >= 0 && documentCache.has(filteredDocuments[idx].id)) {
          cachedCount++;
        }
      }

      if (cachedCount <= PREFETCH_THRESHOLD) {
        const startIdx = currentIndex - cachedCount - 1;
        const docsToFetch: string[] = [];
        for (let i = 0; i < PREFETCH_COUNT; i++) {
          const idx = startIdx - i;
          if (idx >= 0) {
            docsToFetch.push(filteredDocuments[idx].id);
          }
        }
        if (docsToFetch.length > 0) {
          console.log(`Buffer low for next, prefetching ${docsToFetch.length} more documents`);
          prefetchDocuments(docsToFetch, token, type as string);
        }
      }
    }
  }, [currentIndex, filteredDocuments, getToken, prefetchDocuments, type]);

  // Navigation handlers with prefetch check and debounce
  const handlePrevious = useCallback(() => {
    // Prevent rapid clicks
    if (isNavigatingRef.current) return;

    if (hasPrevious && filteredDocuments[currentIndex + 1]) {
      isNavigatingRef.current = true;
      const prevDoc = filteredDocuments[currentIndex + 1];
      // Check buffer after navigation
      checkAndPrefetchMore('previous');
      router.push(`/portal/documents/${type}/${id}/${prevDoc.id}`);
      // Reset after a short delay
      setTimeout(() => { isNavigatingRef.current = false; }, 500);
    }
  }, [hasPrevious, filteredDocuments, currentIndex, router, type, id, checkAndPrefetchMore]);

  const handleNext = useCallback(() => {
    // Prevent rapid clicks
    if (isNavigatingRef.current) return;

    if (hasNext && filteredDocuments[currentIndex - 1]) {
      isNavigatingRef.current = true;
      const nextDoc = filteredDocuments[currentIndex - 1];
      // Check buffer after navigation
      checkAndPrefetchMore('next');
      router.push(`/portal/documents/${type}/${id}/${nextDoc.id}`);
      // Reset after a short delay
      setTimeout(() => { isNavigatingRef.current = false; }, 500);
    }
  }, [hasNext, filteredDocuments, currentIndex, router, type, id, checkAndPrefetchMore]);

  // Main fetch effect - checks cache first, then fetches if needed
  useEffect(() => {
    // Reset navigation lock when document changes
    isNavigatingRef.current = false;

    const loadDocument = async () => {
      if (!documentId) {
        setIsLoading(false);
        return;
      }

      const docIdStr = documentId as string;

      // Check cache first
      if (documentCache.has(docIdStr)) {
        console.log("Loading document from cache:", docIdStr);
        const cached = documentCache.get(docIdStr)!;
        setExistingData(cached.existingData);
        setDocumentMetadata(cached.documentMetadata);
        setFieldConfig(cached.fieldConfig);
        setSelectedCustomerId(cached.customerId);
        setIsLoading(false);
        return;
      }

      // Not in cache, fetch it
      try {
        const token = await getToken();
        if (!token) {
          setIsLoading(false);
          return;
        }

        console.log("Fetching document (not in cache):", docIdStr);
        const result = await fetchDocumentData(docIdStr, token, type as string);

        if (result) {
          // Store in cache
          documentCache.set(docIdStr, result);

          // Update state
          setExistingData(result.existingData);
          setDocumentMetadata(result.documentMetadata);
          setFieldConfig(result.fieldConfig);
          setSelectedCustomerId(result.customerId);
        } else {
          toast.error("Failed to load document");
        }
      } catch (error) {
        console.error("Error loading document:", error);
        toast.error("Failed to load document");
      } finally {
        setIsLoading(false);
      }
    };

    setIsLoading(true);
    loadDocument();
  }, [documentId, getToken, fetchDocumentData, type]);

  // Initial prefetch effect - runs when filteredDocuments and currentIndex are ready
  useEffect(() => {
    const doInitialPrefetch = async () => {
      if (currentIndex < 0 || !filteredDocuments.length) return;

      const token = await getToken();
      if (!token) return;

      // Get documents to prefetch in both directions
      const docsToPrefetch = getDocumentsToPrefetch('both', PREFETCH_COUNT);

      if (docsToPrefetch.length > 0) {
        console.log(`Initial prefetch: ${docsToPrefetch.length} documents`);
        prefetchDocuments(docsToPrefetch, token, type as string);
      }
    };

    doInitialPrefetch();
  }, [currentIndex, filteredDocuments, getToken, getDocumentsToPrefetch, prefetchDocuments, type]);

  // Fetch data
  const { customers = [] } = useGetCustomers({ limit: 1000 });
  const { suppliers = [] } = useGetSuppliers({ limit: 1000 });
  const { projects } = useGetProjects(selectedCustomerId); // Filter by customer
  const { deliveryOrders } = useGetDeliveryOrders(selectedCustomerId); // Filter by customer
  const { siteOffices, fetchSiteOffices } = useGetSiteOffices();
  const { salesmen } = useGetSalesmen();

  const handleSave = async (data: any) => {
    console.log("handleSave - Received data from TabbedDocumentCreator:", data);
    console.log("handleSave - deliveryTo in received data:", data.deliveryTo);
    console.log("handleSave - issueBy in received data:", data.issueBy, "documentInfo.issueBy:", data.documentInfo?.issueBy);
    console.log("handleSave - Items in received data:", JSON.stringify(data.items, null, 2));

    try {
      const token = await getToken();
      if (!token) {
        toast.error("Authentication required");
        return;
      }

      // Use the field config that was loaded when the document was fetched
      // If not available, fetch it now
      let currentFieldConfig = fieldConfig;
      if (!currentFieldConfig) {
        const urlTypeForSave = Array.isArray(type) ? type[0] : type;
        const quotationTypesForSave = ["QUOTATION", "QT", "QO"];
        const templateVariant = quotationTypesForSave.includes(urlTypeForSave?.toUpperCase() || "")
          ? urlTypeForSave
          : (documentMetadata?.variant || type);
        const templateId = documentMetadata?.documentTemplateId || params.id as string;
        currentFieldConfig = await getTemplateFormFields(templateVariant, templateId, token);
      }

      console.log("handleSave - Before transform - data.items:", data.items);
      // Transform form data dynamically based on field definitions
      const configData = transformFormDataForBackend(data, currentFieldConfig, organization);
      console.log("handleSave - After transform - configData:", configData);
      console.log("handleSave - After transform - configData.deliveryTo:", configData.deliveryTo);
      console.log("handleSave - After transform - configData.issueBy:", configData.issueBy);
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
        // Clear this document from cache so fresh data is loaded on next access
        documentCache.delete(documentId as string);
        console.log(`Cache cleared for document: ${documentId}`);
        // Don't show toast or navigate here - let the caller handle it
        // (e.g., handleConfirmDocument will refresh the page)
        return;
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

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", width: "100%", flex: 1, minHeight: "60vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  // Determine the template variant to use
  // Priority: document's stored variant > template variant from documentTemplate > URL type
  // Special handling: if URL type is QUOTATION/QT/QO but variant is different, prefer URL type
  let templateVariant = documentMetadata?.variant || existingData?.variant || type;

  // For quotation types, prefer the URL type to ensure correct template is used
  const urlType = Array.isArray(type) ? type[0] : type;
  const quotationTypes = ["QUOTATION", "QT", "QO"];
  if (quotationTypes.includes(urlType?.toUpperCase() || "")) {
    templateVariant = urlType;
  }

  console.log("=== TEMPLATE VARIANT SELECTION ===");
  console.log("documentMetadata:", documentMetadata);
  console.log("documentMetadata?.variant:", documentMetadata?.variant);
  console.log("existingData?.variant:", existingData?.variant);
  console.log("type from URL:", type);
  console.log("Final templateVariant being passed to TabbedDocumentCreator:", templateVariant);

  // Get actual document type (INVOICE, QUOTATION, etc.) for creating new documents
  // Priority: actualDocumentType from template > document's own type field > existingData type > URL type
  const actualDocumentType = documentMetadata?.actualDocumentType || documentMetadata?.type || existingData?.type || type;

  console.log("=== ACTUAL DOCUMENT TYPE SELECTION ===");
  console.log("documentMetadata?.actualDocumentType:", documentMetadata?.actualDocumentType);
  console.log("documentMetadata?.type:", documentMetadata?.type);
  console.log("existingData?.type:", existingData?.type);
  console.log("type from URL:", type);
  console.log("Final actualDocumentType:", actualDocumentType);

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
      suppliers={suppliers?.map((s: any) => ({ id: s.id, customerCode: s.supplierCode || "", supplierCode: s.supplierCode || "", name: s.name, address: s.address || "", phone: s.phone || "", email: s.email || "" })) || []}
      projects={projectsList}
      deliveryOrders={deliveryOrdersList}
      siteOffices={siteOfficesList}
      salesmen={salesmen}
      onCustomerChange={handleCustomerChange}
      organization={organization}
      onPrevious={handlePrevious}
      onNext={handleNext}
      hasPrevious={hasPrevious}
      hasNext={hasNext}
      onDocumentCreated={refetchDocuments}
    />
  );
}
