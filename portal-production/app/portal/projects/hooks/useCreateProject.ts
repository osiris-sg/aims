import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { ROUTES } from "@/routes";

interface CreateProjectData {
  name: string;
  siteOfficeId: string;
  startDate: Date;
  endDate: Date;
  status: string;
  assignments?: {
    skuKey: string;
    inventoryId?: string;
    startDate?: Date;
    endDate?: Date;
    status?: string;
  }[];
}

export const useCreateProject = () => {
  const router = useRouter();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createProject = async ({ data }: { data: CreateProjectData }) => {
    setIsLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        setError("Authentication token is required");
        return false;
      }

      // Prepare the request body
      const requestBody = {
        name: data.name,
        siteOfficeId: data.siteOfficeId,
        startDate: data.startDate.toISOString(),
        endDate: data.endDate.toISOString(),
        status: data.status,
        assignments: data.assignments,
      };

      console.log("Request Body:", requestBody);

      const response = await request(
        {
          path: "/projects/create",
          method: "POST",
        },
        requestBody,
        token
      );

      if (response.success) {
        return true;
      } else {
        setError(response.message || "Failed to create project");
        return false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An error occurred while creating the project";
      setError(errorMessage);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    createProject,
    isLoading,
    error,
  };
};
