"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import {
  Box,
  Card,
  CardContent,
  Grid,
  IconButton,
  Skeleton,
  Typography,
} from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import CalendarMonthOutlinedIcon from "@mui/icons-material/CalendarMonthOutlined";
import DraftsOutlinedIcon from "@mui/icons-material/DraftsOutlined";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import { Button } from "@mui/material";
import moment from "moment";
import { toast } from "react-toastify";
import DocumentUploadDialog from "./DocumentUploadDialog";

interface Props {
  documentTypes: string[];
  documentLabel: string;
  pluralLabel?: string;
  createDocumentType: string;
}

interface DocumentRow {
  id: string;
  name: string;
  documentType: string;
  templateId: string;
  status: string;
  createdAt: string;
  associated_customer?: string;
  associated_item?: string;
  config?: any;
}

const formatStatus = (status: string) => {
  if (!status) return "Draft";
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};

const getStatusColor = (status: string) => {
  switch (status) {
    case "draft":
      return "text.secondary";
    case "confirmed":
    case "delivered_installed":
    case "paid":
      return "success.main";
    case "pending_delivery":
    case "pending_payment":
    case "pending_return":
      return "warning.main";
    case "delivered_not_installed":
      return "info.main";
    default:
      return "text.primary";
  }
};

function StatCard({
  title,
  value,
  icon,
  color,
  bgColor,
  loading,
}: {
  title: string;
  value: number | string;
  icon: React.ReactElement;
  color: string;
  bgColor: string;
  loading?: boolean;
}) {
  return (
    <Card
      elevation={0}
      sx={{
        border: 1,
        borderColor: "divider",
        height: "100%",
        transition: "all 0.3s ease",
        "&:hover": { boxShadow: 2, transform: "translateY(-2px)" },
      }}
    >
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
          <Typography
            variant="caption"
            sx={{ color: "text.secondary", fontWeight: 500, fontSize: "0.75rem", letterSpacing: "0.5px" }}
          >
            {title}
          </Typography>
          <Box
            sx={{
              backgroundColor: bgColor,
              borderRadius: "50%",
              p: 0.5,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {React.cloneElement(icon, { sx: { fontSize: 20, color } })}
          </Box>
        </Box>
        {loading ? (
          <Skeleton variant="text" width="60%" height={40} />
        ) : (
          <Typography variant="h5" sx={{ fontWeight: 600, color, mt: 1 }}>
            {value}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

export default function DocumentListView({
  documentTypes,
  documentLabel,
  pluralLabel,
  createDocumentType,
}: Props) {
  const router = useRouter();
  const { getToken } = useAuth();
  const { organization } = useOrganization();

  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({
    status: "",
    createdOn: { startDate: null, endDate: null },
  });
  const [uploadOpen, setUploadOpen] = useState(false);

  const fetchDocs = useCallback(async () => {
    if (!organization?.id) return;
    setLoading(true);
    try {
      const token = await getToken();
      const response = await request(
        { path: "/documents", method: "POST" },
        { organizationId: organization.id },
        token ?? undefined
      );
      if (response?.success && Array.isArray(response.data)) {
        const filtered = response.data
          .filter((d: any) => documentTypes.includes(d.documentType))
          .sort(
            (a: any, b: any) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
        setDocs(filtered);
      } else {
        setDocs([]);
      }
    } catch (err) {
      console.error("DocumentListView fetch error:", err);
      toast.error(`Failed to load ${pluralLabel || documentLabel}`);
    } finally {
      setLoading(false);
    }
  }, [organization?.id, getToken, documentTypes, documentLabel, pluralLabel]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  const handleCreate = async () => {
    if (!organization?.id || !createDocumentType || creating) return;
    setCreating(true);
    try {
      const token = await getToken();
      const tmpl = await request(
        { path: `/documentTemplates/type/${createDocumentType}`, method: "GET" },
        {},
        token ?? undefined
      );
      const templateId = tmpl?.data?.id;
      if (!templateId) {
        toast.error(`No template found for ${documentLabel}`);
        return;
      }
      const created = await request(
        { path: "/documents/basic", method: "POST" },
        {
          type: createDocumentType,
          config: {},
          documentTemplateId: templateId,
          organizationId: organization.id,
        },
        token ?? undefined
      );
      if (created?.success && created?.data?.id) {
        router.push(`/portal/documents/${createDocumentType}/${templateId}/${created.data.id}`);
      } else {
        toast.error(`Failed to create ${documentLabel}`);
      }
    } catch (err) {
      console.error("DocumentListView create error:", err);
      toast.error(`Failed to create ${documentLabel}`);
    } finally {
      setCreating(false);
    }
  };

  const stats = React.useMemo(() => {
    const monthStart = moment().startOf("month");
    let thisMonth = 0;
    let drafts = 0;
    docs.forEach((d) => {
      if (moment(d.createdAt).isSameOrAfter(monthStart)) thisMonth += 1;
      if ((d.status || "draft") === "draft") drafts += 1;
    });
    return { total: docs.length, thisMonth, drafts };
  }, [docs]);

  const columns = [
    {
      accessorKey: "name",
      header: `${documentLabel} #`,
      cell: ({ row }: any) => row.original.name || "—",
    },
    {
      accessorKey: "associated_customer",
      header: "Customer",
      cell: ({ row }: any) => row.original.associated_customer || "—",
    },
    {
      accessorKey: "associated_item",
      header: "Item",
      cell: ({ row }: any) => row.original.associated_item || "—",
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }: any) => {
        const status = row.original.status || "draft";
        return (
          <Box sx={{ color: getStatusColor(status), fontWeight: 500, textTransform: "capitalize" }}>
            {formatStatus(status)}
          </Box>
        );
      },
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      cell: ({ row }: any) => moment(row.original.createdAt).format("DD/MM/YYYY"),
    },
    {
      accessorKey: "action",
      header: "Action",
      cell: ({ row }: any) => {
        const { documentType, templateId, id } = row.original;
        return (
          <IconButton
            onClick={() => router.push(`/portal/documents/${documentType}/${templateId}/${id}`)}
            sx={{ color: "text.secondary", "&:hover": { color: "primary.main" } }}
          >
            <VisibilityIcon />
          </IconButton>
        );
      },
    },
  ];

  const serializeDate = (d: Date | null) => (d ? JSON.parse(JSON.stringify(d)) : null);
  const handleSetFilters = (newFilters: any) => {
    setFilters({
      ...newFilters,
      createdOn: {
        startDate: newFilters.createdOn?.startDate
          ? serializeDate(new Date(newFilters.createdOn.startDate))
          : null,
        endDate: newFilters.createdOn?.endDate
          ? serializeDate(new Date(newFilters.createdOn.endDate))
          : null,
      },
    });
  };

  const uploadButton = createDocumentType ? (
    <Button
      key="upload-doc"
      variant="outlined"
      startIcon={<CloudUploadIcon />}
      onClick={() => setUploadOpen(true)}
      disabled={creating}
    >
      Upload {documentLabel}
    </Button>
  ) : null;

  return (
    <MainCard>
      <PageTable
        columns={columns}
        data={docs}
        tableName={`${pluralLabel || documentLabel + "s"} List`}
        subTitle={`All ${pluralLabel || documentLabel + "s"} for this organization`}
        buttonName={createDocumentType ? `Create ${documentLabel}` : undefined}
        onAddClick={createDocumentType ? handleCreate : undefined}
        buttonDisabled={creating}
        actionButtons={uploadButton ? [uploadButton] : undefined}
        loading={loading || creating}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={handleSetFilters}
        availableFilters={["status", "createdOn"]}
        pageCount={1}
        totalDocs={docs.length}
        headerContent={
          <Box sx={{ mb: 3 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}>
                <StatCard
                  title={`TOTAL ${(pluralLabel || documentLabel + "S").toUpperCase()}`}
                  value={stats.total}
                  icon={<DescriptionOutlinedIcon />}
                  color="primary.main"
                  bgColor="surfaceTones.high"
                  loading={loading}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <StatCard
                  title="THIS MONTH"
                  value={stats.thisMonth}
                  icon={<CalendarMonthOutlinedIcon />}
                  color="success.main"
                  bgColor="success.light"
                  loading={loading}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <StatCard
                  title="DRAFTS"
                  value={stats.drafts}
                  icon={<DraftsOutlinedIcon />}
                  color="customYellow.dark"
                  bgColor="customYellow.light"
                  loading={loading}
                />
              </Grid>
            </Grid>
          </Box>
        }
      />
      {createDocumentType && (
        <DocumentUploadDialog
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          documentType={createDocumentType}
          documentLabel={documentLabel}
        />
      )}
    </MainCard>
  );
}
