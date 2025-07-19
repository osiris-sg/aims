import React, { useState, useEffect } from "react";
import DocumentNameHeader from "./DocumentNameHeader";
import { Alert, Box, Button, Divider, Grid2, Typography, useTheme, useMediaQuery, IconButton } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useWatch } from "react-hook-form";
import TemplatePaper from "./TemplatePaper";
import FormImage from "@/form-components/FormImage";
import { request } from "@/helpers/request";
import FormInputBox from "@/form-components/FormInputBox";
import FormSelect from "@/form-components/FormSelect";
import { useGetCustomers } from "../hooks/useGetCustomers";
import { useGetSiteOffices } from "../hooks/useGetSiteOffices";
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
import { usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import WebcamComponent from "./WebCam";
import Dialog from "@mui/material/Dialog";
import Image from "next/image";

interface Props {
  viewMode: boolean;
}

// Document type for captured images
interface DocumentWithCapturedImages {
  config?: {
    capturedImages?: string[];
  };
}

export default function DeliveryOrderTemplate(props: Props) {
  const { documentId } = useParams();
  const pathname = usePathname();
  const isEditPath = pathname.includes("edit");
  const { viewMode = false } = props;
  const [isViewMode, toggleViewMode] = useState(viewMode);
  const [isToolBarOpen, toggleToolbar] = useState(false);
  const { isDocumentLoading, document } = useGetDocument();
  const { methods, onSubmit, editableVisibilityFields, watch, isLoading, isDirty, errors } = useDOTemplateHandler();
  const { customers } = useGetCustomers();
  const { addNewLine, control, companyName, setValue, customerId, fields, remove, onDocumentCreate, itemsError, isLoading: isDocumentCreationloading, isDirty: isDCretorDisabled } = useDODocumentCreator();
  const { columns } = useTemplateTableHeader({ viewMode: isViewMode, remove: remove, control, setValue });
  const customer = customers.docs.find((customer) => customer.id === customerId);
  const { contentRef, handlePrint } = usePrintDocumentHandler();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const [isWebcamOpen, setWebcamOpen] = useState(false);

  // Mobile responsiveness
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  // Watch for captured images in form state (array)
  const capturedImages = useWatch({ control, name: "capturedImages" }) || [];

  // Handle loading captured images from existing document
  useEffect(() => {
    const docWithImages = document as DocumentWithCapturedImages;
    if (documentId && docWithImages?.config?.capturedImages) {
      setValue("capturedImages", docWithImages.config.capturedImages, { shouldDirty: false });
    }
  }, [documentId, document, setValue]);

  // Site Offices fetching logic
  const { siteOffices, fetchSiteOffices } = useGetSiteOffices();
  // Calculate totals using useWatch for real-time updates
  const watchedItems = useWatch({ control, name: "customerId" });
  console.log("Watched items:", watchedItems);
  useEffect(() => {
    if (watchedItems) {
      fetchSiteOffices(watchedItems);
    }
    console.log("Site offices fetched:", siteOffices);
  }, [fetchSiteOffices, watchedItems]);
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
              <>
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
                      <Typography variant={isMobile ? "h5" : "h4"}>Delivery Order</Typography>
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
                          {watch("deliveryTo") && (
                            <FormSelect
                              control={control}
                              name="deliveryTo"
                              label="Delivery To"
                              menuTitle="Choose delivery location"
                              menuItems={siteOffices.map((office) => ({
                                label: `${office.name} (${office.address || ""})`,
                                value: office.id,
                              }))}
                              size="small"
                              labelArriangment={isViewMode ? "horizontal" : "vertical"}
                              viewMode={isViewMode}
                            />
                          )}
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
                    {itemsError && <Alert severity="error">{`${itemsError}`}</Alert>}

                    {/* Add Item Button */}
                    {!isViewMode && !isEditPath && (
                      <Box sx={{ display: "flex", justifyContent: "flex-start", mt: 1, mb: 5, gap: 2, flexWrap: "wrap" }}>
                        <Button variant="contained" color="primary" onClick={() => addNewLine()} size="small">
                          Add Item
                        </Button>
                        <Button
                          variant="outlined"
                          color="secondary"
                          onClick={() => setWebcamOpen(true)}
                          size="small"
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1,
                          }}
                        >
                          Capture Images
                        </Button>
                      </Box>
                    )}

                    {/* Validation Errors Display */}
                    {Object.keys(errors || {}).length > 0 && (
                      <Alert severity="error" sx={{ mb: 2 }}>
                        <Typography variant="body2" sx={{ fontWeight: "bold", mb: 1 }}>
                          Form Validation Errors:
                        </Typography>
                        <pre style={{ fontSize: "12px", margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(errors, null, 2)}</pre>
                      </Alert>
                    )}

                    {/* Signature Section - Responsive */}
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

                    {/* Captured Images Section */}
                    {capturedImages.length > 0 && (
                      <Box sx={{ mt: 4, width: "100%" }}>
                        <Typography variant="h6" sx={{ mb: 2, textAlign: isMobile ? "center" : "left" }}>
                          Captured Images
                        </Typography>
                        <Grid2 container spacing={2}>
                          {capturedImages.map((image: string, index: number) => (
                            <Grid2 key={index} size={isMobile ? 12 : 6}>
                              <Box
                                sx={{
                                  position: "relative",
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "center",
                                  p: 2,
                                  border: "1px solid",
                                  borderColor: "grey.300",
                                  borderRadius: 2,
                                  backgroundColor: "grey.50",
                                }}
                              >
                                {/* Delete Button */}
                                <IconButton
                                  onClick={() => {
                                    const updatedImages = capturedImages.filter((_: string, i: number) => i !== index);
                                    setValue("capturedImages", updatedImages, { shouldDirty: true });
                                  }}
                                  sx={{
                                    position: "absolute",
                                    top: 8,
                                    right: 8,
                                    backgroundColor: "rgba(255, 255, 255, 0.9)",
                                    color: "error.main",
                                    "&:hover": {
                                      backgroundColor: "error.main",
                                      color: "white",
                                    },
                                    zIndex: 1,
                                    width: 32,
                                    height: 32,
                                  }}
                                  size="small"
                                >
                                  <CloseIcon fontSize="small" />
                                </IconButton>

                                <Typography variant="body2" sx={{ mb: 1, color: "text.secondary" }}>
                                  Image {index + 1}
                                </Typography>
                                <Image
                                  src={image.startsWith("data:image") ? image : `${process.env.NEXT_PUBLIC_RESOURCE_URL || "https://aims-osiris.s3.ap-southeast-1.amazonaws.com/"}${image}`}
                                  alt={`Captured ${index + 1}`}
                                  width={isMobile ? 300 : 400}
                                  height={300}
                                  style={{
                                    width: "100%",
                                    maxWidth: isMobile ? "300px" : "400px",
                                    height: "auto",
                                    borderRadius: "4px",
                                    boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                                  }}
                                  onError={(e) => {
                                    console.error(`Failed to load image ${index + 1}:`, image);
                                    e.currentTarget.style.display = "none";
                                  }}
                                />
                              </Box>
                            </Grid2>
                          ))}
                        </Grid2>
                      </Box>
                    )}
                  </Box>
                </form>
                <Dialog open={isWebcamOpen} onClose={() => setWebcamOpen(false)} maxWidth="md" fullWidth>
                  <Box p={2}>
                    <WebcamComponent
                      onCapture={(image: string) => {
                        const updatedImages = [...capturedImages, image];
                        setValue("capturedImages", updatedImages, { shouldDirty: true });
                        setWebcamOpen(false);
                      }}
                    />
                    <Button variant="contained" color="secondary" onClick={() => setWebcamOpen(false)} sx={{ mt: 2 }}>
                      Close
                    </Button>
                  </Box>
                </Dialog>
              </>
            )}
          </TemplatePaper>
        </Grid2>
      </Grid2>
    </Box>
  );
}
