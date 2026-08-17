import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateProject } from "./useCreateProject";
import { useUpdateProject } from "./useUpdateProject";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { useRouter, useSearchParams } from "next/navigation";
import { ROUTES } from "@/routes";

// const assetSchema = z.object({
//   name: z.string().min(1, "Name is required"),
//   skuKey: z.string().min(1, "SKU Key is required"),
//   categoryId: z.string().min(1, "Category is required"),
//   status: z.string().min(1, "Status is required"),
//   image: z.any(),
//   description: z.string().optional(),
//   location: z.string().optional(),
//   notes: z.string().optional(),
// });
const assignmentSchema = z.object({
  skuKey: z.string().min(1, "SKU Key is required"),
  inventoryId: z.string().min(1),
  startDate: z.any(),
  endDate: z.any(),
  status: z.string().min(1, "Status is required"),
  // Add documentId if needed later
});

const projectSchema = z.object({
  name: z.string().min(1, "Project name is required"),
  customerId: z.string().min(1, "Customer is required"),
  siteOfficeId: z.string().min(1, "Site office is required"),
  startDate: z.date({ required_error: "Start date is required" }),
  endDate: z.date({ required_error: "End date is required" }),
  status: z.string().min(1, "Status is required"),
  assignments: z.array(assignmentSchema).optional(),
});

// export type AssetFormData = z.infer<typeof assetSchema>;
export type ProjectFormData = z.infer<typeof projectSchema>;

export const useAddProjectFormHandler = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const [activeStep, setActiveStep] = useState<number>(0);
  const [isSkuCheckInProgress, setIsSkuCheckInProgress] = useState(false);
  const [isSkuKeyAvailable, setIsSkuKeyAvailable] = useState(true);
  const [project, setProject] = useState<any>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const { createProject, isLoading: isAssetUpdating, error } = useCreateProject();
  const { updateProject } = useUpdateProject();

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
      startDate: new Date(),
      endDate: new Date(),
      status: "pending",
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
      fetchProject(projectId); // TODO: Implement project fetching when needed
    }
  }, [searchParams]);

  // Fetch asset data if in edit mode
  // const fetchAsset = async (assetId: string) => {
  //   try {
  //     const token = await getToken();
  //     if (!token) return;

  //     const response = await request(
  //       {
  //         path: `/assets/${assetId}`,
  //         method: "GET",
  //       },
  //       {},
  //       token
  //     );

  //     if (response.success) {
  //       setProject(response.data);
  //       methods.reset({
  //         name: response.data.name,
  //         customerId: response.data.customerId || "",
  //         startDate: response.data.startDate ? new Date(response.data.startDate) : new Date(),
  //         endDate: response.data.endDate ? new Date(response.data.endDate) : new Date(),
  //         status: response.data.status || "pending",
  //         assignments: response.data.assignments || [],
  //       });
  //     }
  //   } catch (error) {
  //     console.error("Error fetching asset:", error);
  //   }
  // };

  // Uncomment if you need project fetching
  const fetchProject = async (projectId: string) => {
    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/projects/${projectId}`,
          method: "GET",
        },
        {},
        token
      );

      if (response.success) {
        console.log("Fetched project data:", response.data);
        setProject(response.data);
        methods.reset({
          name: response.data.name,
          customerId: response.data.siteOffice.customer.id || "",
          siteOfficeId: response.data.siteOffice.id || "",
          startDate: response.data.startDate ? new Date(response.data.startDate) : new Date(),
          endDate: response.data.endDate ? new Date(response.data.endDate) : new Date(),
          status: response.data.status || "pending",
          assignments: response.data.assignments
            ? response.data.assignments.map((assignment: any) => ({
                skuKey: assignment.inventory?.sku || "",
                inventoryId: assignment.inventoryId || "",
                startDate: assignment.startDate ? new Date(assignment.startDate) : null,
                endDate: assignment.endDate ? new Date(assignment.endDate) : null,
                status: assignment.status || "reserved",
              }))
            : [],
        });
      }
    } catch (error) {
      console.error("Error fetching project:", error);
    }
  };

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
    }
    setActiveStep((prevStep) => prevStep + 1);
    console.log("Next step:", activeStep + 1);
  };

  const handleBack = () => {
    setActiveStep((prevStep) => prevStep - 1);
  };

  const onSubmit = async (data: ProjectFormData) => {
    console.log("Form submitted with data:", data);

    if (isEditMode) {
      console.log("Updating existing project");
      const success = await updateProject({
        data: {
          ...data,
          id: project?.id,
        },
      });
      if (success) {
        setActiveStep(3);
      }
    } else {
      console.log("Creating new project");
      const success = await createProject({
        data,
      });
      if (success) {
        setActiveStep(3);
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
    handleSubmit: () => {
      return handleSubmit(
        async (data) => {
          return onSubmit(data);
        },
        (errors) => {
          console.log(">>> onSubmit not called — form has errors:");
          console.log(errors);
        }
      );
    },
    isAssetUpdating,
    isSkuCheckInProgress,
    isSkuKeyAvailable,
    isEditMode,
    error,
  };
};
