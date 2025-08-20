/* eslint-disable @typescript-eslint/no-explicit-any */

import { yupResolver } from "@hookform/resolvers/yup";
import { useForm, useFieldArray } from "react-hook-form";
import useDocumentYupSchemaGenerator from "./useDocumentYupSchemaGenerator";
import { useDispatch, useSelector } from "react-redux";
import { selectDocumentCeationStatus, selectDocumentTemplate, selectIsDocumentUpdating } from "@/containers/DocumentsTemplateView/slice/selectors";
import { useDocumentTemplateSlice } from "@/containers/DocumentsTemplateView/slice";
import { useAuth } from "@clerk/nextjs";
import { useEffect, useMemo } from "react";
import { useOrganization } from "@/app/portal/hooks/useOrganization";
import { uploadImage } from "@/helpers/imageUploader";
import { base64ToFile } from "@/helpers/base64ToFile";
import { useParams, useSearchParams } from "next/navigation";
import useGetDocument from "./useGetDocument";

export default function useDODocumentCreator() {
  const documenttemplate = useSelector(selectDocumentTemplate);
  const { documentId } = useParams();
  const dispatch = useDispatch();
  const { actions } = useDocumentTemplateSlice();
  const { getToken } = useAuth();
  const { document } = useGetDocument();
  const { organization } = useOrganization();
  const searchParams = useSearchParams();
  const scannedInventoryId = searchParams.get("scannedInventoryId");

  const defaultValues = useMemo(
    () => ({
      company: { name: "", address: "", phoneNumber: "" },
      customerId: "",
      projectId: "", // added
      items: scannedInventoryId ? [{ inventoryItemId: scannedInventoryId, quantity: 1, description: "" }] : [{ inventoryItemId: "", quantity: 1, description: "" }],
      attention: { name: "", phoneNumber: "" },
      doNo: "",
      referenceNo: "",
      poNo: "",
      deliveryTo: "",
      gstRegNo: "",
      date: "",
      capturedImages: [], // Add captured images field
    }),
    [scannedInventoryId]
  );
  console.log("Document Template:", defaultValues, documenttemplate);

  const schema = useDocumentYupSchemaGenerator(defaultValues, documenttemplate?.config || {});

  const {
    control,
    watch,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isDirty },
  } = useForm<any>({
    defaultValues,
    resolver: yupResolver(schema),
    mode: "onChange",
  });

  // Debug validation errors
  useEffect(() => {
    if (Object.keys(errors).length > 0) {
      console.log("Form validation errors:", errors);
    }
  }, [errors]);

  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: "items",
  });

  // More reliable scannedInventoryId handler using control._formValues
  useEffect(() => {
    if (!scannedInventoryId) return;

    const interval = setInterval(() => {
      const currentItems = control._formValues?.items || [];
      const isAlreadyAdded = currentItems.some((item: any) => item.inventoryItemId === scannedInventoryId);

      if (!isAlreadyAdded) {
        const emptyIndex = currentItems.findIndex((item: any) => !item.inventoryItemId);

        if (emptyIndex !== -1) {
          setValue(`items.${emptyIndex}.inventoryItemId`, scannedInventoryId, { shouldDirty: true, shouldTouch: true });
          setValue(`items.${emptyIndex}.quantity`, 1, { shouldDirty: true, shouldTouch: true });
          setValue(`items.${emptyIndex}.description`, "", { shouldDirty: true, shouldTouch: true });
        } else {
          append({ inventoryItemId: scannedInventoryId, quantity: 1, description: "" }, { shouldFocus: false });
        }
      } else {
        clearInterval(interval);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [scannedInventoryId, control, setValue, append]);

  const isLoading = useSelector(selectIsDocumentUpdating);
  const isDocumentCreated = useSelector(selectDocumentCeationStatus);

  const addNewLine = () => {
    append({ inventoryItemId: "", quantity: 1, description: "" });
  };

  const companyName = watch("company.name");
  const customerId = watch("customerId");
  const projectId = watch("projectId"); // added
  const itemsError = errors?.items?.message;

  // Watch form values for validation
  const watchedValues = watch();

  // Function to check if form is ready for submission
  const isReadyForSubmission = () => {
    const values = watchedValues;

    // Check basic requirements only

    // 1. Must have a customer selected
    if (!values.customerId) {
      return false;
    }

    // 2. Must have at least one item with inventory and quantity
    if (!values.items || values.items.length === 0) {
      return false;
    }

    const validItems = values.items.filter((item: any) => item.inventoryItemId && item.quantity && item.quantity > 0);

    if (validItems.length === 0) {
      return false;
    }

    // 3. Must have both signatures
    const signatures = values.signature;

    if (!signatures) {
      return false;
    }

    const hasCompanySignature = signatures.company && signatures.company.length > 0;
    const hasCustomerSignature = signatures.customer && signatures.customer.length > 0;

    if (!hasCompanySignature || !hasCustomerSignature) {
      return false;
    }

    return true;
  };

  const isFormReadyForSubmission = isReadyForSubmission();

  // Reset the form if a document is successfully created
  useEffect(() => {
    if (isDocumentCreated) {
      reset(defaultValues, {
        keepDirty: false,
        keepTouched: false,
        keepValues: false,
      });
    }
  }, [isDocumentCreated]);

  // Set form values from existing document.config if editing
  useEffect(() => {
    console.log("Document ID:", documentId, "Document Config:", document);
    if (documentId && document?.config) {
      const logoValue = document.config.logo ? [{ data: document.config.logo }] : null;

      // Handle signature data properly
      const signatureData = document.config.signature || {};
      console.log("Signature data from document:", signatureData);

      // Debug items loading
      console.log("Raw items from document.config:", document.config.items);
      const processedItems =
        document.config.items?.map((item: any) => ({
          ...item,
          quantity: item.quantity ?? 1,
        })) || [];
      console.log("Processed items for form:", processedItems);

      reset(
        {
          ...document.config,
          items: processedItems,
          logo: logoValue,
          signature: signatureData, // Ensure signature is properly set
        },
        {
          keepDefaultValues: false,
        }
      );

      // Force field array to sync with the reset items using replace
      // This is more reliable than relying on reset to sync useFieldArray
      if (processedItems.length > 0) {
        replace(processedItems);
        console.log("Replaced field array with", processedItems.length, "items");
      }
      // Also populate company and gstRegNo from document.organization
      if (document?.organization) {
        setValue("company.name", document.organization.name || "", { shouldDirty: true });
        setValue("company.address", document.organization.address || "", { shouldDirty: true });
        setValue("company.phoneNumber", document.organization.phoneNumber || "", { shouldDirty: true });
        setValue("gstRegNo", document.organization.registrationNumber || "", { shouldDirty: true });
      }
    } else if (!documentId && organization?.logo) {
      setValue("logo", [{ data: organization.logo }], { shouldDirty: true });
    }
  }, [documentId, document?.config, document, reset, setValue, document?.organization, organization?.logo]);

  // Debug field array after any changes
  useEffect(() => {
    console.log("Current fields array:", fields);
    console.log("Fields length:", fields.length);
  }, [fields]);

  const onSubmit = async (data: any) => {
    try {
      console.log("Form submission started with data:", data);
      const token = await getToken();
      if (!token) return;

      data.items = data.items.map((item: any) => ({
        ...item,
        quantity: item.quantity ?? 1,
      }));

      let logoKey = "";
      const logoFile = Array.isArray(data.logo) ? data.logo[0] : data.logo;

      if (logoFile) {
        if (typeof logoFile === "string") {
          logoKey = logoFile;
        } else {
          try {
            dispatch(actions.uploadImageStart());
            logoKey = await uploadImage({ blob: logoFile, folderName: "logos", token });
          } catch (err) {
            console.error("Logo upload failed", err);
            throw err;
          } finally {
            dispatch(actions.uploadImageEnd());
          }
        }
      }

      const uploadedSignatures: { company?: string; customer?: string } = {};
      if (data.signature) {
        for (const key of ["company", "customer"] as const) {
          const base64 = data.signature?.[key];
          if (base64?.startsWith("data:image")) {
            const file = base64ToFile(base64, `${key}-signature.png`);
            try {
              dispatch(actions.uploadImageStart());
              const signatureKey = await uploadImage({
                blob: file,
                folderName: "signatures",
                token,
              });
              uploadedSignatures[key] = signatureKey;
            } catch (err) {
              console.error(`Error uploading ${key} signature`, err);
              throw err;
            } finally {
              dispatch(actions.uploadImageEnd());
            }
          } else if (base64) {
            uploadedSignatures[key] = base64;
          }
        }
      }

      // Upload captured images to S3 - preserve existing URLs and upload new base64 images
      const uploadedCapturedImages: string[] = [];
      if (data.capturedImages && Array.isArray(data.capturedImages) && data.capturedImages.length > 0) {
        console.log("Processing captured images:", data.capturedImages.length, "images");
        try {
          dispatch(actions.uploadImageStart());
          for (let i = 0; i < data.capturedImages.length; i++) {
            const image = data.capturedImages[i];
            console.log(`Image ${i + 1}:`, image?.substring(0, 50) + "...");

            if (image?.startsWith("data:image")) {
              // This is a new base64 image - upload it
              console.log(`Uploading new base64 image ${i + 1}`);
              const file = base64ToFile(image, `captured-image-${i + 1}.png`);
              const imageKey = await uploadImage({
                blob: file,
                folderName: "captured-images",
                token,
              });
              uploadedCapturedImages.push(imageKey);
              console.log(`Uploaded image ${i + 1} as:`, imageKey);
            } else if (image && typeof image === "string") {
              // This is an existing S3 URL - preserve it
              console.log(`Preserving existing S3 URL for image ${i + 1}:`, image);
              uploadedCapturedImages.push(image);
            }
          }
          console.log("Final uploaded images array:", uploadedCapturedImages);
        } catch (err) {
          console.error("Error uploading captured images", err);
          throw err;
        } finally {
          dispatch(actions.uploadImageEnd());
        }
      }

      const payload = {
        ...data,
        ...(projectId && projectId.trim() ? { projectId } : {}), // Only include projectId if it's not empty
        logo: logoKey || document?.config.logo,
        signature: uploadedSignatures,
        capturedImages: uploadedCapturedImages, // Add uploaded image URLs
      };

      if (documentId) {
        // If documentId exists, update the document

        dispatch(
          actions.updateDocument({
            id: documentId,
            type: document?.type,
            config: payload,
            token,
            status: "draft",
            customerId: data.customerId,
            ...(projectId && projectId.trim() ? { projectId } : {}), // Only include projectId if it's not empty
          })
        );
      } else {
        // If no documentId, create a new document with timeline
        dispatch(
          actions.createDocumentWithTimeline({
            documentTemplateId: documenttemplate?.id,
            organizationId: documenttemplate?.organizationId,
            type: documenttemplate?.type,
            config: payload,
            token,
            status: "draft",
            customerId: data.customerId,
          })
        );
      }
    } catch (err) {
      console.error("Error in DO Document creation:", err);
      // Log more details about the error
      if (err instanceof Error) {
        console.error("Error message:", err.message);
        console.error("Error stack:", err.stack);
      }
    }
  };

  // New function to handle submission with status
  const onSubmitWithStatus = async (status: string) => {
    try {
      console.log("Form submission with status started:", status);
      const data = watch(); // Get current form values at time of call
      console.log("Form data for status submission:", data);
      console.log("Project ID:", data.projectId, "Type:", typeof data.projectId);

      // Validate projectId - ensure it's either empty/null or a valid UUID
      if (data.projectId && typeof data.projectId === "string" && data.projectId.trim() === "") {
        console.log("Converting empty projectId string to null");
        data.projectId = null;
      }

      const token = await getToken();
      if (!token) return;

      data.items = data.items.map((item: any) => ({
        ...item,
        quantity: item.quantity ?? 1,
      }));

      let logoKey = "";
      const logoFile = Array.isArray(data.logo) ? data.logo[0] : data.logo;

      if (logoFile) {
        try {
          dispatch(actions.uploadImageStart());
          logoKey = await uploadImage({
            blob: logoFile,
            folderName: "logos",
            token,
          });
        } catch (err) {
          console.error("Logo upload failed", err);
          throw err;
        } finally {
          dispatch(actions.uploadImageEnd());
        }
      }

      const uploadedSignatures: { company?: string; customer?: string } = {};
      if (data.signature) {
        for (const key of ["company", "customer"] as const) {
          const base64 = data.signature?.[key];
          if (base64?.startsWith("data:image")) {
            const file = base64ToFile(base64, `${key}-signature.png`);
            try {
              dispatch(actions.uploadImageStart());
              const signatureKey = await uploadImage({
                blob: file,
                folderName: "signatures",
                token,
              });
              uploadedSignatures[key] = signatureKey;
            } catch (err) {
              console.error(`Error uploading ${key} signature`, err);
              throw err;
            } finally {
              dispatch(actions.uploadImageEnd());
            }
          } else if (base64) {
            uploadedSignatures[key] = base64;
          }
        }
      }

      // Upload captured images to S3 - preserve existing URLs and upload new base64 images
      const uploadedCapturedImages: string[] = [];
      if (data.capturedImages && Array.isArray(data.capturedImages) && data.capturedImages.length > 0) {
        console.log("Processing captured images:", data.capturedImages.length, "images");
        try {
          dispatch(actions.uploadImageStart());
          for (let i = 0; i < data.capturedImages.length; i++) {
            const image = data.capturedImages[i];
            console.log(`Image ${i + 1}:`, image?.substring(0, 50) + "...");

            if (image?.startsWith("data:image")) {
              // This is a new base64 image - upload it
              console.log(`Uploading new base64 image ${i + 1}`);
              const file = base64ToFile(image, `captured-image-${i + 1}.png`);
              const imageKey = await uploadImage({
                blob: file,
                folderName: "captured-images",
                token,
              });
              uploadedCapturedImages.push(imageKey);
              console.log(`Uploaded image ${i + 1} as:`, imageKey);
            } else if (image && typeof image === "string") {
              // This is an existing S3 URL - preserve it
              console.log(`Preserving existing S3 URL for image ${i + 1}:`, image);
              uploadedCapturedImages.push(image);
            }
          }
          console.log("Final uploaded images array:", uploadedCapturedImages);
        } catch (err) {
          console.error("Error uploading captured images", err);
          throw err;
        } finally {
          dispatch(actions.uploadImageEnd());
        }
      }

      const payload = {
        ...data,
        logo: logoKey || document?.config.logo,
        signature: uploadedSignatures,
        capturedImages: uploadedCapturedImages,
      };

      if (documentId) {
        // Update document with the selected status
        dispatch(
          actions.updateDocument({
            id: documentId,
            type: document?.type,
            config: payload,
            token,
            status: status, // Use the provided status
            customerId: data.customerId,
            ...(data.projectId ? { projectId: data.projectId } : {}),
          })
        );
      } else {
        // Create new document with status (though this path shouldn't happen with status selection)
        dispatch(
          actions.createDocumentWithTimeline({
            documentTemplateId: documenttemplate?.id,
            organizationId: documenttemplate?.organizationId,
            type: documenttemplate?.type,
            config: payload,
            token,
            status: status, // Use the provided status
            customerId: data.customerId,
          })
        );
      }
    } catch (err) {
      console.error("Error in DO Document submission with status:", err);
      if (err instanceof Error) {
        console.error("Error message:", err.message);
        console.error("Error stack:", err.stack);
      }
    }
  };
  console.log("fields", fields);

  // Add debug logging for complete document structure
  useEffect(() => {
    if (document) {
      console.log("=== COMPLETE DOCUMENT DEBUG ===");
      console.log("Full document object:", JSON.stringify(document, null, 2));
      console.log("Document config items:", document?.config?.items);
      console.log("Current form values (watch all):", watch());
      console.log("=== END DOCUMENT DEBUG ===");
    }
  }, [document, watch]);

  return {
    control,
    setValue,
    addNewLine,
    companyName,
    customerId,
    projectId, // added to return
    fields,
    remove,
    replace, // Add replace function
    onDocumentCreate: handleSubmit(onSubmit),
    onSubmitWithStatus, // Add this to return
    itemsError,
    isLoading,
    isDirty,
    isFormReadyForSubmission, // Add this to return
  };
}
