/**
 * The three icons this plugin needs, inlined.
 *
 * Not @tabler/icons-react, even though kandev's own UI uses it: that package
 * builds every icon with `React.forwardRef(...)` at module scope, and this
 * bundle has no React until kandev calls `initialize`. Importing it makes the
 * whole bundle throw while it is being evaluated, and kandev reports only
 * "bundle did not call registerKandevPlugin".
 *
 * Paths are Tabler's (MIT), drawn with the same 24px grid and 2px stroke as
 * the surrounding kandev controls.
 */

type IconProps = { className?: string };

function Svg({ className, children }: IconProps & { children: unknown }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children as never}
    </svg>
  );
}

export function IconMicrophone({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path key="microphone" d="M9 5a3 3 0 0 1 6 0v5a3 3 0 0 1 -6 0z" />
      <path key="microphone-arc" d="M5 10a7 7 0 0 0 14 0" />
      <path key="microphone-base" d="M8 21h8" />
      <path key="microphone-stem" d="M12 17v4" />
    </Svg>
  );
}

export function IconPlayerStopFilled({ className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      className={className}
    >
      <path key="stop" d="M17 4h-10a3 3 0 0 0 -3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3 -3v-10a3 3 0 0 0 -3 -3z" />
    </svg>
  );
}

export function IconLoader({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path key="loader" d="M12 3a9 9 0 1 0 9 9" />
    </Svg>
  );
}
