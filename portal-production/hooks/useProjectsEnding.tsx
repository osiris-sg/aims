"use client";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import moment from "moment";

interface Project {
  data: {
    id: string;
    name: string;
    endDate: string;
    status?: string;
    }
}

interface ProjectsEndingData {
  totalEndingSoon: number;
  endingProjects: Project[];
}

const API = {
  GET_PROJECTS_ENDING: {
    path: "/dashboard/projects-ending",
    method: "GET",
  },
};

export default function useProjectsEnding() {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  const [projectsData, setProjectsData] = useState<ProjectsEndingData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProjectsEnding = useCallback(async () => {
    if (!organizationId) return;

    setLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) return;

      // Fetch projects ending data
      const response = await request(API.GET_PROJECTS_ENDING, {}, token);

      if (response.success && response.data) {
        setProjectsData(response.data);
      } else {
        setError(response.message || "Failed to fetch projects data");
      }
    } catch (err) {
      console.error("Error fetching projects ending:", err);
      setError("An error occurred while fetching projects data");
    } finally {
      setLoading(false);
    }
  }, [organizationId, getToken]);

  useEffect(() => {
    fetchProjectsEnding();
  }, [fetchProjectsEnding]);

  return {
    projectsData,
    loading,
    error,
    refetch: fetchProjectsEnding,
  };
}
