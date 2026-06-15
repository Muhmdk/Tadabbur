/**
 * Layout for the projector route group. Forces a full-viewport, chromeless
 * container so captions can fill the screen. No nav, no padding.
 */
export default function DisplayLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <main className="fixed inset-0 overflow-hidden">{children}</main>;
}
