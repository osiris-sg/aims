/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { yupResolver } from "@hookform/resolvers/yup";
import { useDispatch, useSelector } from "react-redux";
import { assetsActions } from "@/containers/Assets/slice";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { selectIsAssetCreationSucceeded, selectIsAssetUpdateSucceeded, selectIsAssetUpdating, selectIsSkuCheckInProgress, selectIsSkuKeyAvailable } from "@/containers/Assets/slice/selectors";
import useGetAsset from "./useGetAsset";
import { uploadImage } from "@/helpers/imageUploader";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/routes";
// Standard industry UOM options
export const UOM_OPTIONS = [
  { value: 'PCS', label: 'PCS - Pieces' },
  { value: 'EA', label: 'EA - Each' },
  { value: 'UNIT', label: 'UNIT - Unit' },
  { value: 'SET', label: 'SET - Set' },
  { value: 'PAIR', label: 'PAIR - Pair' },
  { value: 'DOZ', label: 'DOZ - Dozen' },
  { value: 'BOX', label: 'BOX - Box' },
  { value: 'CTN', label: 'CTN - Carton' },
  { value: 'PKG', label: 'PKG - Package' },
  { value: 'PACK', label: 'PACK - Pack' },
  { value: 'BAG', label: 'BAG - Bag' },
  { value: 'ROLL', label: 'ROLL - Roll' },
  { value: 'SHEET', label: 'SHEET - Sheet' },
  { value: 'BTL', label: 'BTL - Bottle' },
  { value: 'CAN', label: 'CAN - Can' },
  { value: 'KG', label: 'KG - Kilogram' },
  { value: 'G', label: 'G - Gram' },
  { value: 'LB', label: 'LB - Pound' },
  { value: 'OZ', label: 'OZ - Ounce' },
  { value: 'L', label: 'L - Liter' },
  { value: 'ML', label: 'ML - Milliliter' },
  { value: 'GAL', label: 'GAL - Gallon' },
  { value: 'M', label: 'M - Meter' },
  { value: 'CM', label: 'CM - Centimeter' },
  { value: 'MM', label: 'MM - Millimeter' },
  { value: 'FT', label: 'FT - Feet' },
  { value: 'IN', label: 'IN - Inch' },
  { value: 'SQM', label: 'SQM - Square Meter' },
  { value: 'SQF', label: 'SQF - Square Feet' },
  { value: 'CBM', label: 'CBM - Cubic Meter' },
];

export const assetSchema = yup.object().shape({
  name: yup.string().required("Asset name is required"),
  skuKey: yup
    .string()
    .matches(/^[A-Za-z0-9_-]+$/, "SKUKEY must be alphanumeric and can include - or _")
    .required("SKUKEY is required"),
  categoryId: yup.string().required("Category is required"),
  uom: yup.string().required("Unit of Measure is required"),
  description: yup.string().optional(),
  image: yup.mixed().nullable().optional(),
});

export type ProductFormData = yup.InferType<typeof assetSchema>;

export default function useAddAssetFormhandler() {
  const dispatch = useDispatch();
  const { getToken } = useAuth();
  const router = useRouter();
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const [activeStep, setActiveStep] = useState(0);
  const isAssetCreationSucceeded = useSelector(selectIsAssetCreationSucceeded);
  const isAssetUpdateSucceeded = useSelector(selectIsAssetUpdateSucceeded);
  const { asset, isEditMode } = useGetAsset();
  const isSkuCheckInProgress = useSelector(selectIsSkuCheckInProgress);

  const isAssetUpdating = useSelector(selectIsAssetUpdating);
  const methods = useForm({
    resolver: yupResolver(assetSchema),
    mode: "onChange",
    defaultValues: {
      name: "",
      skuKey: "",
      categoryId: "",
      uom: "PCS",
      description: "",
      image: null,
    },
  });

  useEffect(() => {
    if (asset) {
      // const imageUrl = asset.image ? `${process.env.NEXT_PUBLIC_RESOURCE_URL}/${asset.image}` : "";

      methods.reset({
        ...asset,
        description: asset.description || "",
        uom: (asset as any).uom || "PCS",
        image: asset.image ? [{ data: asset.image }] : null,
      });
    }
  }, [asset]);

  const handleNext = async () => {
    const isValid = await methods.trigger();
    if (isValid) {
      setActiveStep((prevStep) => prevStep + 1);
    }
  };

  const handleBack = () => {
    setActiveStep((prevStep) => prevStep - 1);
  };

  const handleRestart = () => {
    setActiveStep(0);
  };

  useEffect(() => {
    if (isAssetUpdateSucceeded) {
      router.push(ROUTES.ASSETS);
    }
  }, [isAssetUpdateSucceeded]);

  const isSkuKeyAvailable = useSelector(selectIsSkuKeyAvailable);
  console.log("isSkuKeyAvailable", isSkuKeyAvailable);

  const skuKey = methods.watch("skuKey");

  useEffect(() => {
    if (skuKey && asset?.skuKey !== skuKey) {
      dispatch(assetsActions.setIsSkuCheckInProgress(true));
    }
    const delayDebounce = setTimeout(async () => {
      if (skuKey && asset?.skuKey !== skuKey) {
        const token = await getToken();
        if (token) {
          dispatch(assetsActions.checkSkuKey({ skuKey, token }));
        }
      }
    }, 500); // debounce delay

    return () => clearTimeout(delayDebounce);
  }, [skuKey, getToken]);

  useEffect(() => {
    if (isSkuKeyAvailable === false) {
      methods.setError("skuKey", {
        type: "manual",
        message: "This SKUKEY is already taken",
      });
    } else if (isSkuKeyAvailable === true) {
      methods.clearErrors("skuKey");
    }
  }, [isSkuKeyAvailable, methods]);

  function isFileOrBlob(value: any): value is File | Blob {
    return value instanceof File || value instanceof Blob;
  }

  const onSubmit = async (data: any) => {
    try {
      if (organizationId) {
        const token = await getToken();
        if (!token) {
          return;
        }

        const imageItem = Array.isArray(data.image) ? data.image[0] : data.image;
        const imageFile = imageItem?.data;

        let imageKey: string | null = null;

        if (isFileOrBlob(imageFile)) {
          try {
            dispatch(assetsActions.uploadImageStart());
            imageKey = await uploadImage({
              blob: imageFile,
              folderName: "assets",
              token,
            });
          } catch {
          } finally {
            dispatch(assetsActions.uploadImageEnd());
          }
        }

        // Final imageKey is either newly uploaded, or fallback to existing
        const finalImageKey = imageKey ?? (typeof imageFile === "string" ? imageFile : asset?.image ?? "");

        if (isEditMode && asset) {
          await dispatch(
            assetsActions.updateAsset({
              ...data,
              organizationId: organizationId,
              token: token,
              image: finalImageKey,
              id: asset.id,
            })
          );
        } else {
          await dispatch(
            assetsActions.createAsset({
              ...data,
              organizationId: organizationId,
              token: token,
              image: imageKey || "",
            })
          );
        }
      }
    } catch {}
  };

  return {
    activeStep,
    handleBack,
    handleNext,
    methods,
    onSubmit,
    handleRestart,
    isAssetUpdating,
    isAssetCreationSucceeded,
    isSkuCheckInProgress,
    isSkuKeyAvailable,
  };
}
