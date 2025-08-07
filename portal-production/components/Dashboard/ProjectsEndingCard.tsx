"use client";
import React, { useEffect } from "react";
import { Box, Card, CardContent, Typography, CircularProgress, Alert, List, ListItem, ListItemText } from "@mui/material";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import useProjectsEnding from "@/hooks/useProjectsEnding";
import moment from "moment";

export default function ProjectsEndingCard() {
  const { projectsData, loading, error } = useProjectsEnding();

  useEffect(() => {
    console.log("🔍 Projects data:", projectsData);
  }, [projectsData]);

  return (
    <Card sx={{ height: "100%", display: "flex", flexDirection: "column", backgroundColor: "white" }}>
      <CardContent sx={{ flexGrow: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <AccountTreeIcon sx={{ fontSize: 32, mr: 1, color: "info.main" }} />
          <Typography variant="h6" component="h2">
            Projects Ending Soon
          </Typography>
        </Box>

        {loading && <CircularProgress />}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}

        {!loading && !error && projectsData && (
          <Box>
            <Typography variant="h3" sx={{ mb: 1, fontWeight: "bold", color: "info.main" }}>
              {projectsData.data.totalEndingSoon}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Projects Ending in 10 Days
            </Typography>

            {projectsData.data.endingProjects && projectsData.data.endingProjects.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" sx={{ mb: 1, fontWeight: "bold" }}>
                  Upcoming Deadlines:
                </Typography>
                <List dense>
                  {projectsData.data.endingProjects.slice(0, 3).map((project, index) => (
                    <ListItem key={index} sx={{ py: 0.5, px: 0 }}>
                      <ListItemText
                        primary={<Typography variant="body2">{project.data.name}</Typography>}
                        secondary={
                          <Typography variant="caption" color="text.secondary">
                            End Date: {moment(project.data.endDate).format("DD/MM/YYYY")}({moment(project.data.endDate).diff(moment(), "days")} days left)
                          </Typography>
                        }
                      />
                    </ListItem>
                  ))}
                </List>
              </Box>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
