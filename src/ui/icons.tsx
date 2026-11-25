import type { ReactNode, SVGProps } from 'react'

/*
 * Icons. General-purpose icons come from lucide-react (import them directly
 * where used). This file holds the D&D-specific glyphs lucide does not have,
 * drawn in the same 24 px, 1.8 px-stroke style so they sit together.
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Glyph({ size = 20, children, ...rest }: IconProps & { children: ReactNode }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>{children}</svg>
}

export function D20Icon(props: IconProps) {
  return <Glyph {...props}><path d="M12 2l9 5v10l-9 5-9-5V7z" /><path d="M12 2L7.5 9.5h9zM3 7l4.5 2.5M21 7l-4.5 2.5M7.5 9.5L12 17l4.5-7.5M12 17v5M7.5 9.5L3 17M16.5 9.5L21 17M3 17h18" /></Glyph>
}

export function CrossedSwordsIcon(props: IconProps) {
  return <Glyph {...props}><path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 17.5L21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4M5 21l-2-2" /></Glyph>
}

export function GrimoireIcon(props: IconProps) {
  return <Glyph {...props}><path d="M4 5c3-1 5-1 8 1 3-2 5-2 8-1v14c-3-1-5-1-8 1-3-2-5-2-8-1z" /><path d="M12 6v14" /></Glyph>
}

export function BeholderEyeIcon(props: IconProps) {
  return <Glyph {...props}><path d="M2 12c3-5 6-7 10-7s7 2 10 7c-3 5-6 7-10 7s-7-2-10-7z" /><circle cx="12" cy="12" r="3" /></Glyph>
}
