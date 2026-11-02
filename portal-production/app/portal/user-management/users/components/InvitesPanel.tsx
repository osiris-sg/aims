"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useCallback, useEffect, useState } from "react";
import { Box, Chip, IconButton, Menu, MenuItem, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { request } from "@/helpers/request";

interface Invite {
  id: string;
  email: string;
  roles: string[];
  invitedByName: string | null;
  createdAt: string;
}

/** Open invitations of this org (emails with no AIMS login yet). Hidden when there are none. */
export default function InvitesPanel({ refreshKey }: { refreshKey: number }) {
  const t = useTranslations("users.invite");
  const { getToken } = useAuth();
  const [rows, setRows] = useState<Invite[]>([]);
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; row: Invite } | null>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    const res: any = await request({ method: "GET", path: "/users/members/invites" }, {}, token);
    setRows(res?.success && Array.isArray(res.data) ? res.data : []);
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const cancel = async (row: Invite) => {
    setMenu(null);
    if (!window.confirm(t("cancelConfirm", { email: row.email }))) return;
    const token = await getToken();
    if (!token) return;
    await request({ method: "DELETE", path: `/users/members/invites/${row.id}` }, {}, token);
    void load();
  };

  if (!rows.length) return null;
  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        {t("invitedTitle")}
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t("email")}</TableCell>
            <TableCell>{t("roles")}</TableCell>
            <TableCell>{t("invitedBy")}</TableCell>
            <TableCell>{t("sent")}</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} hover>
              <TableCell>
                {r.email} <Chip size="small" label={t("invited")} sx={{ ml: 1 }} />
              </TableCell>
              <TableCell>{r.roles.join(", ") || "-"}</TableCell>
              <TableCell>{r.invitedByName || "-"}</TableCell>
              <TableCell>{new Date(r.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</TableCell>
              <TableCell align="right">
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenu({ pos: { left: e.clientX, top: e.clientY }, row: r });
                  }}
                >
                  <MoreVertIcon fontSize="small" />
                </IconButton>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Menu open={!!menu} onClose={() => setMenu(null)} anchorReference="anchorPosition" anchorPosition={menu?.pos}>
        <MenuItem sx={{ color: "error.main" }} onClick={() => menu && void cancel(menu.row)}>
          {t("cancel")}
        </MenuItem>
      </Menu>
    </Box>
  );
}
