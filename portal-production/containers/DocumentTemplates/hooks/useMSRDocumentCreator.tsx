/* eslint-disable @typescript-eslint/no-explicit-any */

import { yupResolver } from "@hookform/resolvers/yup";
import { useForm } from "react-hook-form";
import useDocumentYupSchemaGenerator from "./useDocumentYupSchemaGenerator";
import { useDispatch, useSelector } from "react-redux";
import { selectDocumentCeationStatus, selectDocumentTemplate, selectIsDocumentUpdating } from "@/containers/DocumentsTemplateView/slice/selectors";
import { useDocumentTemplateSlice } from "@/containers/DocumentsTemplateView/slice";
import { useAuth } from "@clerk/nextjs";
import { useEffect, useMemo } from "react";
import { uploadImage } from "@/helpers/imageUploader";
import { base64ToFile } from "@/helpers/base64ToFile";
import { useParams } from "next/navigation";
import useGetDocument from "./useGetDocument";

export default function useMSRDocumentCreator() {
  const documenttemplate = useSelector(selectDocumentTemplate);
  const { documentId } = useParams();
  const dispatch = useDispatch();
  const { actions } = useDocumentTemplateSlice();
  const { getToken } = useAuth();
  const { document } = useGetDocument();

  const defaultValues = useMemo(
    () => ({
      reportDetails: {
        equipmentId: "",
        location: "",
        reportType: "",
        date: "",
        description: "",
      },
      photos: [], // Array of AnnotatedPhoto objects
      customerId: "",
    }),
    []
  );

  // Use a stable config object to prevent infinite re-renders
  const stableConfig = useMemo(() => documenttemplate?.config || {}, [documenttemplate?.config]);
  const schema = useDocumentYupSchemaGenerator(defaultValues, stableConfig);

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

  // Debug validation errors (commented out to prevent spam)
  // useEffect(() => {
  //   if (Object.keys(errors).length > 0) {
  //     console.log("Form validation errors:", errors);
  //   }
  // }, [errors]);

  // MSR doesn't need field arrays like DO/Invoice

  const isLoading = useSelector(selectIsDocumentUpdating);
  const isDocumentCreated = useSelector(selectDocumentCeationStatus);

  // Optimize watch usage to prevent infinite re-renders
  const customerId = watch("customerId");
  const reportDetails = watch("reportDetails");
  const photos = watch("photos");

  // Memoized form readiness check to prevent infinite re-renders
  const isFormReadyForSubmission = useMemo(() => {
    // MSR requirements:
    // 1. Must have report details filled out
    if (!reportDetails?.equipmentId || !reportDetails?.location || !reportDetails?.reportType || !reportDetails?.date) {
      return false;
    }

    // 2. Must have at least one photo with part name and comment
    if (!photos || photos.length === 0) {
      return false;
    }

    const validPhotos = photos.filter((photo: any) => photo.imageData && photo.partName && photo.partName.trim() && photo.comments && photo.comments.trim());

    return validPhotos.length > 0;
  }, [reportDetails?.equipmentId, reportDetails?.location, reportDetails?.reportType, reportDetails?.date, photos]);

  // Reset the form if a document is successfully created
  useEffect(() => {
    if (isDocumentCreated) {
      reset(defaultValues, {
        keepDirty: false,
        keepTouched: false,
        keepValues: false,
      });
    }
  }, [isDocumentCreated, defaultValues, reset]);

  // Set form values from existing document.config if editing
  useEffect(() => {
    if (documentId && document?.config) {
      reset(
        {
          ...document.config,
          reportDetails: document.config.reportDetails || defaultValues.reportDetails,
          photos: document.config.photos || [],
        },
        {
          keepDefaultValues: false,
        }
      );
    }
  }, [documentId, document?.config, document, reset, defaultValues]);

  const onSubmit = async (data: any) => {
    try {
      console.log("MSR Form submission started with data:", data);
      const token = await getToken();
      if (!token) return;

      // Upload all photos and their annotations to S3
      const processedPhotos: any[] = [];
      if (data.photos && Array.isArray(data.photos) && data.photos.length > 0) {
        try {
          dispatch(actions.uploadImageStart());
          for (let i = 0; i < data.photos.length; i++) {
            const photo = data.photos[i];
            let imageKey = photo.imageData;
            let annotationKey = photo.annotations;

            // Upload main image if it's base64
            if (photo.imageData?.startsWith("data:image")) {
              const file = base64ToFile(photo.imageData, `msr-photo-${i + 1}.png`);
              imageKey = await uploadImage({
                blob: file,
                folderName: "msr-photos",
                token,
              });
            }

            // Upload annotation if it exists and is base64
            if (photo.annotations?.startsWith("data:image")) {
              const annotationFile = base64ToFile(photo.annotations, `msr-annotation-${i + 1}.png`);
              annotationKey = await uploadImage({
                blob: annotationFile,
                folderName: "msr-annotations",
                token,
              });
            }

            processedPhotos.push({
              ...photo,
              imageData: imageKey,
              annotations: annotationKey,
            });
          }
        } catch (err) {
          console.error("Error uploading MSR photos", err);
          throw err;
        } finally {
          dispatch(actions.uploadImageEnd());
        }
      }

      const payload = {
        reportDetails: data.reportDetails,
        photos: processedPhotos,
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
      console.error("Error in MSR Document creation:", err);
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
      console.log("MSR submission with status started:", status);
      const data = { reportDetails, photos, customerId }; // Get current form values
      const token = await getToken();
      if (!token) return;

      // Process photos for status submission (same as regular submit)
      const processedPhotos: any[] = [];
      if (data.photos && Array.isArray(data.photos) && data.photos.length > 0) {
        try {
          dispatch(actions.uploadImageStart());
          for (let i = 0; i < data.photos.length; i++) {
            const photo = data.photos[i];
            let imageKey = photo.imageData;
            let annotationKey = photo.annotations;

            if (photo.imageData?.startsWith("data:image")) {
              const file = base64ToFile(photo.imageData, `msr-photo-${i + 1}.png`);
              imageKey = await uploadImage({
                blob: file,
                folderName: "msr-photos",
                token,
              });
            }

            if (photo.annotations?.startsWith("data:image")) {
              const annotationFile = base64ToFile(photo.annotations, `msr-annotation-${i + 1}.png`);
              annotationKey = await uploadImage({
                blob: annotationFile,
                folderName: "msr-annotations",
                token,
              });
            }

            processedPhotos.push({
              ...photo,
              imageData: imageKey,
              annotations: annotationKey,
            });
          }
        } catch (err) {
          console.error("Error uploading MSR photos", err);
          throw err;
        } finally {
          dispatch(actions.uploadImageEnd());
        }
      }

      const payload = {
        reportDetails: data.reportDetails,
        photos: processedPhotos,
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
          })
        );
      } else {
        // Create new document with status
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
      console.error("Error in MSR Document submission with status:", err);
      if (err instanceof Error) {
        console.error("Error message:", err.message);
        console.error("Error stack:", err.stack);
      }
    }
  };

  return {
    control,
    setValue,
    customerId,
    reportDetails,
    photos,
    onDocumentCreate: handleSubmit(onSubmit),
    onSubmitWithStatus,
    isLoading,
    isDirty,
    isFormReadyForSubmission,
  };
}
