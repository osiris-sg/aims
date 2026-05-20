import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateAsset } from "./useCreateAsset";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { useRouter, useSearchParams } from "next/navigation";
import { ROUTES } from "@/routes";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

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

const UOM_VALUES = UOM_OPTIONS.map(o => o.value) as [string, ...string[]];

const customPriceSchema = z.object({
  label: z.string().min(1, "Label required"),
  value: z.coerce.number().min(0),
});

const assetSchema = z.object({
  name: z.string().min(1, "Name is required"),
  skuKey: z.string().min(1, "SKU Key is required"),
  categoryId: z.string().min(1, "Category is required"),
  uom: z.enum(UOM_VALUES, { required_error: "Unit of Measure is required" }),
  status: z.string().min(1, "Status is required"),
  image: z.any(),
  description: z.string().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  // `price` stays as the selling price for back-compat with existing data.
  price: z.coerce.number().min(0).optional(),
  costPrice: z.coerce.number().min(0).optional(),
  customPrices: z.array(customPriceSchema).optional(),
  points: z.coerce.number().min(0).optional(),
  isTracked: z.boolean().default(true),
  // Use coerce to convert string input to number
  quantity: z.coerce.number().min(0).optional(),
  minQuantity: z.coerce.number().min(0).optional(),
}).refine((data) => {
  // Quantity is required when isTracked is false
  if (data.isTracked === false && (data.quantity === undefined || data.quantity === null || isNaN(data.quantity))) {
    return false;
  }
  return true;
}, {
  message: "Quantity is required for untracked products",
  path: ["quantity"],
});

// Schema for the actual data we send to the backend
const updateAssetSchema = z.object({
  name: z.string().min(1, "Name is required"),
  skuKey: z.string().min(1, "SKU Key is required"),
  uom: z.string().optional(),
  image: z.any().optional(),
  description: z.string().optional(),
  price: z.number().min(0).optional().nullable(),
  costPrice: z.number().min(0).optional().nullable(),
  customPrices: z.array(customPriceSchema).optional().nullable(),
  points: z.number().min(0).optional().nullable(),
  isTracked: z.boolean().optional(),
  quantity: z.number().min(0).optional().nullable(),
  minQuantity: z.number().min(0).optional().nullable(),
  categoryId: z.string().optional(),
});

export type AssetFormData = z.infer<typeof assetSchema>;

