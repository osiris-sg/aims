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

export default function useTIDocumentCreator() {
  const documenttemplate = useSelector(selectDocumentTemplate);
  const { documentId } = useParams();
  const dispatch = useDispatch();
  const { actions } = useDocumentTemplateSlice();
  const { getToken } = useAuth();
  const { document } = useGetDocument();
  const { organization } = useOrganization();
  const searchParams = useSearchParams();
  const scannedInventoryId = searchParams.get("scannedInventoryId");
  const preSelectedCustomerId = searchParams.get("customerId");

  const defaultValues = useMemo(
    () => ({
      company: { name: "", address: "", phoneNumber: "" },
      customerId: preSelectedCustomerId || "",
      projectId: "", // added
      items: scannedInventoryId ? [{ inventoryItemId: scannedInventoryId, quantity: 1, description: "" }] : [{ inventoryItemId: "", quantity: 1, description: "" }],
      attention: { name: "", phoneNumber: "" },
      doNo: "",
      referenceNo: "",
      poNo: "",
      deliveryTo: "",
      gstRegNo: "",
      date: "",
      dueDate: "",
      note: "",
    }),
    [scannedInventoryId, preSelectedCustomerId]
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
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items",
  });

  // Pre-select customer from URL parameter
  useEffect(() => {
    if (preSelectedCustomerId && !document) {
      setValue("customerId", preSelectedCustomerId, { shouldDirty: true, shouldTouch: true });
      console.log("Pre-selected customer from URL:", preSelectedCustomerId);
    }
  }, [preSelectedCustomerId, setValue, document]);

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
    if (documentId && document?.config) {
      const logoValue = document.config.logo ? [{ data: document.config.logo }] : null;

      reset(
        {
          ...document.config,
          items:
            document.config.items?.map((item: any) => ({
              ...item,
              quantity: item.quantity ?? 1,
            })) || [],
          logo: logoValue,
        },
        {
          keepDefaultValues: false,
        }
      );
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
  }, [documentId, document?.config, document?.organization, reset, setValue, organization?.logo]);

  const onSubmit = async (data: any) => {
    try {
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

      const payload = {
        ...data,
        ...(projectId && projectId.trim() ? { projectId } : {}), // Only include if not empty
        logo: logoKey || document?.config.logo,
        signature: uploadedSignatures,
      };

      if (documentId) {
        // If documentId exists, update the document
        dispatch(
          actions.updateDocument({
            id: documentId,
            type: document?.type,
            config: payload,
            token,
            status: "draft", // Use draft status for documents
            customerId: data.customerId,
            ...(data.projectId ? { projectId: data.projectId } : {}), // Only include if not empty
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
            status: "draft", // Use draft status for new documents
            customerId: data.customerId,
          })
        );
      }
    } catch (err) {
      console.error("Error in RDO Document creation:", err);
    }
  };
  console.log("fields", fields);
  return {
    control,
    setValue,
    addNewLine,
    companyName,
    customerId,
    projectId, // added to return
    fields,
    remove,
    onDocumentCreate: handleSubmit(onSubmit),
    itemsError,
    isLoading,
    isDirty,
  };
}
