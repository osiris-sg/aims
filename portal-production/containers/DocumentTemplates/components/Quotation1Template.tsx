import React, { useState, useEffect, useCallback } from "react";
import { Courgette } from "next/font/google";
import DocumentNameHeader from "./DocumentNameHeader";
import { Alert, Box, Button, Divider, Grid2, Typography, Dialog, DialogTitle, DialogContent, DialogActions, TextField } from "@mui/material";
import { useWatch } from "react-hook-form";
import TemplatePaper from "./TemplatePaper";
import FormImage from "@/form-components/FormImage";
import { request } from "@/helpers/request";
import FormInputBox from "@/form-components/FormInputBox";
import FormTextarea from "@/form-components/FormTextArea";
import FormSelect from "@/form-components/FormSelect";
import { useGetCustomers } from "../hooks/useGetCustomers";
import { useGetSiteOffices } from "../hooks/useGetSiteOffices";
import Table from "@/components/Table";
import DocumentCustomizer from "./DocumentCustomizer";
import useQO1TemplateTableHeader from "../hooks/useQO1TemplateTableHeader";
import SignatureDialog from "./SignatureDialog";
import useGetDocument from "../hooks/useGetDocument";
import DocumentSkeleton from "./DocumentSkeleton";
import usePrintDocumentHandler from "../hooks/usePrintDocumentHandler";
import { useParams, useRouter } from "next/navigation";
import useQO1DocumentCreator from "../hooks/useQO1DocumentCreator";
import useQO1TemplateHandler from "../hooks/useQO1TemplateHandler";
import { usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { getDocumentTypeDisplayNameWithDefaults } from "@/helpers/documentTypeHelper";

// Handwritten-style font for typed signatures
const courgette = Courgette({ subsets: ["latin"], weight: "400" });
interface Props {
  viewMode: boolean;
}
export default function Quotation1Template(props: Props) {
  const { documentId } = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const isEditPath = pathname.includes("edit");
  const { viewMode = false } = props;
  const [isViewMode, toggleViewMode] = useState(viewMode);
  const [isToolBarOpen, toggleToolbar] = useState(false);
  const { isDocumentLoading, document } = useGetDocument();
  const { methods, onSubmit, editableVisibilityFields, watch: templateWatch, isLoading, isDirty, handleColumnReorder, handleToggleColumnVisibility, handleEditLabel, handleAddField, addColumnGroup, removeColumnGroup } = useQO1TemplateHandler();
  const { customers } = useGetCustomers();
  const { addNewLine, control, companyName, setValue, customerId, fields, remove, onDocumentCreate, itemsError, isLoading: isDocumentCreationloading, isDirty: isDCretorDisabled } = useQO1DocumentCreator();
  const tableHeadersConfig = templateWatch("tableHeaders");
  const columnOrder = templateWatch("tableColumnOrder");
  const columnLabels = templateWatch("columnLabels");
  const columnGroups = templateWatch("columnGroups");
  const templateName = templateWatch("name");

  // Handle template name change
  const handleTemplateNameChange = (newName: string) => {
    methods.setValue("name", newName, { shouldDirty: true });
  };
  // console.log("🔍 TEMPLATE: Table headers config:", tableHeadersConfig);
  // console.log("🔍 TEMPLATE: Column order:", columnOrder);
  const { columns } = useQO1TemplateTableHeader({ viewMode: isViewMode, remove: remove, control, setValue, tableHeadersConfig, columnOrder, columnLabels, columnGroups });
  const customer = customers.docs.find((customer) => customer.id === customerId);
  const { contentRef, handlePrint } = usePrintDocumentHandler();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  // Save-as-new-template dialog state
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");

  // Site Offices fetching logic
  const { siteOffices, fetchSiteOffices } = useGetSiteOffices();
  const quotationNo = useWatch({ control, name: "quotationNo" });
  const validityTerm = useWatch({ control, name: "validityTerm" });
  const currency = useWatch({ control, name: "currency" });
  const salePerson = useWatch({ control, name: "salePerson" });
  const mobile = useWatch({ control, name: "mobile" });
  const salePersonEmail = useWatch({ control, name: "salePersonEmail" });
  const doNo = useWatch({ control, name: "doNo" });
  const referenceNo = useWatch({ control, name: "referenceNo" });
  const poNo = useWatch({ control, name: "poNo" });
  const attentionName = useWatch({ control, name: "attention.name" });
  const attentionPhoneNumber = useWatch({ control, name: "attention.phoneNumber" });
  const attentionEmail = useWatch({ control, name: "attention.email" });
  const gstRegNo = useWatch({ control, name: "gstRegNo" });
  // const companyNameValue = useWatch({ control, name: "company.name" });
  const companyAddress = useWatch({ control, name: "company.address" });
  const title = useWatch({ control, name: "title" });
  const signatureTextCompany = useWatch({ control, name: "signatureText.company" });
  const agreementText = useWatch({ control, name: "agreementText" });

  // Calculate totals using useWatch for real-time updates
  const watchedItems = useWatch({ control, name: "customerId" });
  console.log("Watched items:", watchedItems);
  useEffect(() => {
    if (watchedItems) {
      fetchSiteOffices(watchedItems);
    }
    console.log("Site offices fetched:", siteOffices);
  }, [fetchSiteOffices, watchedItems, siteOffices]);
  // Removed unused pagination/filter state
  // Removed triggerRender useEffect to prevent infinite loops

  // Removed unused projects fetching logic

  const handleOpenCloneDialog = () => {
    setNewTemplateName(templateName || "");
    setCloneDialogOpen(true);
  };

  const handleCloseCloneDialog = () => setCloneDialogOpen(false);

  const handleSaveAsNewTemplate = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      // Use current form config from template handler
      const currentConfig = methods.getValues();
      const baseName = (newTemplateName || templateName || "New Quotation Template").trim();
      const baseType = ((currentConfig?.type as string) || "QO1").toUpperCase();
      // Keep the same type as the current template (no auto-increment)
      const nextType = baseType;

      // 1) Create the template (backend create does not take config)
      const createRes = await request({ path: "/documentTemplates/create", method: "POST" }, { name: baseName, type: nextType }, token);
      if (!createRes?.success || !createRes?.data?.id) {
        console.error("Failed to create template", createRes);
        return;
      }

      const createdId = createRes.data.id as string;

      // 2) Update the template with the current config
      // Remove fields that shouldn't live inside config object duplication
      const restConfig = ((cfg: Record<string, unknown>) => {
        const { id, createdAt, updatedAt, organizationId, name: _oldName, type: _oldType, ...rest } = cfg || {};
        void id;
        void createdAt;
        void updatedAt;
        void organizationId;
        void _oldName;
        void _oldType;
        return rest as Record<string, unknown>;
      })(currentConfig as Record<string, unknown>);

      // Ensure provided name/type take precedence over anything in config
      const updateRes = await request({ path: "/documentTemplates/update", method: "POST" }, { id: createdId, ...restConfig, name: baseName, type: nextType }, token);

      if (!updateRes?.success) {
        console.error("Failed to update new template config", updateRes);
      }

      setCloneDialogOpen(false);
      // Navigate to the new template editor
      router.push(`/portal/documents/edit/${nextType}/${createdId}`);
    } catch (e) {
      console.error("Save-as-new-template failed", e);
    }
  }, [getToken, methods, newTemplateName, templateName, router, organizationId]);
  // Removed unused handleAddProject

  return (
    <>
      <Box sx={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", gap: "var(--default-gap)" }}>
        <DocumentNameHeader
          primaryActionLoading={isLoading}
          secondaryActionLoading={isDocumentCreationloading}
          title={(document as unknown as { name?: string })?.name || getDocumentTypeDisplayNameWithDefaults("QO1", organization)}
          description="This document does not support uploading of template"
          headerLoading={isDocumentLoading || (!!documentId && !(document as unknown as { name?: string })?.name)}
          viewMode={isViewMode}
          toggleViewMode={(value) => toggleViewMode(value)}
          onPrimaryActionSubmit={onSubmit}
          onSecondaryActionSubmit={onDocumentCreate}
          primaryActionDisabled={!isDirty}
          secondaryActionDisabled={!isDCretorDisabled || isDirty}
          onPrint={handlePrint}
          documentEditMode={!!documentId}
          isEditPath={isEditPath}
          currentDocumentId={(document as unknown as { id?: string })?.id}
          // Template editing props
          templateName={templateName}
          onTemplateNameChange={handleTemplateNameChange}
          isTemplateEditMode={isEditPath && !documentId}
        />
        {/* Save as new template button: visible only in template edit mode */}
        {!documentId && isEditPath && (
          <Box sx={{ px: "var(--default-gap)", pb: 1 }}>
            <Button variant="outlined" size="small" onClick={handleOpenCloneDialog}>
              Save as new template
            </Button>
          </Box>
        )}
        <Grid2 container spacing={1} sx={{ flex: 1, minHeight: 0 }}>
          {!documentId && isToolBarOpen && (
            <Grid2 size={3} sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
              <form onSubmit={onSubmit} style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
                <DocumentCustomizer
                  fields={editableVisibilityFields}
                  control={methods.control}
                  tableHeaders={tableHeadersConfig}
                  columnOrder={columnOrder}
                  columnLabels={columnLabels}
                  onColumnReorder={handleColumnReorder}
                  onToggleColumnVisibility={handleToggleColumnVisibility}
                  onEditLabel={handleEditLabel}
                  onAddField={handleAddField}
                  columnGroups={columnGroups}
                  onAddGroup={(label, cols) => addColumnGroup(label, cols)}
                  onRemoveGroup={(id) => removeColumnGroup(id)}
                />
              </form>
            </Grid2>
          )}
          <Grid2 size={!documentId && isToolBarOpen ? 9 : 12} sx={{ height: "100%", overflow: "hidden" }}>
            <TemplatePaper isToolBarOpen={isToolBarOpen} toggleToolbar={() => toggleToolbar(!isToolBarOpen)} documentEditMode={!!documentId}>
              {isDocumentLoading ? (
                <DocumentSkeleton />
              ) : (
                <form onSubmit={onSubmit} ref={contentRef}>
                  <Box
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      // Keep original left/right spacing; only tighten top in view mode
                      px: isViewMode ? "var(--double-gap)" : "var(--default-gap)",
                      pt: isViewMode ? "8px" : undefined,
                      pb: isViewMode ? "var(--default-gap)" : "var(--default-gap)",
                      ...(isViewMode
                        ? {
                            // Typography scale similar to Invoice
                            "& .MuiTypography-root": { fontSize: "11px !important", lineHeight: 1.35 },
                            "& .MuiTypography-h4": {
                              fontSize: "18px !important",
                              fontWeight: 700,
                            },
                            "& .MuiTypography-h5": {
                              fontSize: "16px !important",
                              fontWeight: 700,
                            },
                            // Generic text fallbacks for custom components
                            "& p, & span, & label, & .MuiFormLabel-root": {
                              fontSize: "11px !important",
                              lineHeight: 1.35,
                            },
                            // Inputs/Textareas if any appear in view mode
                            "& .MuiInputBase-root, & .MuiInputBase-input, & .MuiOutlinedInput-input, & textarea": {
                              fontSize: "11px !important",
                            },
                            // Table polish (applies to our Table component output)
                            "& table": { width: "100%", borderCollapse: "collapse" },
                            "& th, & td": { fontSize: "11px !important", padding: "8px 10px", border: "1px solid", borderColor: "divider" },
                            "& thead th": { backgroundColor: "#f6f7fb", color: "#1f2937", fontWeight: 700 },
                            "& tbody tr:nth-of-type(even)": { backgroundColor: "#fafafa" },
                            // Buttons (rare in view mode)
                            "& .MuiButton-root": { fontSize: "11px", padding: "4px 8px" },
                          }
                        : {}),
                    }}
                  >
                    {/* Header Section with Logo and Title */}
                    <Grid2 container spacing={2} sx={{ mb: isViewMode ? 2 : 2 }}>
                      <Grid2 size={4}>
                        {templateWatch("logo") && (
                          <Box sx={{ minHeight: isViewMode ? "40px" : "auto" }}>
                            <FormImage control={control} name="logo" viewMode={isViewMode} width={180} height={60} />
                          </Box>
                        )}
                      </Grid2>
                      <Grid2 size={4} />
                      <Grid2 size={4} sx={{ display: "flex", justifyContent: "center", alignItems: "center" }} />
                    </Grid2>
                    {isViewMode && <Divider sx={{ my: 2 }} />}
                    {/* Main Content Section */}
                    <Grid2 container spacing={isViewMode ? 1 : 4} sx={{ mb: isViewMode ? 2 : 2 }}>
                      {/* Left Column - Customer Information */}
                      <Grid2 size={isViewMode ? 4 : 6} sx={{ pl: isViewMode ? 0 : undefined }}>
                        {!isViewMode && (
                          <FormSelect
                            control={control}
                            name="customerId"
                            label="Customer"
                            addItem={false}
                            menuTitle="Choose customer"
                            menuItems={customers.docs.map((customer) => ({
                              label: customer.name,
                              value: customer.id,
                            }))}
                            size="small"
                          />
                        )}
                        {isViewMode && customer && (
                          <Box sx={{ mb: 2 }}>
                            <Typography variant="body1" sx={{ fontWeight: "bold", mb: 0.3, mt: 2.5, fontSize: "0.95rem" }}>
                              {customer.name}
                            </Typography>
                            <Typography variant="body2" sx={{ mb: 0.3, fontSize: "0.85rem", lineHeight: 1.3 }}>
                              {customer.address}
                            </Typography>
                          </Box>
                        )}

                        {!isViewMode ? (
                          <Box sx={{ display: "flex", flexDirection: "column", gap: "var(--half-gap)" }}>
                            <FormInputBox control={control} name="attention.name" label="Attention" placeHolder="Enter Attention" size="small" labelArriangment="vertical" viewMode={isViewMode} />
                            <FormInputBox control={control} name="attention.phoneNumber" label="Mobile" placeHolder="Enter Mobile Number" size="small" labelArriangment="vertical" viewMode={isViewMode} />
                            <FormInputBox control={control} name="attention.email" label="Email" placeHolder="Enter Email" size="small" labelArriangment="vertical" viewMode={isViewMode} />
                          </Box>
                        ) : (
                          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.3, mt: 1 }}>
                            <Box sx={{ display: "flex", alignItems: "flex-start" }}>
                              <Typography variant="body2" sx={{ minWidth: "60px", fontWeight: "400", fontSize: "0.85rem" }}>
                                Attention
                              </Typography>
                              <Typography variant="body2" sx={{ mx: 0.3, fontSize: "0.85rem" }}>
                                :
                              </Typography>
                              <Typography variant="body2" sx={{ fontSize: "0.85rem" }}>
                                {attentionName}
                              </Typography>
                            </Box>
                            <Box sx={{ display: "flex", alignItems: "flex-start" }}>
                              <Typography variant="body2" sx={{ minWidth: "60px", fontWeight: "400", fontSize: "0.85rem" }}>
                                Tel
                              </Typography>
                              <Typography variant="body2" sx={{ mx: 0.3, fontSize: "0.85rem" }}>
                                :
                              </Typography>
                              <Typography variant="body2" sx={{ fontSize: "0.85rem" }}>
                                {attentionPhoneNumber}
                              </Typography>
                            </Box>
                            <Box sx={{ display: "flex", alignItems: "flex-start" }}>
                              <Typography variant="body2" sx={{ minWidth: "60px", fontWeight: "400", fontSize: "0.85rem" }}>
                                Email
                              </Typography>
                              <Typography variant="body2" sx={{ mx: 0.3, fontSize: "0.85rem" }}>
                                :
                              </Typography>
                              <Typography variant="body2" sx={{ fontSize: "0.85rem" }}>
                                {attentionEmail}
                              </Typography>
                            </Box>
                          </Box>
                        )}

                        {templateWatch("deliveryTo") && (
                          <Box sx={{ mt: isViewMode ? 2 : 1 }}>
                            <FormSelect
                              control={control}
                              name="deliveryTo"
                              label="Delivery To"
                              menuTitle="Choose delivery location"
                              menuItems={siteOffices.map((office) => ({
                                label: `${office.name} (${office.address || ""})`,
                                value: office.id, // unique ID
                              }))}
                              size="small"
                              labelArriangment={isViewMode ? "horizontal" : "vertical"}
                              viewMode={isViewMode}
                            />
                          </Box>
                        )}
                      </Grid2>

                      {/* Right Column - Quotation Details */}
                      <Grid2 size={isViewMode ? 8 : 6}>
                        {isViewMode ? (
                          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.3 }}>
                            {/* QUOTATION Title - smaller and left-aligned for view mode */}
                            <Typography
                              variant="h5"
                              sx={{
                                fontWeight: "bold",
                                textAlign: "left",
                                fontSize: "16px",
                                mb: 0.5,
                                letterSpacing: "0.5px",
                              }}
                            >
                              {"QUOTATION"}
                            </Typography>
                            <Box sx={{ display: "flex", alignItems: "flex-start" }}>
                              <Typography variant="body2" sx={{ minWidth: "100px", fontWeight: 600 }}>
                                Quotation No.
                              </Typography>
                              <Typography variant="body2" sx={{ mx: 0.3 }}>
                                :
                              </Typography>
                              <Typography variant="body2">{quotationNo}</Typography>
                            </Box>

                            <Box sx={{ display: "flex", alignItems: "flex-start", mt: 0.5 }}>
                              <Typography variant="body2" sx={{ minWidth: "100px", fontWeight: 600 }}>
                                Validity Term
                              </Typography>
                              <Typography variant="body2" sx={{ mx: 0.3 }}>
                                :
                              </Typography>
                              <Typography variant="body2">{validityTerm}</Typography>
                            </Box>
                            <Box sx={{ display: "flex", alignItems: "flex-start" }}>
                              <Typography variant="body2" sx={{ minWidth: "100px", fontWeight: 600 }}>
                                Currency
                              </Typography>
                              <Typography variant="body2" sx={{ mx: 0.3 }}>
                                :
                              </Typography>
                              <Typography variant="body2">{currency}</Typography>
                            </Box>
                            <Box sx={{ display: "flex", alignItems: "flex-start" }}>
                              <Typography variant="body2" sx={{ minWidth: "100px", fontWeight: 600 }}>
                                Sale person
                              </Typography>
                              <Typography variant="body2" sx={{ mx: 0.3 }}>
                                :
                              </Typography>
                              <Typography variant="body2">{salePerson}</Typography>
                            </Box>
                            <Box sx={{ display: "flex", alignItems: "flex-start" }}>
                              <Typography variant="body2" sx={{ minWidth: "100px", fontWeight: 600 }}>
                                Mobile
                              </Typography>
                              <Typography variant="body2" sx={{ mx: 0.3 }}>
                                :
                              </Typography>
                              <Typography variant="body2">{mobile}</Typography>
                            </Box>
                            <Box sx={{ display: "flex", alignItems: "flex-start", mt: 0.5 }}>
                              <Typography variant="body2" sx={{ minWidth: "100px", fontWeight: 600 }}>
                                Email
                              </Typography>
                              <Typography variant="body2" sx={{ mx: 0.3 }}>
                                :
                              </Typography>
                              <Typography variant="body2">{salePersonEmail}</Typography>
                            </Box>
                            {doNo && (
                              <Box sx={{ display: "flex", alignItems: "flex-start" }}>
                                <Typography variant="body2" sx={{ minWidth: "110px", fontWeight: "400", fontSize: "0.85rem" }}>
                                  DO No.
                                </Typography>
                                <Typography variant="body2" sx={{ ml: 0.5, fontSize: "0.85rem" }}>
                                  : {doNo}
                                </Typography>
                              </Box>
                            )}
                            {referenceNo && (
                              <Box sx={{ display: "flex", alignItems: "flex-start" }}>
                                <Typography variant="body2" sx={{ minWidth: "110px", fontWeight: "400", fontSize: "0.85rem" }}>
                                  Ref. No.
                                </Typography>
                                <Typography variant="body2" sx={{ ml: 0.5, fontSize: "0.85rem" }}>
                                  : {referenceNo}
                                </Typography>
                              </Box>
                            )}
                            {poNo && (
                              <Box sx={{ display: "flex", alignItems: "flex-start" }}>
                                <Typography variant="body2" sx={{ minWidth: "110px", fontWeight: "400", fontSize: "0.85rem" }}>
                                  Your PO No.
                                </Typography>
                                <Typography variant="body2" sx={{ ml: 0.5, fontSize: "0.85rem" }}>
                                  : {poNo}
                                </Typography>
                              </Box>
                            )}
                          </Box>
                        ) : (
                          <Box sx={{ display: "flex", flexDirection: "column", gap: "var(--half-gap)" }}>
                            <FormInputBox control={control} name="quotationNo" label="Quotation No." placeHolder="Enter Quotation No." size="small" labelArriangment="vertical" viewMode={isViewMode} />
                            <FormInputBox control={control} name="validityTerm" label="Validity Term" placeHolder="Enter Validity Term" size="small" labelArriangment="vertical" viewMode={isViewMode} />
                            <FormInputBox control={control} name="currency" label="Currency" placeHolder="Enter Currency" size="small" labelArriangment="vertical" viewMode={isViewMode} />
                            <FormInputBox control={control} name="salePerson" label="Sale Person" placeHolder="Enter Sale Person Name" size="small" labelArriangment="vertical" viewMode={isViewMode} />
                            <FormInputBox control={control} name="mobile" label="Mobile" placeHolder="Enter Mobile Number" size="small" labelArriangment="vertical" viewMode={isViewMode} />
                            <FormInputBox control={control} name="date" label="Date" type="date" size="small" labelArriangment="vertical" viewMode={isViewMode} />
                            <FormInputBox control={control} name="salePersonEmail" label="Sales Person Email" placeHolder="Enter Sales Person Email" size="small" labelArriangment="vertical" viewMode={isViewMode} />
                            {templateWatch("doNo") && <FormInputBox control={control} name="doNo" label="DO No." placeHolder="Enter Delivery Order No" size="small" labelArriangment="vertical" viewMode={isViewMode} />}
                            {templateWatch("referenceNo") && <FormInputBox control={control} name="referenceNo" label="Ref. No." placeHolder="Enter Our Reference No" size="small" labelArriangment="vertical" viewMode={isViewMode} />}
                            {templateWatch("poNo") && <FormInputBox control={control} name="poNo" label="Your PO No." placeHolder="Enter PO No" size="small" labelArriangment="vertical" viewMode={isViewMode} />}
                          </Box>
                        )}
                      </Grid2>
                    </Grid2>

                    <Box>
                      {isViewMode ? (
                        <>
                          <Typography variant="h4" sx={{ fontWeight: "bold", textDecoration: "underline", mt: 2 }}>
                            {title}
                          </Typography>
                          <Typography variant="body1" sx={{ whiteSpace: "pre-line", mt: 1 }}>
                            We are pleased to submit our quotation with the following terms and conditions for your consideration and acceptance.
                          </Typography>
                        </>
                      ) : isEditPath && !documentId ? (
                        templateWatch("showDefaultTitle") && <FormInputBox control={methods.control} name="defaultValues.title" label="Title" placeHolder="Enter title" size="small" labelArriangment="vertical" viewMode={isViewMode} />
                      ) : (
                        <FormInputBox control={control} name="title" label="Title" placeHolder="Enter title" size="small" labelArriangment="vertical" viewMode={isViewMode} />
                      )}
                    </Box>
                    <Box mt={isViewMode ? 3 : 2} mb={1}>
                      <Box sx={{ width: "100%", maxWidth: "100%", overflow: "hidden" }}>
                        <Table key={`table-${columns.length}-${columnOrder?.join("-") || "default"}-${JSON.stringify(columnLabels)}`} columns={columns} data={[...fields]} isNoSelectionColumn={true} />
                      </Box>
                    </Box>
                    {itemsError && <Alert severity="error">{`${itemsError}`}</Alert>}

                    {!isViewMode && !isEditPath && (
                      <Box sx={{ display: "flex", justifyContent: "flex-start", mt: 1, mb: 5 }}>
                        <Button variant="contained" color="primary" onClick={() => addNewLine()} size="small">
                          Add Item
                        </Button>
                      </Box>
                    )}

                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, my: isViewMode ? 3 : 3 }}>
                      {(isEditPath && !documentId ? templateWatch("showDefaultNote") : true) && (
                        <FormTextarea control={isEditPath && !documentId ? methods.control : control} name={isEditPath && !documentId ? "defaultValues.note" : "note"} label="Note" placeHolder="Enter notes here" rows={4} labelArriangment="vertical" viewMode={isViewMode} />
                      )}
                      {(isEditPath && !documentId ? templateWatch("showDefaultRemarks") : true) && (
                        <FormTextarea control={isEditPath && !documentId ? methods.control : control} name={isEditPath && !documentId ? "defaultValues.remarks" : "remarks"} label="Remarks" placeHolder="Enter remarks here" rows={4} labelArriangment="vertical" viewMode={isViewMode} />
                      )}
                      {(isEditPath && !documentId ? templateWatch("showDefaultTermsAndConditions") : true) && (
                        <FormTextarea
                          control={isEditPath && !documentId ? methods.control : control}
                          name={isEditPath && !documentId ? "defaultValues.termsAndConditions" : "termsAndConditions"}
                          label="Terms and Conditions"
                          placeHolder="Enter terms and conditions here"
                          rows={4}
                          labelArriangment="vertical"
                          viewMode={isViewMode}
                        />
                      )}
                      {(isEditPath && !documentId ? templateWatch("showDefaultAgreementText") : true) && (
                        <FormTextarea
                          control={isEditPath && !documentId ? methods.control : control}
                          name={isEditPath && !documentId ? "defaultValues.agreementText" : "agreementText"}
                          label="Closing Text"
                          placeHolder="Enter closing text (e.g., You understand and agree...)"
                          rows={3}
                          labelArriangment="vertical"
                          viewMode={isViewMode}
                        />
                      )}
                    </Box>
                    {isViewMode && (
                      <Box sx={{ my: 3 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-line" }}>
                          {agreementText}
                        </Typography>
                      </Box>
                    )}
                    <Grid2 container spacing={1} mt={isViewMode ? 3 : 4}>
                      <Grid2 size={6} sx={{ pl: isViewMode ? 0 : undefined }}>
                        <Typography variant="body1" sx={{ fontWeight: "bold" }}>
                          We offer the above
                        </Typography>
                        <Typography variant="body1" sx={{ fontWeight: "bold" }}>
                          {companyName}
                        </Typography>
                        {/* Company Signature + Stamp side by side */}
                        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "flex-start" }}>
                          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                            {isViewMode ? (
                              <Box className={courgette.className} sx={{ fontSize: "1.5rem", color: "#3b4a5d", lineHeight: 1, minHeight: 36, mt: 3 }}>
                                {signatureTextCompany}
                              </Box>
                            ) : isEditPath && !documentId ? (
                              templateWatch("showDefaultSignatureText") && <FormInputBox control={methods.control} name="defaultValues.signatureText.company" label="Signature Text" placeHolder="Type signature" size="small" labelArriangment="vertical" />
                            ) : (
                              <FormInputBox control={control} name="signatureText.company" label="Signature Text" placeHolder="Type signature" size="small" labelArriangment="vertical" />
                            )}
                          </Box>
                          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                            <Box sx={{ transform: "scale(0.25)", transformOrigin: "top left", width: 0, height: 0, mt: 3 }}>
                              <FormImage control={control} name="stamp.company" viewMode={isViewMode} width={120} height={120} />
                            </Box>
                          </Box>
                        </Box>
                        <Divider sx={{ borderBottomWidth: 0, my: 1 }} />
                        {/* Company info fields below the signing component (moved from right side) */}
                        {isViewMode ? (
                          <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 15 }}>
                            <Box sx={{ display: "flex", alignItems: "baseline" }}>
                              <Typography variant="body1" sx={{ minWidth: "100px", fontWeight: 500 }}>
                                Company Name
                              </Typography>
                              <Typography variant="body1" sx={{ width: "10px", textAlign: "center" }}>
                                :
                              </Typography>
                              <Typography variant="body1">{companyName}</Typography>
                            </Box>
                            <Box sx={{ display: "flex", alignItems: "baseline" }}>
                              <Typography variant="body1" sx={{ minWidth: "100px", fontWeight: 500 }}>
                                Company Address
                              </Typography>
                              <Typography variant="body1" sx={{ width: "10px", textAlign: "center" }}>
                                :
                              </Typography>
                              <Typography variant="body1">{companyAddress}</Typography>
                            </Box>
                            <Box sx={{ display: "flex", alignItems: "baseline" }}>
                              <Typography variant="body1" sx={{ minWidth: "100px", fontWeight: 500 }}>
                                GST REG. No.
                              </Typography>
                              <Typography variant="body1" sx={{ width: "10px", textAlign: "center" }}>
                                :
                              </Typography>
                              <Typography variant="body1">{gstRegNo}</Typography>
                            </Box>
                          </Box>
                        ) : (
                          <Box sx={{ display: "flex", flexDirection: "column", gap: "var(--half-gap)", textAlign: "center", alignItems: "inherit" }}>
                            {templateWatch("company.name") && <FormInputBox control={control} label="Company name" name="company.name" placeHolder="Enter Company Name" size="small" labelArriangment="vertical" viewMode={isViewMode} />}
                            {templateWatch("company.address") && <FormInputBox control={control} label="Company address" name="company.address" placeHolder="Enter Company Address" size="small" labelArriangment="vertical" viewMode={isViewMode} />}
                            <FormInputBox control={control} name="gstRegNo" label="GST REG. No." placeHolder="Enter GST Reg No" size="small" labelArriangment="vertical" viewMode={isViewMode} />
                          </Box>
                        )}
                      </Grid2>
                      <Grid2 size={6}>
                        <Typography variant="body1" sx={{ fontWeight: "bold" }}>
                          Buyer accepts the above offer{" "}
                        </Typography>
                        <Typography variant="body1" sx={{ fontWeight: "bold" }}>
                          {customer?.name}
                        </Typography>
                        <SignatureDialog label="customer" name="signature.customer" viewMode={isViewMode} control={control} />
                        <Divider sx={{ borderBottomWidth: 2, borderColor: "black", my: 2, width: "260px", mx: "20px" }} />
                        <Typography variant="body1">Customer&apos;s Signature & Company Stamp </Typography>
                        <Typography variant="body1">Date:</Typography>
                      </Grid2>
                    </Grid2>
                  </Box>
                </form>
              )}
            </TemplatePaper>
          </Grid2>
        </Grid2>
      </Box>
      {/* Clone template dialog */}
      <Dialog open={cloneDialogOpen} onClose={handleCloseCloneDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Save as new template</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth margin="dense" label="New template name" value={newTemplateName} onChange={(e) => setNewTemplateName(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseCloneDialog} color="secondary">
            Cancel
          </Button>
          <Button onClick={handleSaveAsNewTemplate} variant="contained">
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
