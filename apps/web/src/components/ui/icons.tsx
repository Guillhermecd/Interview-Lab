import type { ReactNode, SVGProps } from 'react';

// Line icons of the design handoff (D-45): 16×16 view box, 1.6 stroke, round
// ends. Decorative by default; the control that holds one carries the label.

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
}

const DEFAULT_SIZE = 14;

function createIcon(paths: ReactNode, defaults: SVGProps<SVGSVGElement> = {}) {
  return function Icon({ size = DEFAULT_SIZE, ...props }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...defaults}
        {...props}
      >
        {paths}
      </svg>
    );
  };
}

export const ShieldCheckIcon = createIcon(
  <>
    <path d="M8 1.8l5 2v4c0 3-2.2 5.2-5 6.4-2.8-1.2-5-3.4-5-6.4v-4z" />
    <path d="M5.8 8l1.6 1.6 3-3" />
  </>,
);

export const ShieldXIcon = createIcon(
  <>
    <path d="M8 1.8l5 2v4c0 3-2.2 5.2-5 6.4-2.8-1.2-5-3.4-5-6.4v-4z" />
    <path d="M6.3 6.3l3.4 3.4M9.7 6.3l-3.4 3.4" />
  </>,
);

export const PencilIcon = createIcon(<path d="M10.5 2.5l3 3-8 8h-3v-3z" />);

export const CopyIcon = createIcon(
  <>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </>,
);

export const PlayIcon = createIcon(<path d="M4 2.5l9 5.5-9 5.5z" />, {
  fill: 'currentColor',
  stroke: 'none',
});

export const CheckIcon = createIcon(<path d="M3.5 8.5l3 3 6-7" />);

export const CloseIcon = createIcon(<path d="M4 4l8 8M12 4l-8 8" />);

export const EyeIcon = createIcon(
  <>
    <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="2" />
  </>,
);

export const EyeOffIcon = createIcon(
  <>
    <path d="M6.4 3.7A6.4 6.4 0 0 1 8 3.5c4.1 0 6.5 4.5 6.5 4.5a11.6 11.6 0 0 1-1.7 2.3M10.9 11.7A6 6 0 0 1 8 12.5C3.9 12.5 1.5 8 1.5 8a11.3 11.3 0 0 1 2.7-3.2" />
    <path d="M6.6 6.6a2 2 0 0 0 2.8 2.8" />
    <path d="M2.5 2.5l11 11" />
  </>,
);

export const BanIcon = createIcon(
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M3.8 12.2l8.4-8.4" />
  </>,
);

export const ClockIcon = createIcon(
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.8V8l2.2 1.4" />
  </>,
);

export const RowsIcon = createIcon(<path d="M2.5 4h11M2.5 8h11M2.5 12h11" />);

export const HexagonIcon = createIcon(<path d="M8 2l5 3v6l-5 3-5-3V5z" />);

export const ZapIcon = createIcon(<path d="M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z" />, {
  fill: 'currentColor',
  stroke: 'none',
});

export const AlertTriangleIcon = createIcon(
  <>
    <path d="M8 2.2l6.2 11H1.8z" />
    <path d="M8 6.5v3M8 11.4v.01" />
  </>,
);

export const CheckCircleIcon = createIcon(
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M5.5 8.2l1.8 1.8 3.2-3.6" />
  </>,
);

export const InfoIcon = createIcon(
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7.2v3.8M8 5v.01" />
  </>,
);

export const DatabaseIcon = createIcon(
  <>
    <ellipse cx="8" cy="3.8" rx="5" ry="1.8" />
    <path d="M3 3.8v8.4c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V3.8M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8" />
  </>,
);

export const TableIcon = createIcon(
  <>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M2 6h12M6 6v7.5" />
  </>,
);

export const MessageSquareIcon = createIcon(
  <>
    <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
    <path d="M5.5 7h5" />
  </>,
);

export const ArrowUpIcon = createIcon(<path d="M8 13V3M4 7l4-4 4 4" />);

export const ArrowDownIcon = createIcon(<path d="M8 3v10M4 9l4 4 4-4" />);

export const SunIcon = createIcon(
  <>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
  </>,
);

export const MoonIcon = createIcon(<path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" />);

export const CalendarIcon = createIcon(
  <>
    <rect x="2" y="3" width="12" height="11" rx="1.5" />
    <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
  </>,
);

export const ChevronDownIcon = createIcon(<path d="M4 6l4 4 4-4" />);

// The mark of Rota Materiais: a route between two points.
export const RouteIcon = createIcon(
  <>
    <circle cx="3.5" cy="12.5" r="1.5" />
    <circle cx="12.5" cy="3.5" r="1.5" />
    <path d="M5 12.5h4.5a2.5 2.5 0 0 0 0-5h-3a2.5 2.5 0 0 1 0-5H11" />
  </>,
);
