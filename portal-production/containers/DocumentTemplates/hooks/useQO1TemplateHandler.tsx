/* eslint-disable @typescript-eslint/no-explicit-any */
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { useDocumentTemplateSlice } from "@/containers/DocumentsTemplateView/slice";
import { useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { useDispatch, useSelector } from "react-redux";
import { selectDocumentTemplate, selectIsDocumentTemplateUpdating } from "@/containers/DocumentsTemplateView/slice/selectors";
import { useEffect, useMemo } from "react";

type TemplateConfig = {
  tableHeaders?: Record<string, boolean>;
  tableColumnOrder?: string[];
  columnLabels?: Record<string, string>;
  columnGroups?: Array<{ id: string; label: string; columns: string[] }>;
  defaultValues?: {
    title?: string;
    note?: string;
    remarks?: string;
    termsAndConditions?: string;
    agreementText?: string;
    signatureText?: {
      company?: string;
    };
  };
  [key: string]: any;
};

export default function useQO1TemplateHandler() {
  const { type } = useParams() as { type?: string };
  const dispatch = useDispatch();
  const { actions } = useDocumentTemplateSlice();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const isLoading = useSelector(selectIsDocumentTemplateUpdating);
  const documentTemplate = useSelector(selectDocumentTemplate);

  const defaultValues = useMemo(
    () => ({
      name: "Quotation 1",
      logo: true,
      type: type,
      company: { name: true, address: true, phoneNumber: true },
      customer: true,
      attention: { name: true, phoneNumber: true, email: true },
      deliveryTo: true,
      doNo: true,
      referenceNo: true,
      poNo: true,
      // Table header visibility and order
      tableHeaders: {
        no: true,
        item: true,
        unitRate: true,
      },
      tableColumnOrder: ["no", "item", "unitRate"],
      // Column labels for display
      columnLabels: {
        no: "No.",
        item: "Item",
        unitRate: "Unit Rate/Month",
      },
      // Optional multi-row header groups
      columnGroups: [],
      // Default field values that will be inherited by new documents
      defaultValues: {
        title: "",
        note: "",
        remarks: "",
        termsAndConditions: "",
        agreementText: "",
        signatureText: {
          company: "",
        },
      },
      // Show/hide toggles for default fields
      showDefaultTitle: true,
      showDefaultNote: true,
      showDefaultRemarks: true,
      showDefaultTermsAndConditions: true,
      showDefaultAgreementText: true,
      showDefaultSignatureText: true,
    }),
    [type]
  );
  const methods = useForm<any>({
    mode: "onChange",
    defaultValues: defaultValues,
  });

  const {
    handleSubmit,
    watch,
    reset,
    formState: { isDirty },
  } = methods;

  useEffect(() => {
    if (documentTemplate) {
      console.log("🔄 TEMPLATE HANDLER: Loading document template:", documentTemplate);
      const config = (documentTemplate?.config || {}) as TemplateConfig;
      console.log("🔄 TEMPLATE HANDLER: Document config:", config);
      console.log("🔄 TEMPLATE HANDLER: Existing columnLabels:", config?.columnLabels);

      // Merge with default values to ensure new fields are included
      const mergedConfig = {
        ...defaultValues,
        ...documentTemplate,
        ...(config || {}),
        // Ensure table configuration exists
        tableHeaders: {
          ...defaultValues.tableHeaders,
          ...(config?.tableHeaders || {}),
        },
        tableColumnOrder: config?.tableColumnOrder || defaultValues.tableColumnOrder,
        columnLabels: {
          ...defaultValues.columnLabels,
          ...(config?.columnLabels || {}),
        },
        columnGroups: config?.columnGroups || defaultValues.columnGroups,
        // Ensure default values configuration exists
        defaultValues: {
          ...defaultValues.defaultValues,
          ...(config?.defaultValues || {}),
        },
      };

      console.log("🔄 TEMPLATE HANDLER: Merged config:", mergedConfig);
      console.log("🔄 TEMPLATE HANDLER: Table headers:", mergedConfig.tableHeaders);
      console.log("🔄 TEMPLATE HANDLER: Column order:", mergedConfig.tableColumnOrder);
      console.log("🔄 TEMPLATE HANDLER: Final columnLabels:", mergedConfig.columnLabels);
      console.log("🔄 TEMPLATE HANDLER: Default values:", mergedConfig.defaultValues);

      reset(mergedConfig, {
        keepDirty: false, // ensure dirty state resets
        keepTouched: false,
        keepValues: false, // optional, depending on what you want
      });
    }
  }, [documentTemplate, reset, defaultValues]);

  const onSubmit = async (data: any) => {
    try {
      const token = await getToken();
      if (token) {
        console.log("🚀 TEMPLATE HANDLER: Saving template with data:", data);
        console.log("🚀 TEMPLATE HANDLER: Column labels being saved:", data.columnLabels);
        console.log("🚀 TEMPLATE HANDLER: Default values being saved:", data.defaultValues);
        dispatch(actions.updateDocumentTemplate({ ...data, token, organizationId: organization?.id }));
      }
    } catch (error) {
      console.error("Error submitting form:", error);
    }
  };

  const editableVisibilityFields = [
    {
      title: "Company fields",
      items: [
        { label: "Logo", name: "logo" },
        { label: "Company name", name: "company.name" },
        { label: "Address", name: "company.address" },
      ],
    },
    {
      title: "Document Fields",
      items: [
        { label: "DO No.", name: "doNo" },
        { label: "Ref No.", name: "referenceNo" },
        { label: "PO No.", name: "poNo" },
        { label: "Customer", name: "customer" },
        { label: "Mobile", name: "attention.phoneNumber" },
        { label: "Delivery To", name: "deliveryTo" },
      ],
    },
    {
      title: "Table Headers",
      items: [
        { label: "No.", name: "tableHeaders.no" },
        { label: "Item", name: "tableHeaders.item" },
        { label: "Unit Rate/Month", name: "tableHeaders.unitRate" },
      ],
    },
    {
      title: "Default Field Values",
      items: [
        { label: "Show Default Title", name: "showDefaultTitle" },
        { label: "Show Default Note", name: "showDefaultNote" },
        { label: "Show Default Remarks", name: "showDefaultRemarks" },
        { label: "Show Default Terms & Conditions", name: "showDefaultTermsAndConditions" },
        { label: "Show Default Closing Text", name: "showDefaultAgreementText" },
        { label: "Show Default Signature Text", name: "showDefaultSignatureText" },
      ],
    },
  ];

  const handleColumnReorder = (newOrder: string[]) => {
    methods.setValue("tableColumnOrder", newOrder, { shouldDirty: true });
  };

  const handleToggleColumnVisibility = (columnId: string, visible: boolean) => {
    const current = (methods.getValues("tableHeaders") || {}) as Record<string, boolean>;
    const next = { ...current, [columnId]: visible };
    methods.setValue("tableHeaders", next, { shouldDirty: true });
  };

  const handleEditLabel = (columnId: string, newLabel: string) => {
    console.log("🏷️ TEMPLATE HANDLER: Editing label for", columnId, "to", newLabel);
    methods.setValue(`columnLabels.${columnId}`, newLabel, { shouldDirty: true });
    console.log("🏷️ TEMPLATE HANDLER: Current columnLabels:", methods.getValues("columnLabels"));
  };

  const handleAddField = (fieldId: string, label: string) => {
    // Add to column order
    const currentOrder = methods.getValues("tableColumnOrder") || [];
    methods.setValue("tableColumnOrder", [...currentOrder, fieldId], { shouldDirty: true });

    // Set visibility to true
    methods.setValue(`tableHeaders.${fieldId}`, true, { shouldDirty: true });

    // Set label
    methods.setValue(`columnLabels.${fieldId}`, label, { shouldDirty: true });
  };

  const addColumnGroup = (label: string, columns: string[]) => {
    const id = `${label.replace(/\s+/g, "_").toLowerCase()}_${Date.now()}`;
    const currentGroups = methods.getValues("columnGroups") || [];
    const currentOrder: string[] = methods.getValues("tableColumnOrder") || [];
    const currentHeaders: Record<string, boolean> = methods.getValues("tableHeaders") || {};
    const currentLabels: Record<string, string> = methods.getValues("columnLabels") || {};

    // Ensure all child columns exist and are visible
    let nextOrder = [...currentOrder];
    const ensureLabel = (key: string) => (currentLabels[key] ? currentLabels[key] : key);
    columns.forEach((key) => {
      if (!nextOrder.includes(key)) nextOrder = [...nextOrder, key];
      if (currentHeaders[key] === undefined) methods.setValue(`tableHeaders.${key}`, true, { shouldDirty: true });
      if (!currentLabels[key]) methods.setValue(`columnLabels.${key}`, ensureLabel(key), { shouldDirty: true });
    });
    if (nextOrder !== currentOrder) methods.setValue("tableColumnOrder", nextOrder, { shouldDirty: true });

    // Add the group itself
    methods.setValue("columnGroups", [...currentGroups, { id, label, columns }], { shouldDirty: true });
  };

  const removeColumnGroup = (groupId: string) => {
    const current = methods.getValues("columnGroups") || [];
    methods.setValue(
      "columnGroups",
      current.filter((g: any) => g.id !== groupId),
      { shouldDirty: true }
    );
  };

  return {
    methods,
    onSubmit: handleSubmit(onSubmit),
    editableVisibilityFields,
    watch,
    isLoading,
    isDirty,
    handleColumnReorder,
    handleToggleColumnVisibility,
    handleEditLabel,
    handleAddField,
    addColumnGroup,
    removeColumnGroup,
  };
}
