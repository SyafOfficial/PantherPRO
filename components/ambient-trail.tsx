/** Decorative CSS-only motion: no event listeners or client rendering work. */
export default function AmbientTrail() {
  return (
    <div className="ambient-trail" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}
