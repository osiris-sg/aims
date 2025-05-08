import React, { useState } from "react";
import DocumentNameHeader from "./DocumentNameHeader";
import { Alert, Box, Button, Divider, Grid2, Typography } from "@mui/material";
import TemplatePaper from "./TemplatePaper";
import FormImage from "@/form-components/FormImage";
import FormInputBox from "@/form-components/FormInputBox";
import FormSelect from "@/form-components/FormSelect";
import { useGetCustomers } from "../hooks/useGetCustomers";
import Table from "@/components/Table";
import DocumentCustomizer from "./DocumentCustomizer";
import useTemplateTableHeader from "../hooks/useTemplateTableHeader";
import SignatureDialog from "./SignatureDialog";
import useGetDocument from "../hooks/useGetDocument";
import DocumentSkeleton from "./DocumentSkeleton";
import usePrintDocumentHandler from "../hooks/usePrintDocumentHandler";
import { useParams } from "next/navigation";
import useDOTemplateHandler from "../hooks/useDOTemplateHandler";
import useDODocumentCreator from "../hooks/useDODocumentCreator";

interface Props {
  viewMode: boolean;
}
export default function DeliveryOrderTemplate(props: Props) {
  const { documentId } = useParams();
  const { viewMode = false } = props;
  const [isViewMode, toggleViewMode] = useState(viewMode);
  const [isToolBarOpen, toggleToolbar] = useState(false);
  const { isDocumentLoading } = useGetDocument();
  const { methods, onSubmit, editableVisibilityFields, watch, isLoading, isDirty } = useDOTemplateHandler();
  const { customers } = useGetCustomers();
  const { addNewLine, control, companyName, setValue, customerId, fields, remove, onDocumentCreate, itemsError, isLoading: isDocumentCreationloading, isDirty: isDCretorDisabled } = useDODocumentCreator();
  const { columns } = useTemplateTableHeader({ viewMode: isViewMode, remove: remove, control, setValue });
  const customer = customers.docs.find((customer) => customer.id === customerId);
  const { contentRef, handlePrint } = usePrintDocumentHandler();

  return (
    <Box sx={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", gap: "var(--default-gap)", overflow: "hidden" }}>
      <DocumentNameHeader
        primaryActionLoading={isLoading}
        secondaryActionLoading={isDocumentCreationloading}
        title="Delivery Order"
        description="This document does not support uploading of template"
        viewMode={isViewMode}
        toggleViewMode={(value) => toggleViewMode(value)}
        onPrimaryActionSubmit={onSubmit}
        onSecondaryActionSubmit={onDocumentCreate}
        primaryActionDisabled={!isDirty}
        secondaryActionDisabled={!isDCretorDisabled || isDirty}
        onPrint={handlePrint}
        documentEditMode={!!documentId}
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
                <Box sx={{ display: "flex", flexDirection: "column", padding: "var(--double-gap)" }}>
                  <Grid2 container spacing={1}>
                    <Grid2 size={4}>{watch("logo") && <FormImage control={control} name="logo" viewMode={isViewMode} />}</Grid2>
                    <Grid2 size={4}>
                      <Box sx={{ display: "flex", flexDirection: "column", gap: "var(--half-gap)", textAlign: "center", alignItems: isViewMode ? "center" : "inherit" }}>
                        {watch("company.name") && <FormInputBox control={control} label={isViewMode ? undefined : "Company name"} name="company.name" placeHolder="Enter Company Name" size="small" labelArriangment={isViewMode ? "horizontal" : "vertical"} viewMode={isViewMode} />}
                        {watch("company.address") && <FormInputBox control={control} label={isViewMode ? undefined : "Company address"} name="company.address" placeHolder="Enter Company Address" size="small" labelArriangment={isViewMode ? "horizontal" : "vertical"} viewMode={isViewMode} />}
                        {watch("company.phoneNumber") && (
                          <FormInputBox control={control} label={isViewMode ? undefined : "Company phone number"} name="company.phoneNumber" placeHolder="Enter Company Phone Number" size="small" labelArriangment={isViewMode ? "horizontal" : "vertical"} viewMode={isViewMode} />
                        )}
                      </Box>
                    </Grid2>
                    <Grid2 size={4} />
                  </Grid2>
                  <Grid2 container spacing={1}>
                    <Grid2 size={6} />
                    <Grid2 size={6}>
                      <Typography variant="h4" sx={{ py: "var(--double-gap)" }}>
                        Delivery Order
                      </Typography>
                    </Grid2>
                  </Grid2>
                  <Grid2 container spacing={4}>
                    <Grid2 size={6}>
                      <Grid2 container spacing={4}>
                        <Grid2 size={12}>
                          {!isViewMode && <FormSelect control={control} name="customerId" label="Customer" addItem={false} menuTitle="Choose customer" menuItems={customers.docs.map((customer) => ({ label: customer.name, value: customer.id }))} size="small" />}
                          {customer && watch("customer") ? (
                            <Grid2 container mt={2}>
                              <Grid2 size={3}>
                                <Typography variant="body1">Customer :</Typography>
                              </Grid2>
                              <Grid2 size={9}>
                                <Box>
                                  <Typography variant="body1">{customer?.name}</Typography>
                                  <Typography variant="body1">{customer?.address}</Typography>
                                </Box>
                              </Grid2>
                            </Grid2>
                          ) : null}
                        </Grid2>
                        <Grid2 size={12}>
                          <Box sx={{ display: "flex", flexDirection: "column", gap: "var(--half-gap)" }}>
                            {watch("attention.name") && <FormInputBox control={control} name="attention.name" label="Attention" placeHolder="Enter Attention" size="small" labelArriangment={isViewMode ? "horizontal" : "vertical"} viewMode={isViewMode} />}
                            {watch("attention.phoneNumber") && <FormInputBox control={control} name="attention.phoneNumber" label="Mobile" placeHolder="Enter Mobile Number" size="small" labelArriangment={isViewMode ? "horizontal" : "vertical"} viewMode={isViewMode} />}
                          </Box>
                        </Grid2>
                        <Grid2 size={12}>{watch("deliveryTo") && <FormInputBox control={control} name="deliveryTo" label="Delivery To" placeHolder="Enter Delivery Location" size="small" labelArriangment={isViewMode ? "horizontal" : "vertical"} viewMode={isViewMode} />}</Grid2>
                      </Grid2>
                    </Grid2>
                    <Grid2 size={6}>
                      <Box sx={{ display: "flex", flexDirection: "column", gap: "var(--half-gap)" }}>
                        <FormInputBox control={control} name="gstRegNo" label="GST REG. No." placeHolder="Enter GST Reg No" size="small" labelArriangment={isViewMode === true ? "horizontal" : "vertical"} viewMode={isViewMode} />
                        <FormInputBox control={control} name="date" label="Date" type="date" size="small" labelArriangment={isViewMode === true ? "horizontal" : "vertical"} viewMode={isViewMode} />
                        {watch("doNo") && <FormInputBox control={control} name="doNo" label="DO No." placeHolder="Enter Delivery Order No" size="small" labelArriangment={isViewMode === true ? "horizontal" : "vertical"} viewMode={isViewMode} />}
                        {watch("referenceNo") && <FormInputBox control={control} name="referenceNo" label="Ref. No." placeHolder="Enter Our Reference No" size="small" labelArriangment={isViewMode === true ? "horizontal" : "vertical"} viewMode={isViewMode} />}
                        {watch("poNo") && <FormInputBox control={control} name="poNo" label="Your PO No." placeHolder="Enter PO No" size="small" labelArriangment={isViewMode === true ? "horizontal" : "vertical"} viewMode={isViewMode} />}
                      </Box>
                    </Grid2>
                  </Grid2>
                  <Box mt={5} mb={1}>
                    <Table columns={columns} data={fields} isNoSelectionColumn={true} />
                  </Box>
                  {itemsError && <Alert severity="error">{`${itemsError}`}</Alert>}

                  {!isViewMode && (
                    <Box sx={{ display: "flex", justifyContent: "flex-start", mt: 1, mb: 5 }}>
                      <Button variant="contained" color="primary" onClick={() => addNewLine()} size="small" disabled={!!documentId}>
                        Add Item
                      </Button>
                    </Box>
                  )}
                  <Grid2 container spacing={1} mt={4}>
                    <Grid2 size={6}>
                      <Typography variant="body1">For {companyName}</Typography>
                      <SignatureDialog label="company" name="signature.company" viewMode={isViewMode} control={control} />
                      <Divider sx={{ borderBottomWidth: 2, borderColor: "black", my: 2, width: "260px", mx: "20px" }} />
                    </Grid2>
                    <Grid2 size={6}>
                      <Typography variant="body1">Goods Received in Good Order & Condition</Typography>
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
