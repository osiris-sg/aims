/* eslint-disable @typescript-eslint/no-explicit-any */

import { yupResolver } from "@hookform/resolvers/yup";
import { useForm, useFieldArray } from "react-hook-form";
import useDocumentYupSchemaGenerator from "./useDocumentYupSchemaGenerator";
import { useDispatch, useSelector } from "react-redux";
import { selectDocumentCeationStatus, selectDocumentTemplate, selectIsDocumentUpdating } from "@/containers/DocumentsTemplateView/slice/selectors";
import { useDocumentTemplateSlice } from "@/containers/DocumentsTemplateView/slice";
import { useAuth } from "@clerk/nextjs";
import { useEffect, useMemo } from "react";
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
  const searchParams = useSearchParams();
  const scannedInventoryId = searchParams.get("scannedInventoryId");

  const defaultValues = useMemo(
    () => ({
      company: { name: "", address: "", phoneNumber: "" },
      customerId: "",
      projectId: "", // added
      items: scannedInventoryId ? [{ inventoryItemId: scannedInventoryId, quantity: 1 }] : [{ inventoryItemId: "", quantity: 1 }],
      attention: { name: "", phoneNumber: "" },
      doNo: "",
      referenceNo: "",
      poNo: "",
      deliveryTo: "",
      gstRegNo: "",
      date: "",
      // dueDate: "",
      // notes: "hi",
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
  });

  const { fields, append, remove } = useFieldArray({
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
        } else {
          append({ inventoryItemId: scannedInventoryId, quantity: 1 }, { shouldFocus: false });
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
    append({ inventoryItemId: "", quantity: 1 });
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
    }
  }, [documentId, document?.config, reset]);

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

      const payload = {
        ...data,
        projectId, // added
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
            status: "instock",
            customerId: data.customerId,
            projectId: projectId, // added
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
            status: "instock",
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
