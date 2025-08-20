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
import { useGetDeliveryOrders } from "../hooks/useGetDeliveryOrders";
import { getDocumentTypeDisplayNameWithDefaults } from "@/helpers/documentTypeHelper";

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
  const { isDocumentLoading, document } = useGetDocument();
  const { methods, onSubmit, editableVisibilityFields, watch, isLoading, isDirty } = useTITemplateHandler();
  const { customers } = useGetCustomers();
  const { addNewLine, control, setValue, customerId, fields, remove, onDocumentCreate, itemsError, isLoading: isDocumentCreationloading, isDirty: isDCretorDisabled } = useTIDocumentCreator();
  const { columns } = useTemplateTableHeader({ viewMode: isViewMode, remove: remove, control, setValue });
  const customer = customers.docs.find((customer) => customer.id === customerId);
  const { contentRef, handlePrint } = usePrintDocumentHandler();
  const { deliveryOrders, isLoading: isDeliveryOrdersLoading } = useGetDeliveryOrders(customerId);
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

  const fetchProjects = async (customerIdFilter?: string) => {
    if (!organizationId) return;

    try {
      const token = await getToken();
      if (!token) return;

      // Add customer filter to the request if customer is selected
      const projectFilters = customerIdFilter ? { ...filters, customerId: customerIdFilter } : filters;

      const response = await request({ path: "/projects", method: "POST" }, { page, limit, search, filters: projectFilters, organizationId }, token);

      if (response.success) {
        console.log("Projects response for customer:", customerIdFilter, response.data);
        setProjects(response.data.docs || []);
      }
    } catch (error) {
      console.error("Error fetching projects:", error);
    }
  };

  // Fetch projects when customer or organization changes
  useEffect(() => {
    if (!organizationId) return;

    // Don't fetch projects while document is still loading to avoid race conditions
    if (isDocumentLoading) {
      console.log("Document still loading, waiting before fetching projects...");
      return;
    }

    if (customerId) {
      console.log("Customer available, fetching projects for customer:", customerId);
      fetchProjects(customerId);
    } else {
      console.log("No customer selected, fetching all projects");
      fetchProjects();
    }
  }, [customerId, organizationId, isDocumentLoading]);
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
        // Refresh projects with customer filter if customer is selected
        await fetchProjects(customerId);
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
        title={document?.name || getDocumentTypeDisplayNameWithDefaults("TI", organization)}
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
                    // Professional invoice styling only in view mode
                    ...(isViewMode && {
                      backgroundColor: "white",
                      minHeight: "297mm", // A4 height
                      maxWidth: "210mm", // A4 width
                      margin: "0 auto",
                      fontFamily: "'Arial', sans-serif",
                      fontSize: "12px",
                      lineHeight: 1.3,
                      color: "#000",
                      "@media print": {
                        padding: "15mm",
                        margin: 0,
                        minHeight: "297mm",
                        maxWidth: "210mm",
                        boxShadow: "none",
                        fontSize: "11px",
                        lineHeight: 1.2,
                        pageBreakInside: "avoid",
                      },
                    }),
                  }}
                >
                  {/* Header Section - Conditional Layout */}
                  {isViewMode ? (
                    /* Professional Invoice Header for View Mode */
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        borderBottom: "2px solid #e0e0e0",
                        paddingBottom: 2,
                        marginBottom: 3,
                      }}
                    >
                      {/* Left Side - Logo */}
                      <Box sx={{ flex: "0 0 auto", maxWidth: "180px" }}>{watch("logo") && <FormImage control={control} name="logo" viewMode={isViewMode} />}</Box>

                      {/* Right Side - Company Info */}
                      <Box sx={{ flex: "1 1 auto", textAlign: "right" }}>
                        {watch("company.name") && (
                          <Typography variant="h6" sx={{ fontWeight: "bold", fontSize: "18px", mb: 0.5 }}>
                            {watch("company.name")}
                          </Typography>
                        )}
                        {watch("company.address") && (
                          <Typography variant="body2" sx={{ fontSize: "12px", mb: 0.5 }}>
                            {watch("company.address")}
                          </Typography>
                        )}
                        {watch("company.phoneNumber") && (
                          <Typography variant="body2" sx={{ fontSize: "12px", mb: 0.5 }}>
                            Tel: {watch("company.phoneNumber")}
                          </Typography>
                        )}
                        {watch("gstRegNo") && (
                          <Typography variant="body2" sx={{ fontSize: "12px" }}>
                            Company & GST Reg No: {watch("gstRegNo")}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  ) : (
                    /* Regular Form Layout for Edit Mode */
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
                          {watch("company.name") && <FormInputBox control={control} label="Company name" name="company.name" placeHolder="Enter Company Name" size="small" labelArriangment="vertical" viewMode={isViewMode} />}
                          {watch("company.address") && <FormInputBox control={control} label="Company address" name="company.address" placeHolder="Enter Company Address" size="small" labelArriangment="vertical" viewMode={isViewMode} />}
                          {watch("company.phoneNumber") && <FormInputBox control={control} label="Company phone number" name="company.phoneNumber" placeHolder="Enter Company Phone Number" size="small" labelArriangment="vertical" viewMode={isViewMode} />}
                        </Box>
                      </Grid2>
                      <Grid2 size={isMobile ? 12 : 4} />
                    </Grid2>
                  )}

                  {/* Invoice Title */}
                  {isViewMode ? (
                    <Box sx={{ textAlign: "center", my: 3 }}>
                      <Typography variant="h4" sx={{ fontWeight: "bold", fontSize: "24px" }}>
                        {getDocumentTypeDisplayNameWithDefaults("TI", organization)}
                      </Typography>
                    </Box>
                  ) : (
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: isMobile ? "center" : "flex-end",
                        py: isMobile ? "var(--default-gap)" : "var(--double-gap)",
                      }}
                    >
                      <Typography variant={isMobile ? "h5" : "h4"}>Invoice</Typography>
                    </Box>
                  )}

                  {/* Customer and Invoice Details Section */}
                  {isViewMode ? (
                    /* Professional Invoice Layout for View Mode */
                    <Box>
                      {/* Customer and Invoice Details */}
                      <Grid2 container spacing={2} sx={{ mb: 2 }}>
                        {/* Left Side - Customer Info */}
                        <Grid2 size={6}>
                          {customer && (
                            <Box>
                              <Typography variant="body1" sx={{ fontWeight: "bold", mb: 0.5, fontSize: "13px" }}>
                                {customer.name}
                              </Typography>
                              <Typography variant="body2" sx={{ fontSize: "11px", mb: 0.3 }}>
                                {customer.address}
                              </Typography>
                              <Typography variant="body2" sx={{ fontSize: "11px", mb: 0.5 }}>
                                Attn: Accounts Dept.
                              </Typography>
                            </Box>
                          )}
                        </Grid2>

                        {/* Right Side - Invoice Details */}
                        <Grid2 size={6}>
                          <Box sx={{ textAlign: "right" }}>
                            <Typography variant="body2" sx={{ fontSize: "11px", mb: 0.3 }}>
                              <strong>Invoice Date</strong>
                            </Typography>
                            <Typography variant="body2" sx={{ fontSize: "11px", mb: 0.8 }}>
                              {watch("date") || new Date().toLocaleDateString("en-GB")}
                            </Typography>

                            <Typography variant="body2" sx={{ fontSize: "11px", mb: 0.3 }}>
                              <strong>Invoice Number</strong>
                            </Typography>
                            <Typography variant="body2" sx={{ fontSize: "11px", mb: 0.8 }}>
                              {watch("invoiceNumber") || `${getDocumentTypeDisplayNameWithDefaults("TI", organization)}${new Date().getFullYear()}${(new Date().getMonth() + 1).toString().padStart(2, "0")}1034`}
                            </Typography>

                            {watch("referenceNo") && (
                              <>
                                <Typography variant="body2" sx={{ fontSize: "11px", mb: 0.3 }}>
                                  <strong>Reference</strong>
                                </Typography>
                                <Typography variant="body2" sx={{ fontSize: "11px", mb: 0.8 }}>
                                  {watch("referenceNo")}
                                </Typography>
                              </>
                            )}

                            {watch("doNo") && (
                              <Typography variant="body2" sx={{ fontSize: "11px" }}>
                                (DO{watch("doNo")} 2xAF100 1st mth)
                              </Typography>
                            )}
                          </Box>
                        </Grid2>
                      </Grid2>
                    </Box>
                  ) : (
                    /* Regular Form Layout for Edit Mode */
                    <Grid2 container spacing={isMobile ? 3 : 4}>
                      {/* Left Column - Customer & Project Info */}
                      <Grid2 size={isMobile ? 12 : 6}>
                        <Box sx={{ display: "flex", flexDirection: "column", gap: isMobile ? "var(--default-gap)" : "var(--double-gap)" }}>
                          {/* Customer Section */}
                          <Box>
                            {!isViewMode && <FormSelect control={control} name="customerId" label="Customer" addItem={false} menuTitle="Choose customer" menuItems={customers.docs.map((customer) => ({ label: customer.name, value: customer.id }))} size="small" disabled={true} />}
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
                          <FormInputBox control={control} name="gstRegNo" label="GST REG. No." placeHolder="Enter GST Reg No" size="small" labelArriangment={isViewMode ? "horizontal" : "vertical"} viewMode={isViewMode} />
                          <FormInputBox control={control} name="date" label="Date" type="date" size="small" labelArriangment={isViewMode ? "horizontal" : "vertical"} viewMode={isViewMode} />
                          {watch("doNo") && (
                            <FormSelect
                              control={control}
                              name="doNo"
                              label="DO No."
                              placeHolder="Choose Delivery Order"
                              menuTitle="Choose Delivery Order"
                              menuItems={deliveryOrders.map((order) => ({
                                label: `${order.doNo} (${order.name}) - ${order.status}`,
                                value: order.doNo,
                              }))}
                              size="small"
                              labelArriangment={isViewMode ? "horizontal" : "vertical"}
                              viewMode={isViewMode}
                              disabled={isDeliveryOrdersLoading || deliveryOrders.length === 0}
                            />
                          )}
                          {watch("referenceNo") && <FormInputBox control={control} name="referenceNo" label="Ref. No." placeHolder="Enter Our Reference No" size="small" labelArriangment={isViewMode ? "horizontal" : "vertical"} viewMode={isViewMode} />}
                          {watch("poNo") && <FormInputBox control={control} name="poNo" label="Your PO No." placeHolder="Enter PO No" size="small" labelArriangment={isViewMode ? "horizontal" : "vertical"} viewMode={isViewMode} />}
                        </Box>
                      </Grid2>
                    </Grid2>
                  )}

                  {/* Items Table */}
                  <Box
                    sx={{
                      mt: 3,
                      mb: 2,
                      width: "100%",
                      overflow: isViewMode ? "visible" : "hidden",
                      // Professional table styling for view mode
                      ...(isViewMode && {
                        "& .MuiTable-root": {
                          border: "1px solid #000",
                          borderCollapse: "collapse",
                          fontSize: "12px",
                          minWidth: "100%",
                          maxWidth: "100%",
                          tableLayout: "fixed",
                        },
                        "& .MuiTableHead-root": {
                          backgroundColor: "#f5f5f5",
                        },
                        "& .MuiTableCell-root": {
                          border: "1px solid #000",
                          padding: "8px 4px",
                          fontSize: "12px",
                          lineHeight: 1.2,
                          verticalAlign: "top",
                          wordWrap: "break-word",
                          overflow: "hidden",
                        },
                        "& .MuiTableCell-head": {
                          fontWeight: "bold",
                          backgroundColor: "#f5f5f5",
                          textAlign: "center",
                        },
                        "@media print": {
                          "& .MuiTable-root": {
                            fontSize: "10px",
                            pageBreakInside: "auto",
                          },
                          "& .MuiTableCell-root": {
                            padding: "4px 2px",
                            fontSize: "10px",
                          },
                        },
                      }),
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

                  {/* Totals Section */}
                  {watchedItems && watchedItems.length > 0 && (
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "flex-end",
                        mt: 3,
                      }}
                    >
                      {isViewMode ? (
                        /* Professional Totals for View Mode */
                        <Box sx={{ minWidth: 250, maxWidth: 300 }}>
                          <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.3, borderBottom: "1px solid #e0e0e0" }}>
                            <Typography variant="body2" sx={{ fontSize: "11px" }}>
                              Subtotal
                            </Typography>
                            <Typography variant="body2" sx={{ fontSize: "11px" }}>
                              {subtotal.toFixed(2)}
                            </Typography>
                          </Box>
                          <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.3, borderBottom: "2px solid #000", mb: 0.5 }}>
                            <Typography variant="body2" sx={{ fontSize: "10px", fontWeight: "bold", lineHeight: 1.2 }}>
                              TOTAL LOCAL SUPPLY OF GOODS
                              <br />
                              AND SERVICES 9%
                            </Typography>
                            <Typography variant="body2" sx={{ fontSize: "11px", fontWeight: "bold" }}>
                              {totalTax.toFixed(2)}
                            </Typography>
                          </Box>
                          <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.5 }}>
                            <Typography variant="body1" sx={{ fontSize: "12px", fontWeight: "bold" }}>
                              TOTAL SGD
                            </Typography>
                            <Typography variant="body1" sx={{ fontSize: "12px", fontWeight: "bold" }}>
                              {total.toFixed(2)}
                            </Typography>
                          </Box>
                        </Box>
                      ) : (
                        /* Regular Totals for Edit Mode */
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
                      )}
                    </Box>
                  )}
                  {itemsError && <Alert severity="error">{`${itemsError}`}</Alert>}

                  {/* Footer Section */}
                  {isViewMode ? (
                    /* Professional Footer for View Mode */
                    <Box sx={{ mt: 2 }}>
                      {/* Due Date */}
                      <Typography variant="body1" sx={{ fontSize: "12px", fontWeight: "bold", mb: 1 }}>
                        Due Date: {watch("dueDate") || "30 Nov 2024"}
                      </Typography>

                      {/* Payment Instructions */}
                      <Typography variant="body2" sx={{ fontSize: "10px", mb: 0.3, lineHeight: 1.3 }}>
                        All Cheque should be crossed and made payable to: {watch("company.name") || "Your Company Name"}
                      </Typography>
                      <Typography variant="body2" sx={{ fontSize: "10px", mb: 0.2, lineHeight: 1.3 }}>
                        By Bank Transfer: Standard Chartered Bank
                      </Typography>
                      <Typography variant="body2" sx={{ fontSize: "10px", mb: 0.2, lineHeight: 1.3 }}>
                        Branch: 12 Marina Boulevard, Marina Bay Financial Centre Tower 1
                      </Typography>
                      <Typography variant="body2" sx={{ fontSize: "10px", mb: 0.2, lineHeight: 1.3 }}>
                        Bank Branch No.: 9496-007 Swift Code: SCBLSG22
                      </Typography>
                      <Typography variant="body2" sx={{ fontSize: "10px", mb: 0.2, lineHeight: 1.3 }}>
                        Bank Account No.: 07-1-005302-9
                      </Typography>
                      <Typography variant="body2" sx={{ fontSize: "10px", mb: 1, lineHeight: 1.3 }}>
                        PayNow to UEN: {watch("gstRegNo") || "200303416N"}
                      </Typography>

                      {/* Note */}
                      {watch("note") && (
                        <Typography variant="body2" sx={{ fontSize: "10px", mb: 1, lineHeight: 1.3 }}>
                          {watch("note")}
                        </Typography>
                      )}

                      {/* Computer Generated Notice */}
                      <Typography variant="body2" sx={{ fontSize: "9px", fontStyle: "italic", textAlign: "center", mt: 2 }}>
                        This is a computer-generated document, no signature is required
                      </Typography>
                    </Box>
                  ) : (
                    /* Regular Form Layout for Edit Mode */
                    <Grid2 container spacing={isMobile ? 3 : 2} justifyContent="flex-start">
                      <Grid2 size={isMobile ? 12 : 6}>
                        <Box sx={{ display: "flex", flexDirection: "column", gap: "var(--half-gap)" }}>
                          <FormInputBox control={control} name="dueDate" label="Due Date" type="date" size="small" labelArriangment={isViewMode ? "horizontal" : "vertical"} viewMode={isViewMode} />
                          <FormTextArea control={control} name="note" label="Note" placeHolder="Enter note..." rows={3} labelArriangment={isViewMode ? "horizontal" : "vertical"} viewMode={isViewMode} />
                        </Box>
                      </Grid2>
                    </Grid2>
                  )}
                </Box>
              </form>
            )}
          </TemplatePaper>
        </Grid2>
      </Grid2>
    </Box>
  );
}
