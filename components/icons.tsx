"use client";
import { HugeiconsIcon, type HugeiconsIconProps } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";

export function Icon({
  icon,
  size = 17,
  strokeWidth = 1.8,
  ...props
}: Omit<HugeiconsIconProps, "icon"> & { icon: IconSvgElement }) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}
