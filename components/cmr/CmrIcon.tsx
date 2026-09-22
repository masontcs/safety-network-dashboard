import type { CmrNavIcon } from '@/lib/cmr/roles'

type IconName = CmrNavIcon | 'menu' | 'sun' | 'moon' | 'signout' | 'lock' | 'plus' | 'close' | 'user' | 'grip' | 'up' | 'down' | 'edit' | 'check' | 'trash' | 'left' | 'right' | 'alert' | 'star' | 'undo'

const PATHS: Record<IconName, React.ReactNode> = {
  ledger: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></>,
  priorities: <><path d="M5 3v18" /><path d="M5 4h11l-2 4 2 4H5" /></>,
  rollup: <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>,
  recurring: <><path d="M4 8a8 8 0 0 1 13-3l3 3" /><path d="M20 4v4h-4" /><path d="M20 16a8 8 0 0 1-13 3l-3-3" /><path d="M4 20v-4h4" /></>,
  requests: <><path d="M3 5h18v14H3z" /><path d="M3 13h5l2 3h4l2-3h5" /></>,
  accounts: <><path d="M3 21h18" /><path d="M5 21V10l7-5 7 5v11" /><path d="M9 21v-6h6v6" /></>,
  access: <><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" /><path d="M9.5 12l2 2 3.5-4" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2.3-2.5 4" /><path d="M12 17.2v.01" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  sun: <><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  signout: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5" /><path d="M5 12h11" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  grip: <><circle cx="9" cy="6" r=".9" /><circle cx="15" cy="6" r=".9" /><circle cx="9" cy="12" r=".9" /><circle cx="15" cy="12" r=".9" /><circle cx="9" cy="18" r=".9" /><circle cx="15" cy="18" r=".9" /></>,
  up: <path d="M6 15l6-6 6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  trash: <><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" /></>,
  left: <path d="M15 6l-6 6 6 6" />,
  right: <path d="M9 6l6 6-6 6" />,
  alert: <><path d="M12 4 2.5 20h19z" /><path d="M12 10v4.5M12 17.5v.01" /></>,
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />,
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
}

/** Stroke icons from the approved mockup. Decorative by default (aria-hidden). */
export default function CmrIcon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={`cmr-ic${className ? ` ${className}` : ''}`}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
