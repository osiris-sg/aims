import React, { useState, useEffect, useCallback } from "react";
import { Courgette } from "next/font/google";
import DocumentNameHeader from "./DocumentNameHeader";
import { Alert, Box, Button, Divider, Grid2, Typography } from "@mui/material";
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
import { useParams } from "next/navigation";
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
  const pathname = usePathname();
  const isEditPath = pathname.includes("edit");
  const { viewMode = false } = props;
  const [isViewMode, toggleViewMode] = useState(viewMode);
  const [isToolBarOpen, toggleToolbar] = useState(false);
  const { isDocumentLoading, document } = useGetDocument();
  const { methods, onSubmit, editableVisibilityFields, watch: templateWatch, isLoading, isDirty, handleColumnReorder, handleToggleColumnVisibility, handleEditLabel, handleAddField } = useQO1TemplateHandler();
  const { customers } = useGetCustomers();
  const { addNewLine, control, companyName, setValue, customerId, projectId, fields, remove, onDocumentCreate, itemsError, isLoading: isDocumentCreationloading, isDirty: isDCretorDisabled } = useQO1DocumentCreator();
  const tableHeadersConfig = templateWatch("tableHeaders");
  const columnOrder = templateWatch("tableColumnOrder");
  const columnLabels = templateWatch("columnLabels");
  // console.log("🔍 TEMPLATE: Table headers config:", tableHeadersConfig);
  // console.log("🔍 TEMPLATE: Column order:", columnOrder);
  const { columns } = useQO1TemplateTableHeader({ viewMode: isViewMode, remove: remove, control, setValue, tableHeadersConfig, columnOrder, columnLabels });
  const customer = customers.docs.find((customer) => customer.id === customerId);
  const { contentRef, handlePrint } = usePrintDocumentHandler();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  // Site Offices fetching logic
  const { siteOffices, fetchSiteOffices } = useGetSiteOffices();
  const selectedCustomerId = templateWatch("customerId");
  const selectedDeliveryToId = templateWatch("deliveryTo");
  const selectedSiteOffice = siteOffices.find((office) => office.id === selectedDeliveryToId);
  const quotationNo = useWatch({ control, name: "quotationNo" });
  const quotationDate = useWatch({ control, name: "quotationDate" });
  const validityTerm = useWatch({ control, name: "validityTerm" });
  const currency = useWatch({ control, name: "currency" });
  const salePerson = useWatch({ control, name: "salePerson" });
  const mobile = useWatch({ control, name: "mobile" });
  const date = useWatch({ control, name: "date" });
  const salePersonEmail = useWatch({ control, name: "salePersonEmail" });
  const doNo = useWatch({ control, name: "doNo" });
  const referenceNo = useWatch({ control, name: "referenceNo" });
  const poNo = useWatch({ control, name: "poNo" });
  const attentionName = useWatch({ control, name: "attention.name" });
  const attentionPhoneNumber = useWatch({ control, name: "attention.phoneNumber" });
  const attentionEmail = useWatch({ control, name: "attention.email" });
  const gstRegNo = useWatch({ control, name: "gstRegNo" });
  const companyNameValue = useWatch({ control, name: "company.name" });
  const companyAddress = useWatch({ control, name: "company.address" });
  const title = useWatch({ control, name: "title" });
  const signatureTextCompany = useWatch({ control, name: "signatureText.company" });

  // Calculate totals using useWatch for real-time updates
  const watchedItems = useWatch({ control, name: "customerId" });
  console.log("Watched items:", watchedItems);
  useEffect(() => {
    if (watchedItems) {
      fetchSiteOffices(watchedItems);
    }
    console.log("Site offices fetched:", siteOffices);
  }, [fetchSiteOffices, watchedItems]);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({
    status: undefined,
    startDate: {
      startDate: null as Date | null,
      endDate: null as Date | null,
    },
  });
  const [triggerRender, setTriggerRender] = useState(0);
  useEffect(() => {
    console.log("Fields changed, re-rendering component", triggerRender);
    setTriggerRender((prev) => prev + 1);
  }, [fields]);

  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [isProjectsLoading, setProjectsLoading] = useState(false);

  const fetchProjects = useCallback(async () => {
    if (!organizationId) return;
    setProjectsLoading(true);

    try {
      const token = await getToken();
      if (!token) return;

      const response = await request({ path: "/projects", method: "POST" }, { page, limit, search, filters, organizationId }, token);

      if (response.success) {
        console.log("Projects response:", response.data);
        setProjects(response.data.docs || []);
      }
    } catch (error) {
      console.error("Error fetching projects:", error);
    } finally {
      setProjectsLoading(false);
    }
  }, [organizationId, page, limit, search, filters, getToken]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);
  const handleAddProject = async (projectName: string) => {
    try {
      if (!organizationId) return false;

      setProjectsLoading(true);
      const token = await getToken();
      if (!token) return false;

      const response = await request(
        {
          path: "/projects/create-by-name",
          method: "POST",
        },
        {
          name: projectName,
          organizationId,
        },
        token
      );

      if (response.success) {
        await fetchProjects();
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error creating project:", error);
      return false;
    } finally {
      setProjectsLoading(false);
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", gap: "var(--default-gap)" }}>
      <DocumentNameHeader
        primaryActionLoading={isLoading}
        secondaryActionLoading={isDocumentCreationloading}
        title={document?.name || getDocumentTypeDisplayNameWithDefaults("QO1", organization)}
        description="This document does not support uploading of template"
        viewMode={isViewMode}
        toggleViewMode={(value) => toggleViewMode(value)}
        onPrimaryActionSubmit={onSubmit}
        onSecondaryActionSubmit={onDocumentCreate}
        primaryActionDisabled={!isDirty}
        secondaryActionDisabled={!isDCretorDisabled || isDirty}
        onPrint={handlePrint}
        documentEditMode={!!documentId}
        isEditPath={isEditPath}
      />
      <Grid2 container spacing={1} sx={{ flex: 1, minHeight: 0 }}>
        {!documentId && isToolBarOpen && (
          <Grid2 size={3} sx={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
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
                    padding: isViewMode ? "var(--default-gap)" : "var(--default-gap)",
                    ...(isViewMode
                      ? {
                          "& .MuiTypography-root": {
                            fontSize: "0.7rem !important",
                            lineHeight: 1.2,
                          },
                          "& .MuiTypography-h4": {
                            fontSize: "0.9rem !important",
                            fontWeight: 700,
                          },
                          "& .MuiTypography-h5": {
                            fontSize: "0.85rem !important",
                            fontWeight: 700,
                          },
                          // Generic text fallbacks for custom components
                          "& p, & span, & label, & .MuiFormLabel-root": {
                            fontSize: "0.7rem !important",
                            lineHeight: 1.2,
                          },
                          // Inputs/Textareas if any appear in view mode
                          "& .MuiInputBase-root, & .MuiInputBase-input, & .MuiOutlinedInput-input, & textarea": {
                            fontSize: "0.7rem !important",
                          },
                          // Table cells
                          "& td, & th": {
                            fontSize: "0.68rem !important",
                            padding: "4px 6px",
                          },
                          // Buttons
                          "& .MuiButton-root": {
                            fontSize: "0.7rem",
                            padding: "4px 8px",
                          },
                        }
                      : {}),
                  }}
                >
                  {/* Header Section with Logo and Title */}
                  <Grid2 container spacing={2} sx={{ mb: isViewMode ? 2 : 2 }}>
                    <Grid2 size={4}>
                      {templateWatch("logo") && (
                        <Box sx={{ minHeight: isViewMode ? "80px" : "auto" }}>
                          <FormImage control={control} name="logo" viewMode={isViewMode} />
                        </Box>
                      )}
                    </Grid2>
                    <Grid2 size={4} />
                    <Grid2 size={4} sx={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
                      {!isViewMode && (
                        <Typography
                          variant="h4"
                          sx={{
                            fontWeight: "bold",
                            textAlign: "center",
                            fontSize: "1.5rem",
                          }}
                        >
                          {getDocumentTypeDisplayNameWithDefaults("QO1", organization).toUpperCase()}
                        </Typography>
                      )}
                    </Grid2>
                  </Grid2>
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
                            <Typography variant="body2" sx={{ minWidth: "70px", fontWeight: "400", fontSize: "0.85rem" }}>
                              Attention
                            </Typography>
                            <Typography variant="body2" sx={{ ml: 1, fontSize: "0.85rem" }}>
                              : {attentionName}
                            </Typography>
                          </Box>
                          <Box sx={{ display: "flex", alignItems: "flex-start" }}>
                            <Typography variant="body2" sx={{ minWidth: "70px", fontWeight: "400", fontSize: "0.85rem" }}>
                              Tel
                            </Typography>
                            <Typography variant="body2" sx={{ ml: 1, fontSize: "0.85rem" }}>
                              : {attentionPhoneNumber}
                            </Typography>
                          </Box>
                          <Box sx={{ display: "flex", alignItems: "flex-start" }}>
                            <Typography variant="body2" sx={{ minWidth: "70px", fontWeight: "400", fontSize: "0.85rem" }}>
                              Email
                            </Typography>
                            <Typography variant="body2" sx={{ ml: 1, fontSize: "0.85rem" }}>
                              : {attentionEmail}
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
                              fontSize: "1.1rem",
                              mb: 0.5,
                              letterSpacing: "0.5px",
                            }}
                          >
                            {getDocumentTypeDisplayNameWithDefaults("QO1", organization).toUpperCase()}
                          </Typography>
                          <Box sx={{ display: "flex", alignItems: "flex-start" }}>
                            <Typography variant="body2" sx={{ minWidth: "110px", fontWeight: "400", fontSize: "0.85rem" }}>
                              Quotation No.
                            </Typography>
                            <Typography variant="body2" sx={{ ml: 1, fontSize: "0.85rem" }}>
                              : {quotationNo}
                            </Typography>
                          </Box>
                          <Box sx={{ display: "flex", alignItems: "flex-start" }}>
                            <Typography variant="body2" sx={{ minWidth: "110px", fontWeight: "400", fontSize: "0.85rem" }}>
                              Quotation Date
                            </Typography>
                            <Typography variant="body2" sx={{ ml: 1, fontSize: "0.85rem" }}>
                              : {quotationDate}
                            </Typography>
                          </Box>
                          <Box sx={{ display: "flex", alignItems: "flex-start", mt: 0.5 }}>
                            <Typography variant="body2" sx={{ minWidth: "110px", fontWeight: "400", fontSize: "0.85rem" }}>
                              Validity Term
                            </Typography>
                            <Typography variant="body2" sx={{ ml: 1, fontSize: "0.85rem" }}>
                              : {validityTerm}
                            </Typography>
                          </Box>
                          <Box sx={{ display: "flex", alignItems: "flex-start" }}>
                            <Typography variant="body2" sx={{ minWidth: "110px", fontWeight: "400", fontSize: "0.85rem" }}>
                              Currency
                            </Typography>
                            <Typography variant="body2" sx={{ ml: 1, fontSize: "0.85rem" }}>
                              : {currency}
                            </Typography>
                          </Box>
                          <Box sx={{ display: "flex", alignItems: "flex-start" }}>
                            <Typography variant="body2" sx={{ minWidth: "110px", fontWeight: "400", fontSize: "0.85rem" }}>
                              Sale person
                            </Typography>
                            <Typography variant="body2" sx={{ ml: 1, fontSize: "0.85rem" }}>
                              : {salePerson}
                            </Typography>
                          </Box>
                          <Box sx={{ display: "flex", alignItems: "flex-start" }}>
                            <Typography variant="body2" sx={{ minWidth: "110px", fontWeight: "400", fontSize: "0.85rem" }}>
                              Mobile
                            </Typography>
                            <Typography variant="body2" sx={{ ml: 1, fontSize: "0.85rem" }}>
                              : {mobile}
                            </Typography>
                          </Box>
                          <Box sx={{ display: "flex", alignItems: "flex-start", mt: 0.5 }}>
                            <Typography variant="body2" sx={{ minWidth: "110px", fontWeight: "400", fontSize: "0.85rem" }}>
                              Email
                            </Typography>
                            <Typography variant="body2" sx={{ ml: 1, fontSize: "0.85rem" }}>
                              : {salePersonEmail}
                            </Typography>
                          </Box>
                          {doNo && (
                            <Box sx={{ display: "flex", alignItems: "flex-start" }}>
                              <Typography variant="body2" sx={{ minWidth: "110px", fontWeight: "400", fontSize: "0.85rem" }}>
                                DO No.
                              </Typography>
                              <Typography variant="body2" sx={{ ml: 1, fontSize: "0.85rem" }}>
                                : {doNo}
                              </Typography>
                            </Box>
                          )}
                          {referenceNo && (
                            <Box sx={{ display: "flex", alignItems: "flex-start" }}>
                              <Typography variant="body2" sx={{ minWidth: "110px", fontWeight: "400", fontSize: "0.85rem" }}>
                                Ref. No.
                              </Typography>
                              <Typography variant="body2" sx={{ ml: 1, fontSize: "0.85rem" }}>
                                : {referenceNo}
                              </Typography>
                            </Box>
                          )}
                          {poNo && (
                            <Box sx={{ display: "flex", alignItems: "flex-start" }}>
                              <Typography variant="body2" sx={{ minWidth: "110px", fontWeight: "400", fontSize: "0.85rem" }}>
                                Your PO No.
                              </Typography>
                              <Typography variant="body2" sx={{ ml: 1, fontSize: "0.85rem" }}>
                                : {poNo}
                              </Typography>
                            </Box>
                          )}
                        </Box>
                      ) : (
                        <Box sx={{ display: "flex", flexDirection: "column", gap: "var(--half-gap)" }}>
                          <FormInputBox control={control} name="quotationNo" label="Quotation No." placeHolder="Enter Quotation No." size="small" labelArriangment="vertical" viewMode={isViewMode} />
                          <FormInputBox control={control} name="quotationDate" label="Quotation Date" placeHolder="Enter Quotation Date" size="small" labelArriangment="vertical" viewMode={isViewMode} />
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
                    ) : (
                      <FormInputBox control={control} name="title" label="Title" placeHolder="Enter title" size="small" labelArriangment="vertical" viewMode={isViewMode} />
                    )}
                  </Box>
                  <Box mt={2} mb={1}>
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

                  <Box sx={{ display: "flex", flexDirection: "column", gap: "var(--half-gap)", my: isViewMode ? 1.5 : 3 }}>
                    <FormTextarea control={control} name="note" label="Note" placeHolder="Enter notes here" rows={4} labelArriangment="vertical" viewMode={isViewMode} />
                    <FormTextarea control={control} name="remarks" label="Remarks" placeHolder="Enter remarks here" rows={4} labelArriangment="vertical" viewMode={isViewMode} />
                    <FormTextarea control={control} name="termsAndConditions" label="Terms and Conditions" placeHolder="Enter terms and conditions here" rows={4} labelArriangment="vertical" viewMode={isViewMode} />
                  </Box>
                  {isViewMode && (
                    <Box sx={{ my: 1.5 }}>
                      <Typography variant="body1" sx={{ whiteSpace: "pre-line" }}>
                        You understand and agree to this offer. We trust our offer meets your requirements and look forward to receiving{"\n"}
                        your order confirmation soon. Kindly contact us for further information. Thank you.
                      </Typography>
                    </Box>
                  )}
                  <Grid2 container spacing={1} mt={isViewMode ? 2 : 4}>
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
                          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                            Company Signature
                          </Typography>
                          {isViewMode ? (
                            <Box className={courgette.className} sx={{ fontSize: "2.2rem", color: "#3b4a5d", lineHeight: 1, minHeight: 48 }}>
                              {signatureTextCompany}
                            </Box>
                          ) : (
                            <FormInputBox control={control} name="signatureText.company" label="Signature Text" placeHolder="Type signature" size="small" labelArriangment="vertical" />
                          )}
                        </Box>
                        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                            Company Stamp
                          </Typography>
                          <Box sx={{ transform: "scale(0.4)", transformOrigin: "top left", width: 0, height: 0 }}>
                            <FormImage control={control} name="stamp.company" viewMode={isViewMode} />
                          </Box>
                        </Box>
                      </Box>
                      <Divider sx={{ borderBottomWidth: 0, my: 1 }} />
                      {/* Company info fields below the signing component (moved from right side) */}
                      {isViewMode ? (
                        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 15 }}>
                          <Box sx={{ display: "flex", gap: 1 }}>
                            <Typography variant="body1" sx={{ minWidth: "180px" }}>
                              Company Name :
                            </Typography>
                            <Typography variant="body1">{companyName}</Typography>
                          </Box>
                          <Box sx={{ display: "flex", gap: 1 }}>
                            <Typography variant="body1" sx={{ minWidth: "180px" }}>
                              Company Address :
                            </Typography>
                            <Typography variant="body1">{companyAddress}</Typography>
                          </Box>
                          <Box sx={{ display: "flex", gap: 1 }}>
                            <Typography variant="body1" sx={{ minWidth: "180px" }}>
                              GST REG. No. :
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
  );
}
