import React, { useState } from "react";
import DocumentNameHeader from "./DocumentNameHeader";
import { Alert, Box, Button, Divider, Grid2, Typography, useTheme, useMediaQuery } from "@mui/material";
import TemplatePaper from "./TemplatePaper";
import FormImage from "@/form-components/FormImage";
import FormInputBox from "@/form-components/FormInputBox";
import FormSelect from "@/form-components/FormSelect";
import { useGetCustomers } from "../hooks/useGetCustomers";
import Table from "@/components/Table";
import DocumentCustomizer from "./DocumentCustomizer";
import useRDOTableHeader from "../hooks/useTemplateTableHeader";
import SignatureDialog from "./SignatureDialog";
import useGetDocument from "../hooks/useGetDocument";
import DocumentSkeleton from "./DocumentSkeleton";
import usePrintDocumentHandler from "../hooks/usePrintDocumentHandler";
import { useParams, usePathname } from "next/navigation";
import useRDOTemplateHandler from "../hooks/useRDOTemplateHandler";
import useRDODocumentCreator from "../hooks/useRDODocumentCreator";

interface Props {
  viewMode: boolean;
}

export default function ReturnDeliveryOrderTemplate(props: Props) {
  const { documentId } = useParams();
  const pathname = usePathname();
  const isEditPath = pathname.includes("edit");
  const { viewMode = false } = props;
  const [isViewMode, toggleViewMode] = useState(viewMode);
  const [isToolBarOpen, toggleToolbar] = useState(false);
  const { isDocumentLoading, document } = useGetDocument();
  const { methods, onSubmit, editableVisibilityFields, watch, isLoading, isDirty } = useRDOTemplateHandler();
  const { customers } = useGetCustomers();
  const { addNewLine, control, companyName, setValue, customerId, fields, remove, onDocumentCreate, itemsError, isLoading: isDocumentCreationloading, isDirty: isDCretorDisabled } = useRDODocumentCreator();
  const { columns } = useRDOTableHeader({ viewMode: isViewMode, remove: remove, control, setValue });
  const customer = customers.docs.find((customer) => customer.id === customerId);
  const { contentRef, handlePrint } = usePrintDocumentHandler();

  // Mobile responsiveness
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  return (
    <Box sx={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", gap: "var(--default-gap)", overflow: "hidden" }}>
      <DocumentNameHeader
        primaryActionLoading={isLoading}
        secondaryActionLoading={isDocumentCreationloading}
        title="Return Delivery Order"
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
        currentDocumentId={(document as any)?.id}
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
                    <Typography variant={isMobile ? "h5" : "h4"}>Return Delivery Order</Typography>
                  </Box>

                  {/* Main Form Fields - Responsive Grid */}
                  <Grid2 container spacing={isMobile ? 3 : 4}>
                    {/* Left Column - Customer & Attention Info */}
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

                        {/* Attention Section */}
                        <Box sx={{ display: "flex", flexDirection: "column", gap: "var(--half-gap)" }}>
                          {watch("attention.name") && <FormInputBox control={control} name="attention.name" label="Attention" placeHolder="Enter Attention" size="small" labelArriangment={isViewMode ? "horizontal" : "vertical"} viewMode={isViewMode} />}
                          {watch("attention.phoneNumber") && <FormInputBox control={control} name="attention.phoneNumber" label="Mobile" placeHolder="Enter Mobile Number" size="small" labelArriangment={isViewMode ? "horizontal" : "vertical"} viewMode={isViewMode} />}
                        </Box>

                        {/* Collect From Section */}
                        {watch("collectFrom") && <FormInputBox control={control} name="collectFrom" label="Collect From" placeHolder="Enter Collection Location" size="small" labelArriangment={isViewMode ? "horizontal" : "vertical"} viewMode={isViewMode} />}
                      </Box>
                    </Grid2>

                    {/* Right Column - Document Details */}
                    <Grid2 size={isMobile ? 12 : 6}>
                      <Box sx={{ display: "flex", flexDirection: "column", gap: "var(--half-gap)" }}>
                        <FormInputBox control={control} name="gstRegNo" label="GST REG. No." placeHolder="Enter GST Reg No" size="small" labelArriangment={isViewMode === true ? "horizontal" : "vertical"} viewMode={isViewMode} />
                        <FormInputBox control={control} name="date" label="Date" type="date" size="small" labelArriangment={isViewMode === true ? "horizontal" : "vertical"} viewMode={isViewMode} />
                        {watch("returnOrderNo") && <FormInputBox control={control} name="returnOrderNo" label="Return Order No." placeHolder="Enter Return Order No" size="small" labelArriangment={isViewMode === true ? "horizontal" : "vertical"} viewMode={isViewMode} />}
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
                    <Table columns={columns} data={fields} isNoSelectionColumn={true} />
                  </Box>
                  {itemsError && <Alert severity="error">{`${itemsError}`}</Alert>}

                  {/* Add Item Button */}
                  {!isViewMode && !isEditPath && (
                    <Box sx={{ display: "flex", justifyContent: "flex-start", mt: 1, mb: 5 }}>
                      <Button variant="contained" color="primary" onClick={() => addNewLine()} size="small">
                        Add Item
                      </Button>
                    </Box>
                  )}

                  {/* Signature Section - Responsive */}
                  {!isEditPath && (
                    <Grid2 container spacing={isMobile ? 3 : 1} mt={4}>
                      <Grid2 size={isMobile ? 12 : 6}>
                        <Box sx={{ display: "flex", flexDirection: "column", alignItems: isMobile ? "center" : "flex-start", gap: 2 }}>
                          <Typography variant="body1">For {companyName}</Typography>
                          <SignatureDialog label="company" name="signature.company" viewMode={isViewMode} control={control} />
                          <Divider
                            sx={{
                              borderBottomWidth: 2,
                              borderColor: "black",
                              my: 2,
                              width: isMobile ? "200px" : "260px",
                              mx: isMobile ? "auto" : "20px",
                            }}
                          />
                        </Box>
                      </Grid2>
                      <Grid2 size={isMobile ? 12 : 6}>
                        <Box sx={{ display: "flex", flexDirection: "column", alignItems: isMobile ? "center" : "flex-start", gap: 2 }}>
                          <Typography variant="body1" sx={{ textAlign: isMobile ? "center" : "left" }}>
                            Goods Received in Good Order & Condition
                          </Typography>
                          <SignatureDialog label="customer" name="signature.customer" viewMode={isViewMode} control={control} />
                          <Divider
                            sx={{
                              borderBottomWidth: 2,
                              borderColor: "black",
                              my: 2,
                              width: isMobile ? "200px" : "260px",
                              mx: isMobile ? "auto" : "20px",
                            }}
                          />
                          <Typography variant="body1" sx={{ textAlign: isMobile ? "center" : "left" }}>
                            Customer&apos;s Signature & Company Stamp
                          </Typography>
                          <Typography variant="body1">Date:</Typography>
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
