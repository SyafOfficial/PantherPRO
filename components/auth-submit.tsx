"use client";
import { useFormStatus } from "react-dom";
export default function AuthSubmit({
  disabled,
  label,
}: {
  disabled: boolean;
  label: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className="primary-button"
      disabled={disabled || pending}
      aria-busy={pending}
    >
      {pending ? "Connecting…" : label}
    </button>
  );
}
