import React, { useState, useEffect } from "react";
import { useWatch } from "react-hook-form";
import DocumentNameHeader from "./DocumentNameHeader";
import { Alert, Box, Button, Divider, Grid2, Typography, useTheme, useMediaQuery } from "@mui/material";
import TemplatePaper from "./TemplatePaper";
import FormImage from "@/form-components/FormImage";
import { request } from "@/helpers/request";
import FormInputBox from "@/form-components/FormInputBox";
import FormTextArea from "@/form-components/FormTextArea";
import FormSelect from "@/form-components/FormSelect";
import { useGetCustomers } from "../hooks/useGetCustomers";
import Table from "@/components/Table";
import DocumentCustomizer from "./DocumentCustomizer";
import useTemplateTableHeader from "../hooks/useTemplateTableHeaderInvoice";
import useGetDocument from "../hooks/useGetDocument";
import DocumentSkeleton from "./DocumentSkeleton";
import usePrintDocumentHandler from "../hooks/usePrintDocumentHandler";
import { useParams } from "next/navigation";
import useTITemplateHandler from "../hooks/useTITemplateHandler";
import useTIDocumentCreator from "../hooks/useTIDocumentCreator";
import { usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";

interface Props {
  viewMode: boolean;
}

interface InvoiceItem {
  price?: string;
  quantity?: string;
  tax?: string;
  customTax?: string;
}

export default function InvoiceTemplate(props: Props) {
  const { documentId } = useParams();
  const pathname = usePathname();
  const isEditPath = pathname.includes("edit");
  const { viewMode = false } = props;
  const [isViewMode, toggleViewMode] = useState(viewMode);
  const [isToolBarOpen, toggleToolbar] = useState(false);
  const { isDocumentLoading } = useGetDocument();
  const { methods, onSubmit, editableVisibilityFields, watch, isLoading, isDirty } = useTITemplateHandler();
  const { customers } = useGetCustomers();
  const { addNewLine, control, setValue, customerId, fields, remove, onDocumentCreate, itemsError, isLoading: isDocumentCreationloading, isDirty: isDCretorDisabled } = useTIDocumentCreator();
  const { columns } = useTemplateTableHeader({ viewMode: isViewMode, remove: remove, control, setValue });
  const customer = customers.docs.find((customer) => customer.id === customerId);
  const { contentRef, handlePrint } = usePrintDocumentHandler();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  // Mobile responsiveness
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const [page] = useState(1);
  const [limit] = useState(10);
  const [search] = useState("");
  const [filters] = useState({
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

  const fetchProjects = async () => {
    if (!organizationId) return;

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
    }
  };

  useEffect(() => {
    fetchProjects();
  }, [organizationId]);
  const handleAddProject = async (projectName: string) => {
    try {
      if (!organizationId) return false;

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
    }
  };

  // Calculate totals using useWatch for real-time updates
  const watchedItems = useWatch({ control, name: "items" });
  console.log("Watched items:", watchedItems);
  const subtotal =
    watchedItems?.reduce((acc: number, item: InvoiceItem) => {
      const price = parseFloat(item?.price || "0");
      const quantity = parseFloat(item?.quantity || "1");
      return acc + price * quantity;
    }, 0) || 0;

  const totalTax =
    watchedItems?.reduce((acc: number, item: InvoiceItem) => {
      const price = parseFloat(item?.price || "0");
      const quantity = parseFloat(item?.quantity || "1");
      let taxRate = 0;

      if (item.tax === "custom") {
        taxRate = parseFloat(item?.customTax || "0") / 100;
      } else {
        taxRate = parseFloat(item?.tax || "0") / 100;
      }

      return acc + price * quantity * taxRate;
    }, 0) || 0;

  const total = subtotal + totalTax;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", gap: "var(--default-gap)", overflow: "hidden" }}>
      <DocumentNameHeader
        primaryActionLoading={isLoading}
        secondaryActionLoading={isDocumentCreationloading}
        title="Invoice"
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
      <Grid2 container spacing={1} height="100%">
        {!documentId && isToolBarOpen && (
          <Grid2 size={3}>
            <form onSubmit={onSubmit}>
              <DocumentCustomizer fields={editableVisibilityFields} control={methods.control} />
            </form>
          </Grid2>
        )}
        <Grid2 size={!documentId && isToolBarOpen ? 9 : 12} height="100%">
          <TemplatePaper isToolBarOpen={isToolBarOpen} toggleToolbar={() => toggleToolbar(!isToolBarOpen)} documentEditMode={!!documentId}>
            {isDocumentLoading ? (
              <DocumentSkeleton />
            ) : (
              <form onSubmit={onSubmit} ref={contentRef}>
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    padding: isMobile ? "var(--default-gap)" : "var(--double-gap)",
                    gap: isMobile ? "var(--default-gap)" : "var(--double-gap)",
                  }}
                >
                  {/* Header Section - Responsive Grid */}
                  <Grid2 container spacing={isMobile ? 2 : 1}>
                    <Grid2 size={isMobile ? 12 : 4}>{watch("logo") && <FormImage control={control} name="logo" viewMode={isViewMode} />}</Grid2>
                    <Grid2 size={isMobile ? 12 : 4}>
                      <Box
                        sx={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "var(--half-gap)",
                          textAlign: isMobile ? "left" : "center",
                          alignItems: isViewMode ? "center" : "inherit",
                        }}
                      >
                        {watch("company.name") && <FormInputBox control={control} label={isViewMode ? undefined : "Company name"} name="company.name" placeHolder="Enter Company Name" size="small" labelArriangment={isViewMode ? "horizontal" : "vertical"} viewMode={isViewMode} />}
                        {watch("company.address") && <FormInputBox control={control} label={isViewMode ? undefined : "Company address"} name="company.address" placeHolder="Enter Company Address" size="small" labelArriangment={isViewMode ? "horizontal" : "vertical"} viewMode={isViewMode} />}
                        {watch("company.phoneNumber") && (
                          <FormInputBox control={control} label={isViewMode ? undefined : "Company phone number"} name="company.phoneNumber" placeHolder="Enter Company Phone Number" size="small" labelArriangment={isViewMode ? "horizontal" : "vertical"} viewMode={isViewMode} />
                        )}
                      </Box>
                    </Grid2>
                    <Grid2 size={isMobile ? 12 : 4} />
                  </Grid2>

                  {/* Document Title - Centered */}
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: isMobile ? "center" : "flex-end",
                      py: isMobile ? "var(--default-gap)" : "var(--double-gap)",
                    }}
                  >
                    <Typography variant={isMobile ? "h5" : "h4"}>Invoice</Typography>
                  </Box>

                  {/* Main Form Fields - Responsive Grid */}
                  <Grid2 container spacing={isMobile ? 3 : 4}>
                    {/* Left Column - Customer & Project Info */}
                    <Grid2 size={isMobile ? 12 : 6}>
                      <Box sx={{ display: "flex", flexDirection: "column", gap: isMobile ? "var(--default-gap)" : "var(--double-gap)" }}>
                        {/* Customer Section */}
                        <Box>
                          {!isViewMode && <FormSelect control={control} name="customerId" label="Customer" addItem={false} menuTitle="Choose customer" menuItems={customers.docs.map((customer) => ({ label: customer.name, value: customer.id }))} size="small" />}
                          {customer && watch("customer") ? (
                            <Box sx={{ mt: 2, p: 2, backgroundColor: "grey.50", borderRadius: 1 }}>
                              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                Customer:
                              </Typography>
                              <Typography variant="body1" sx={{ fontWeight: 500 }}>
                                {customer?.name}
                              </Typography>
                              <Typography variant="body2">{customer?.address}</Typography>
                            </Box>
                          ) : null}
                        </Box>

                        {/* Project & Attention Section */}
                        <Box sx={{ display: "flex", flexDirection: "column", gap: "var(--half-gap)" }}>
                          <FormSelect
                            control={control}
                            name="projectId"
                            label="Project"
                            placeHolder="Choose a project..."
                            addItem={true}
                            menuTitle="Choose a project"
                            menuItems={projects.map((project) => ({ label: project.name, value: project.id }))}
                            handleAddItem={handleAddProject}
                            labelArriangment={isViewMode ? "horizontal" : "vertical"}
                            viewMode={isViewMode}
                          />

                          {watch("attention.name") && <FormInputBox control={control} name="attention.name" label="Attention" placeHolder="Enter Attention" size="small" labelArriangment={isViewMode ? "horizontal" : "vertical"} viewMode={isViewMode} />}
                          {watch("attention.phoneNumber") && <FormInputBox control={control} name="attention.phoneNumber" label="Mobile" placeHolder="Enter Mobile Number" size="small" labelArriangment={isViewMode ? "horizontal" : "vertical"} viewMode={isViewMode} />}
                        </Box>

                        {/* Delivery To Section */}
                        {watch("deliveryTo") && <FormInputBox control={control} name="deliveryTo" label="Delivery To" placeHolder="Enter Delivery Location" size="small" labelArriangment={isViewMode ? "horizontal" : "vertical"} viewMode={isViewMode} />}
                      </Box>
                    </Grid2>

                    {/* Right Column - Document Details */}
                    <Grid2 size={isMobile ? 12 : 6}>
                      <Box sx={{ display: "flex", flexDirection: "column", gap: "var(--half-gap)" }}>
                        <FormInputBox control={control} name="gstRegNo" label="GST REG. No." placeHolder="Enter GST Reg No" size="small" labelArriangment={isViewMode === true ? "horizontal" : "vertical"} viewMode={isViewMode} />
                        <FormInputBox control={control} name="date" label="Date" type="date" size="small" labelArriangment={isViewMode === true ? "horizontal" : "vertical"} viewMode={isViewMode} />
                        {watch("doNo") && <FormInputBox control={control} name="doNo" label="DO No." placeHolder="Enter Delivery Order No" size="small" labelArriangment={isViewMode === true ? "horizontal" : "vertical"} viewMode={isViewMode} />}
                        {watch("referenceNo") && <FormInputBox control={control} name="referenceNo" label="Ref. No." placeHolder="Enter Our Reference No" size="small" labelArriangment={isViewMode === true ? "horizontal" : "vertical"} viewMode={isViewMode} />}
                        {watch("poNo") && <FormInputBox control={control} name="poNo" label="Your PO No." placeHolder="Enter PO No" size="small" labelArriangment={isViewMode === true ? "horizontal" : "vertical"} viewMode={isViewMode} />}
                      </Box>
                    </Grid2>
                  </Grid2>

                  {/* Items Table */}
                  <Box
                    sx={{
                      mt: 5,
                      mb: 1,
                      width: "100%",
                      overflow: "hidden", // Prevent container from expanding beyond viewport
                    }}
                  >
                    <Table key={JSON.stringify(fields)} columns={columns} data={[...fields]} isNoSelectionColumn={true} />
                  </Box>

                  {/* Add Item Button */}
                  {!isViewMode && (
                    <Box sx={{ display: "flex", justifyContent: "flex-start", mt: 1 }}>
                      <Button variant="contained" color="primary" onClick={() => addNewLine()} size="small">
                        Add Item
                      </Button>
                    </Box>
                  )}

                  {/* Totals Section - Responsive */}
                  {watchedItems && watchedItems.length > 0 && (
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: isMobile ? "center" : "flex-end",
                        mt: 2,
                      }}
                    >
                      <Box
                        sx={{
                          width: isMobile ? "100%" : 300,
                          borderRadius: 2,
                          boxShadow: 1,
                          backgroundColor: "#f7f7f7",
                          padding: "1rem",
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.5rem",
                        }}
                      >
                        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                          <Typography variant="body2">SUBTOTAL</Typography>
                          <Typography fontWeight="bold">SGD {subtotal.toFixed(2)}</Typography>
                        </Box>
                        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                          <Typography variant="body2">TOTAL TAX</Typography>
                          <Typography>SGD {totalTax.toFixed(2)}</Typography>
                        </Box>
                        <Divider />
                        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                          <Typography variant="body2" fontWeight="bold">
                            TOTAL AMOUNT
                          </Typography>
                          <Typography fontWeight="bold">SGD {total.toFixed(2)}</Typography>
                        </Box>
                      </Box>
                    </Box>
                  )}
                  {itemsError && <Alert severity="error">{`${itemsError}`}</Alert>}

                  {/* Additional Fields - Half Page Width */}
                  <Grid2 container spacing={isMobile ? 3 : 2} justifyContent="flex-start">
                    <Grid2 size={isMobile ? 12 : 6}>
                      <Box sx={{ display: "flex", flexDirection: "column", gap: "var(--half-gap)" }}>
                        <FormInputBox control={control} name="dueDate" label="Due Date" type="date" size="small" labelArriangment={isViewMode ? "horizontal" : "vertical"} viewMode={isViewMode} />
                        <FormTextArea control={control} name="note" label="Note" placeHolder="Enter note..." rows={3} labelArriangment={isViewMode ? "horizontal" : "vertical"} viewMode={isViewMode} />
                      </Box>
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
