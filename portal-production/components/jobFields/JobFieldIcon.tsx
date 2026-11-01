"use client";

import React from "react";
import type { SvgIconProps } from "@mui/material";
import AssignmentIcon from "@mui/icons-material/Assignment";
import VerifiedIcon from "@mui/icons-material/Verified";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import LockIcon from "@mui/icons-material/Lock";
import KeyIcon from "@mui/icons-material/Key";
import BuildIcon from "@mui/icons-material/Build";
import EventIcon from "@mui/icons-material/Event";
import DescriptionIcon from "@mui/icons-material/Description";
import LinkIcon from "@mui/icons-material/Link";
import FlagIcon from "@mui/icons-material/Flag";
import StarIcon from "@mui/icons-material/Star";
import InfoIcon from "@mui/icons-material/Info";
import PersonIcon from "@mui/icons-material/Person";
import PhoneIcon from "@mui/icons-material/Phone";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import BlockIcon from "@mui/icons-material/Block";

// Custom job fields (enableJobFields): the icon keys an admin can pick
// (api-server-production/src/deliveries/job-fields.ts JOB_FIELD_ICONS) → MUI icons.
const ICONS: Record<string, React.ComponentType<SvgIconProps>> = {
  permit: AssignmentIcon,
  verified: VerifiedIcon,
  warning: WarningAmberIcon,
  lock: LockIcon,
  key: KeyIcon,
  build: BuildIcon,
  event: EventIcon,
  description: DescriptionIcon,
  link: LinkIcon,
  flag: FlagIcon,
  star: StarIcon,
  info: InfoIcon,
  person: PersonIcon,
  phone: PhoneIcon,
  camera: PhotoCameraIcon,
  block: BlockIcon,
};

export const JOB_FIELD_ICON_KEYS = Object.keys(ICONS);

export default function JobFieldIcon({ icon, ...props }: { icon?: string | null } & SvgIconProps) {
  const C = ICONS[icon || "info"] ?? InfoIcon;
  return <C {...props} />;
}