export const useAddAssetFormHandler = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const [activeStep, setActiveStep] = useState(0);
  const [isSkuCheckInProgress, setIsSkuCheckInProgress] = useState(false);
  const [isSkuKeyAvailable, setIsSkuKeyAvailable] = useState(true);
  const [asset, setAsset] = useState<any>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const { createAsset, isLoading: isAssetUpdating, error } = useCreateAsset();

  // Get organization's tracking mode - ON = Assets, OFF = Products
  const { isAssetTrackingModeEnabled } = useOrganizationFeatures();

  const methods = useForm<AssetFormData>({
    resolver: zodResolver(assetSchema),
    defaultValues: {
      name: "",
      skuKey: "",
      categoryId: "",
      uom: "PCS",
      status: "active",
      image: undefined,
      description: "",
      location: "",
      notes: "",
      price: undefined,
      costPrice: undefined,
      customPrices: [],
      points: undefined,
      isTracked: true,
      quantity: undefined,
      minQuantity: undefined,
    },
  });

  const { handleSubmit, watch, setError, clearErrors } = methods;
  const skuKey = watch("skuKey");

  // Check if we're in edit mode
  useEffect(() => {
    const assetId = searchParams.get("id");
    if (assetId) {
      setIsEditMode(true);
      fetchAsset(assetId);
    }
  }, [searchParams]);

  // Fetch asset data if in edit mode
  const fetchAsset = async (assetId: string) => {
    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/assets/${assetId}`,
          method: "GET",
        },
        {},
        token
      );

      if (response.success) {
        console.log("Fetched asset data:", response.data);
        setAsset(response.data);
        const formData = {
          name: response.data.name,
          skuKey: response.data.skuKey,
          categoryId: response.data.categoryId,
          uom: response.data.uom || "PCS",
          status: response.data.status || "active", // Provide default if missing
          description: response.data.description || "",
          location: response.data.location || "",
          notes: response.data.notes || "",
          price: response.data.price ?? undefined,
          costPrice: response.data.costPrice ?? undefined,
          customPrices: Array.isArray(response.data.customPrices) ? response.data.customPrices : [],
          points: response.data.points ?? undefined,
          image: response.data.image,
          isTracked: response.data.isTracked !== false, // Default to true
          quantity: response.data.quantity ?? undefined,
          minQuantity: response.data.minQuantity ?? undefined,
        };
        console.log("Setting form data:", formData);
        methods.reset(formData);
      }
    } catch (error) {
      console.error("Error fetching asset:", error);
    }
  };

  // Check SKU key availability
  useEffect(() => {
    const checkSkuAvailability = async () => {
      if (!skuKey?.trim() || !organization?.id || (isEditMode && skuKey === asset?.skuKey)) {
        setIsSkuCheckInProgress(false);
        return;
      }

      setIsSkuCheckInProgress(true);
      try {
        const token = await getToken();
        if (!token) return;

        const response = await request(
          {
            path: `/assets/check-skuKey/${skuKey.trim()}`,
            method: "GET",
          },
          { organizationId: organization.id },
          token
        );

        const isAvailable = response.data?.isAvailable ?? false;
        setIsSkuKeyAvailable(isAvailable);

        if (!isAvailable) {
          setError("skuKey", {
            type: "manual",
            message: "This SKUKEY is already taken",
          });
        } else {
          clearErrors("skuKey");
        }
      } catch (error) {
        console.error("Error checking SKU:", error);
        setIsSkuKeyAvailable(false);
        setError("skuKey", {
          type: "manual",
          message: "Error checking SKU availability",
        });
      } finally {
        setIsSkuCheckInProgress(false);
      }
    };

    if (skuKey?.trim()) {
      const debounceTimer = setTimeout(checkSkuAvailability, 500);
      return () => clearTimeout(debounceTimer);
    }
  }, [skuKey, organization?.id, getToken, setError, clearErrors, isEditMode, asset]);

  const handleNext = async () => {
    if (activeStep === 0) {
      // Validate first step fields
      const { name, skuKey, categoryId, uom } = methods.getValues();
      if (!name || !skuKey || !categoryId || !uom) {
        await methods.trigger(["name", "skuKey", "categoryId", "uom"]);
        return;
      }
    } else if (activeStep === 1) {
      // In edit mode, we don't need to validate optional fields
      if (isEditMode) {
        setActiveStep((prevStep) => prevStep + 1);
        return;
      }
      // For new assets, validate all fields
      const isValid = await methods.trigger();
      if (!isValid) {
        return;
      }
    }
    setActiveStep((prevStep) => prevStep + 1);
  };

  const handleBack = () => {
    setActiveStep((prevStep) => prevStep - 1);
  };

  const onSubmit = async (data: AssetFormData) => {
    console.log("=== FORM SUBMISSION STARTED ===");
    console.log("Form submitted with data:", data);
    console.log("Is edit mode:", isEditMode);
    console.log("Asset:", asset);
    console.log("Active step:", activeStep);

    // Ensure required fields are present and handle image field
    const formDataWithStatus: {
      name: string;
      skuKey: string;
      uom?: string;
      description?: string;
      image?: any;
      isTracked?: boolean;
      quantity?: number;
      minQuantity?: number;
      price?: number;
      costPrice?: number;
      customPrices?: { label: string; value: number }[];
      points?: number;
      categoryId?: string;
    } = {
      name: data.name,
      skuKey: data.skuKey,
      uom: data.uom,
      description: data.description,
      image: data.image || undefined, // Keep image as is, don't send if undefined
      isTracked: data.isTracked,
      quantity: data.quantity,
      minQuantity: data.minQuantity,
      price: data.price,
      costPrice: data.costPrice,
      // Drop empty rows so we don't persist incomplete pricing entries.
      customPrices: (data.customPrices || []).filter(
        (cp: any) => cp && cp.label && cp.label.trim() && cp.value !== undefined && cp.value !== null,
      ),
      points: data.points,
      categoryId: data.categoryId || undefined,
    };

    // Handle image field properly
    if (formDataWithStatus.image instanceof File) {
      console.log("Image is a File object, removing from request");
      delete formDataWithStatus.image;
    } else if (Array.isArray(formDataWithStatus.image)) {
      console.log("Image is an array, removing from request");
      delete formDataWithStatus.image;
    } else if (formDataWithStatus.image === null || formDataWithStatus.image === undefined) {
      console.log("Image is null/undefined, removing from request");
      delete formDataWithStatus.image;
    } else if (typeof formDataWithStatus.image === "string" && formDataWithStatus.image.trim() === "") {
      console.log("Image is empty string, removing from request");
      delete formDataWithStatus.image;
    }

    console.log("Form data with status:", formDataWithStatus);
    console.log("Image field type:", typeof formDataWithStatus.image);
    console.log("Image field value:", formDataWithStatus.image);

    // Validate the data we're actually sending to the backend
    const validationResult = updateAssetSchema.safeParse(formDataWithStatus);
    if (!validationResult.success) {
      console.error("Form validation failed:", validationResult.error);
      return;
    }
    console.log("Form validation passed");

    if (isEditMode && asset) {
      // Update existing asset
      const token = await getToken();
      if (!token) {
        console.error("No token available");
        return;
      }

      console.log("Sending update request with data:", {
        ...formDataWithStatus,
        id: asset.id,
      });

      try {
        const response = await request(
          {
            path: "/assets/update",
            method: "PUT",
          },
          {
            ...formDataWithStatus,
            id: asset.id,
          },
          token
        );

        console.log("Update response:", response);

        if (response.success) {
          console.log("Update successful, redirecting to assets page");
          router.push(ROUTES.ASSETS);
        } else {
          console.error("Update failed:", response.message);
        }
      } catch (error) {
        console.error("Error updating asset:", error);
      }
    } else {
      // Create new asset
      const success = await createAsset({
        ...data,
      });
      if (success) {
        router.push(ROUTES.ASSETS);
      }
    }
  };

  // Debug function to log form state
  const logFormState = () => {
    console.log("=== FORM STATE DEBUG ===");
    console.log("Active step:", activeStep);
    console.log("Is edit mode:", isEditMode);
    console.log("Is asset updating:", isAssetUpdating);
    console.log("Is SKU check in progress:", isSkuCheckInProgress);
    console.log("Is SKU key available:", isSkuKeyAvailable);
    console.log("Form values:", methods.getValues());
    console.log("Form errors:", methods.formState.errors);
    console.log("Asset:", asset);
  };

  return {
    activeStep,
    handleNext,
    handleBack,
    methods,
    handleSubmit,
    onSubmit,
    isAssetUpdating,
    isSkuCheckInProgress,
    isSkuKeyAvailable,
    isEditMode,
    error,
    logFormState, // Export for debugging
  };
};
