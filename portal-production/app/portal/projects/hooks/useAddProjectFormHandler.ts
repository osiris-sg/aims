import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateAsset } from "./useCreateAsset";
import { useOrganization, useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { useRouter, useSearchParams } from "next/navigation";
import { ROUTES } from "@/routes";

const assetSchema = z.object({
  name: z.string().min(1, "Name is required"),
  skuKey: z.string().min(1, "SKU Key is required"),
  categoryId: z.string().min(1, "Category is required"),
  status: z.string().min(1, "Status is required"),
  image: z.any(),
  description: z.string().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
});
const assignmentSchema = z.object({
  skuKey: z.string().min(1, "SKU Key is required"),
  inventoryId: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  // Add documentId if needed later
});

const projectSchema = z.object({
  name: z.string().min(1, "Project name is required"),
  customerId: z.string().min(1, "Customer is required"),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().min(1, "End date is required"),
  status: z.string().min(1, "Status is required"),
  description: z.string().optional(),
  assignments: z.array(assignmentSchema).optional(),
});

export type AssetFormData = z.infer<typeof assetSchema>;
export type ProjectFormData = z.infer<typeof projectSchema>;

export const useAddProjectFormHandler = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const [activeStep, setActiveStep] = useState<number>(0);
  const [isSkuCheckInProgress, setIsSkuCheckInProgress] = useState(false);
  const [isSkuKeyAvailable, setIsSkuKeyAvailable] = useState(true);
  const [asset, setAsset] = useState<any>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const { createAsset, isLoading: isAssetUpdating, error } = useCreateAsset();

  // const methods = useForm<AssetFormData>({
  //   resolver: zodResolver(assetSchema),
  //   defaultValues: {
  //     name: "",
  //     skuKey: "",
  //     categoryId: "",
  //     status: "active",
  //     image: undefined,
  //     description: "",
  //     location: "",
  //     notes: "",
  //   },
  // });
  const methods = useForm<ProjectFormData>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: "",
      customerId: "",
      startDate: "",
      endDate: "",
      status: "pending",
      description: "",
      assignments: [],
    },
  });

  const { handleSubmit, watch, setError, clearErrors } = methods;

  // Check if we're in edit mode
  // useEffect(() => {
  //   const assetId = searchParams.get("id");
  //   if (assetId) {
  //     setIsEditMode(true);
  //     fetchAsset(assetId);
  //   }
  // }, [searchParams]);
  // uncomment if you need project form handling
  useEffect(() => {
    const projectId = searchParams.get("id");
    if (projectId) {
      setIsEditMode(true);
      fetchProject(projectId); // Uncomment if you need project fetching
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
        setAsset(response.data);
        methods.reset({
          name: response.data.name,
          skuKey: response.data.skuKey,
          categoryId: response.data.categoryId,
          status: response.data.status,
          description: response.data.description || "",
          location: response.data.location || "",
          notes: response.data.notes || "",
          image: response.data.image,
        });
      }
    } catch (error) {
      console.error("Error fetching asset:", error);
    }
  };

  // Uncomment if you need project fetching
  // const fetchProject = async (projectId: string) => {
  //   try {
  //     const token = await getToken();
  //     if (!token) return;

  //     const response = await request(
  //       {
  //         path: `/projects/${projectId}`,
  //         method: "GET",
  //       },
  //       {},
  //       token
  //     );

  //     if (response.success) {
  //       setAsset(response.data);
  //       methods.reset({
  //         name: response.data.name,
  //         skuKey: "",
  //         categoryId: "",
  //         status: response.data.status || "active",
  //         description: response.data.description || "",
  //         location: "",
  //         notes: "",
  //         image: undefined,
  //       });
  //     }
  //   } catch (error) {
  //     console.error("Error fetching project:", error);
  //   }
  // };

  // Check SKU key availability
  // useEffect(() => {
  //   const checkSkuAvailability = async () => {
  //     if (!skuKey?.trim() || !organization?.id || (isEditMode && skuKey === asset?.skuKey)) {
  //       setIsSkuCheckInProgress(false);
  //       return;
  //     }

  //     setIsSkuCheckInProgress(true);
  //     try {
  //       const token = await getToken();
  //       if (!token) return;

  //       const response = await request(
  //         {
  //           path: `/assets/check-skuKey/${skuKey.trim()}`,
  //           method: "GET",
  //         },
  //         { organizationId: organization.id },
  //         token
  //       );

  //       const isAvailable = response.data?.isAvailable ?? false;
  //       setIsSkuKeyAvailable(isAvailable);

  //       if (!isAvailable) {
  //         setError("skuKey", {
  //           type: "manual",
  //           message: "This SKUKEY is already taken",
  //         });
  //       } else {
  //         clearErrors("skuKey");
  //       }
  //     } catch (error) {
  //       console.error("Error checking SKU:", error);
  //       setIsSkuKeyAvailable(false);
  //       setError("skuKey", {
  //         type: "manual",
  //         message: "Error checking SKU availability",
  //       });
  //     } finally {
  //       setIsSkuCheckInProgress(false);
  //     }
  //   };

  //   if (skuKey?.trim()) {
  //     const debounceTimer = setTimeout(checkSkuAvailability, 500);
  //     return () => clearTimeout(debounceTimer);
  //   }
  // }, [skuKey, organization?.id, getToken, setError, clearErrors, isEditMode, asset]);

  const handleNext = async () => {
    if (activeStep === 0) {
      // Validate first step fields
      const { name, customerId, startDate, endDate } = methods.getValues();
      if (!name || !customerId || !startDate || !endDate) {
        await methods.trigger(["name", "customerId", "startDate", "endDate"]);
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
    if (isEditMode && asset) {
      // Update existing asset
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: "/assets/update",
          method: "PUT",
        },
        {
          ...data,
          id: asset.id,
          organizationId: organization?.id,
        },
        token
      );

      if (response.success) {
        router.push(ROUTES.ASSETS);
      }
    } else {
      // Create new asset
      const success = await createAsset({
        ...data,
        organizationId: organization?.id || "",
      });
      if (success) {
        setActiveStep(3); // Move to success step
      }
    }
  };

  useEffect(() => {
    const subscription = methods.watch((value, { name, type }) => {
      console.log("Form changed:", { name, type, value });
      console.log("Current full form state:", methods.getValues());
    });
    return () => subscription.unsubscribe();
  }, [methods]);

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
  };
};
