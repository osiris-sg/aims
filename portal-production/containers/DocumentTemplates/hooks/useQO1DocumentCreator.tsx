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
// removed unused import

export default function useQO1DocumentCreator() {
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
      items: [{ itemNo: 1, itemDesc: "", unitRate: "" }],
      attention: { name: "", phoneNumber: "", email: "" },
      doNo: "",
      referenceNo: "",
      poNo: "",
      deliveryTo: "",
      gstRegNo: "",
      date: "",
      qoNo: "",
      salesPerson: "",
      salesPersonEmail: "",
      quotationNo: "",
      validityTerm: "",
      currency: "",
      salePerson: "",
      mobile: "",
      // Inherit default values from template if available
      note: (documenttemplate as any)?.config?.defaultValues?.note || "",
      remarks: (documenttemplate as any)?.config?.defaultValues?.remarks || "",
      termsAndConditions: (documenttemplate as any)?.config?.defaultValues?.termsAndConditions || "",
      agreementText: (documenttemplate as any)?.config?.defaultValues?.agreementText || "",
      signatureText: {
        company: (documenttemplate as any)?.config?.defaultValues?.signatureText?.company || "",
      },
      title: (documenttemplate as any)?.config?.defaultValues?.title || "",
      // Preload containers for images
      logo: organization?.logo ? [{ data: organization.logo }] : undefined,
      stamp: { company: organization?.defaultStamp ? [{ data: organization.defaultStamp }] : [] },
    }),
    [organization?.logo, organization?.defaultStamp, (documenttemplate as any)?.config?.defaultValues]
  );
  console.log("Document Template:", defaultValues, documenttemplate);

  // For Quotation 1, make all fields optional and do not require items
  const schema = useDocumentYupSchemaGenerator(defaultValues, { __requireItems: false });

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
    append({ itemNo: fields.length + 1, itemDesc: "", unitRate: "" });
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
  }, [isDocumentCreated, defaultValues]);

  // Set form values from existing document.config if editing
  useEffect(() => {
    console.log("Document ID:", documentId, "Document Config:", document);
    if (documentId && document?.config) {
      const logoValue = document.config.logo ? [{ data: document.config.logo }] : null;
      const stampCompanyValue = document.config?.stamp?.company ? [{ data: document.config.stamp.company }] : [];

      reset(
        {
          ...document.config,
          items:
            document.config.items?.map((item: any) => ({
              ...item,
              quantity: item.quantity ?? 1,
            })) || [],
          logo: logoValue,
          stamp: { company: stampCompanyValue },
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
    } else if (!documentId && organization) {
      // New document → preload org logo and default stamp if available
      if (organization.logo) {
        setValue("logo", [{ data: organization.logo }], { shouldDirty: true });
      }
      if (organization.defaultStamp) {
        setValue("stamp.company", [{ data: organization.defaultStamp }], { shouldDirty: true });
      }
    }
  }, [documentId, document?.config, reset, setValue, document?.organization, organization, document]);

  // Set template default values for new documents when template loads
  useEffect(() => {
    // Only apply if document doesn't have existing config data (new document)
    const templateDefaults = (documenttemplate as any)?.config?.defaultValues as { note?: string; remarks?: string; termsAndConditions?: string; signatureText?: { company?: string } } | undefined;
    if (templateDefaults && (!document?.config || Object.keys(document?.config || {}).length === 0)) {
      const { note, remarks, termsAndConditions, signatureText } = templateDefaults;

      if (note) {
        setValue("note", note, { shouldDirty: false });
      }
      if (remarks) {
        setValue("remarks", remarks, { shouldDirty: false });
      }
      if (termsAndConditions) {
        setValue("termsAndConditions", termsAndConditions, { shouldDirty: false });
      }
      if (signatureText?.company) {
        setValue("signatureText.company", signatureText.company, { shouldDirty: false });
      }
    }
  }, [documentId, documenttemplate, document?.config, setValue]);

  const onSubmit = async (data: any) => {
    try {
      const token = await getToken();
      if (!token) return;

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

      // Company stamp upload/retain
      let companyStampKey = "";
      const stampCompanyArr = data?.stamp?.company;
      const stampCompanyEntry = Array.isArray(stampCompanyArr) ? stampCompanyArr[0] : undefined;
      const stampCompanyVal = stampCompanyEntry?.data ?? stampCompanyEntry;
      if (stampCompanyVal) {
        if (typeof stampCompanyVal === "string") {
          companyStampKey = stampCompanyVal;
        } else {
          try {
            dispatch(actions.uploadImageStart());
            companyStampKey = await uploadImage({ blob: stampCompanyVal, folderName: "stamps", token });
          } finally {
            dispatch(actions.uploadImageEnd());
          }
        }
      }
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
        stamp: { company: companyStampKey || document?.config?.stamp?.company },
        signature: uploadedSignatures,
        // Preserve the full column-label set. The Rate-Column-Header dropdown
        // only writes columnLabels.unitPrice; merge over the doc's existing
        // labels so siblings (no/description/uom/quantity/amount) can't be
        // dropped if RHF prunes the un-touched subtree.
        columnLabels: { ...(document?.config?.columnLabels || {}), ...(data?.columnLabels || {}) },
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
            status: "draft",
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
    watch,
  };
}
