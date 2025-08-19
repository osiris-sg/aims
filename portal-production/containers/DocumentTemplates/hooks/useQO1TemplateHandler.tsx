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
      };

      console.log("🔄 TEMPLATE HANDLER: Merged config:", mergedConfig);
      console.log("🔄 TEMPLATE HANDLER: Table headers:", mergedConfig.tableHeaders);
      console.log("🔄 TEMPLATE HANDLER: Column order:", mergedConfig.tableColumnOrder);
      console.log("🔄 TEMPLATE HANDLER: Final columnLabels:", mergedConfig.columnLabels);

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
  ];

  const handleColumnReorder = (newOrder: string[]) => {
    methods.setValue("tableColumnOrder", newOrder, { shouldDirty: true });
  };

  const handleToggleColumnVisibility = (columnId: string, visible: boolean) => {
    methods.setValue(`tableHeaders.${columnId}`, visible, { shouldDirty: true });
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
  };
}
