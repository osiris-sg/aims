import React, { useState, useEffect } from "react";
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
  const { isDocumentLoading } = useGetDocument();
  const { methods, onSubmit, editableVisibilityFields, watch, isLoading, isDirty } = useQO1TemplateHandler();
  const { customers } = useGetCustomers();
  const { addNewLine, control, companyName, setValue, customerId, projectId, fields, remove, onDocumentCreate, itemsError, isLoading: isDocumentCreationloading, isDirty: isDCretorDisabled } = useQO1DocumentCreator();
  const { columns } = useQO1TemplateTableHeader({ viewMode: isViewMode, remove: remove, control, setValue });
  const customer = customers.docs.find((customer) => customer.id === customerId);
  const { contentRef, handlePrint } = usePrintDocumentHandler();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  // Site Offices fetching logic
  const { siteOffices, fetchSiteOffices } = useGetSiteOffices();
  const selectedCustomerId = watch("customerId");
  const selectedDeliveryToId = watch("deliveryTo");
  const selectedSiteOffice = siteOffices.find((office) => office.id === selectedDeliveryToId);
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

  const fetchProjects = async () => {
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
  };

  useEffect(() => {
    fetchProjects();
  }, [organizationId]);
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
    <Box sx={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", gap: "var(--default-gap)", overflow: "hidden" }}>
      <DocumentNameHeader
        primaryActionLoading={isLoading}
        secondaryActionLoading={isDocumentCreationloading}
        title="Quotation 1"
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
                <Box sx={{ display: "flex", flexDirection: "column", padding: "var(--double-gap)" }}>
                  <Grid2 container spacing={1}>
                    <Grid2 size={4}>{watch("logo") && <FormImage control={control} name="logo" viewMode={isViewMode} />}</Grid2>
                    <Grid2 size={4}></Grid2>
                    <Grid2 size={4} />
                  </Grid2>
                  <Grid2 container spacing={1}>
                    <Grid2 size={6} />
                    <Grid2 size={6}>
                      <Typography variant="h4" sx={{ py: "var(--double-gap)" }}>
                        Quotation
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
                            <FormInputBox control={control} name="attention.email" label="Email" placeHolder="Enter Email" size="small" labelArriangment={isViewMode ? "horizontal" : "vertical"} viewMode={isViewMode} />
                          </Box>
                        </Grid2>
                        <Grid2 size={12}>
                          {watch("deliveryTo") && (
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
                          )}
                        </Grid2>
                      </Grid2>
                    </Grid2>
                    <Grid2 size={6}>
                      <Box sx={{ display: "flex", flexDirection: "column", gap: "var(--half-gap)" }}>
                        <FormInputBox control={control} name="quotationNo" label="Quotation No." placeHolder="Enter Quotation No." size="small" labelArriangment="vertical" viewMode={isViewMode} />
                        <FormInputBox control={control} name="quotationDate" label="Quotation Date" placeHolder="Enter Quotation Date" size="small" labelArriangment="vertical" viewMode={isViewMode} />
                        <FormInputBox control={control} name="validityTerm" label="Validity Term" placeHolder="Enter Validity Term" size="small" labelArriangment="vertical" viewMode={isViewMode} />
                        <FormInputBox control={control} name="currency" label="Currency" placeHolder="Enter Currency" size="small" labelArriangment="vertical" viewMode={isViewMode} />
                        <FormInputBox control={control} name="salePerson" label="Sale Person" placeHolder="Enter Sale Person Name" size="small" labelArriangment="vertical" viewMode={isViewMode} />
                        <FormInputBox control={control} name="mobile" label="Mobile" placeHolder="Enter Mobile Number" size="small" labelArriangment="vertical" viewMode={isViewMode} />
                        <FormInputBox control={control} name="date" label="Date" type="date" size="small" labelArriangment={isViewMode === true ? "horizontal" : "vertical"} viewMode={isViewMode} />
                        <FormInputBox control={control} name="salePersonEmail" label="Sales Person Email" placeHolder="Enter Sales Person Email" size="small" labelArriangment="vertical" viewMode={isViewMode} />
                        {watch("doNo") && <FormInputBox control={control} name="doNo" label="DO No." placeHolder="Enter Delivery Order No" size="small" labelArriangment={isViewMode === true ? "horizontal" : "vertical"} viewMode={isViewMode} />}
                        {watch("referenceNo") && <FormInputBox control={control} name="referenceNo" label="Ref. No." placeHolder="Enter Our Reference No" size="small" labelArriangment={isViewMode === true ? "horizontal" : "vertical"} viewMode={isViewMode} />}
                        {watch("poNo") && <FormInputBox control={control} name="poNo" label="Your PO No." placeHolder="Enter PO No" size="small" labelArriangment={isViewMode === true ? "horizontal" : "vertical"} viewMode={isViewMode} />}
                      </Box>
                    </Grid2>
                  </Grid2>
                  <Box mt={5} mb={1}>
                    <Table key={JSON.stringify(fields)} columns={columns} data={[...fields]} isNoSelectionColumn={true} />
                  </Box>
                  {itemsError && <Alert severity="error">{`${itemsError}`}</Alert>}

                  {!isViewMode && !isEditPath && (
                    <Box sx={{ display: "flex", justifyContent: "flex-start", mt: 1, mb: 5 }}>
                      <Button variant="contained" color="primary" onClick={() => addNewLine()} size="small">
                        Add Item
                      </Button>
                    </Box>
                  )}

                  <Box sx={{ display: "flex", flexDirection: "column", gap: "var(--half-gap)", my: 3 }}>
                    <FormTextarea control={control} name="note" label="Note" placeHolder="Enter notes here" rows={4} labelArriangment="vertical" viewMode={isViewMode} />
                    <FormTextarea control={control} name="remarks" label="Remarks" placeHolder="Enter remarks here" rows={4} labelArriangment="vertical" viewMode={isViewMode} />
                    <FormTextarea control={control} name="termsAndConditions" label="Terms and Conditions" placeHolder="Enter terms and conditions here" rows={4} labelArriangment="vertical" viewMode={isViewMode} />
                  </Box>
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
