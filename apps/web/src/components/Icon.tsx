import type { SVGProps } from "react";

export type IconName =
  | "calendar"
  | "check"
  | "chevron-left"
  | "chevron-right"
  | "clipboard"
  | "layers"
  | "logout"
  | "menu"
  | "plus"
  | "settings"
  | "spark"
  | "sun"
  | "arrow-up-right";

const paths: Record<IconName, string> = {
  calendar: "M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
  check: "m5 12 4 4L19 6",
  "chevron-left": "m15 18-6-6 6-6",
  "chevron-right": "m9 18 6-6-6-6",
  clipboard: "M9 5h6m-8 3h6m-6 4h6m4-9h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h1",
  layers: "m12 3 8 4-8 4-8-4 8-4Zm-8 9 8 4 8-4M4 16l8 4 8-4",
  logout: "M10 17l5-5-5-5m5 5H3m10-7V4a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-1",
  menu: "M4 6h16M4 12h16M4 18h16",
  plus: "M12 5v14M5 12h14",
  settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.42 1.42-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20h-2v-.48a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-1.42-1.42.06-.06A1.7 1.7 0 0 0 9.4 15a1.7 1.7 0 0 0-1.56-1.03H7v-2h.84A1.7 1.7 0 0 0 9.4 11a1.7 1.7 0 0 0-.34-1.88L9 9.06l1.42-1.42.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 13.39 6.5V6h2v.5a1.7 1.7 0 0 0 1.03 1.54 1.7 1.7 0 0 0 1.88-.34l.06-.06 1.42 1.42-.06.06A1.7 1.7 0 0 0 19.4 11a1.7 1.7 0 0 0 1.56 1.03H21v2h-.04A1.7 1.7 0 0 0 19.4 15Z",
  spark: "m12 3 1.2 5.8L19 10l-5.8 1.2L12 17l-1.2-5.8L5 10l5.8-1.2L12 3Zm6 12 .5 2.5L21 18l-2.5.5L18 21l-.5-2.5L15 18l2.5-.5L18 15Z",
  sun: "M12 3v2m0 14v2M5.64 5.64l1.42 1.42m9.9 9.9 1.4 1.4M3 12h2m14 0h2M5.64 18.36l1.42-1.42m9.9-9.9 1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  "arrow-up-right": "M7 17 17 7M8 7h9v9",
};

export function Icon({ name, size = 18, ...props }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
