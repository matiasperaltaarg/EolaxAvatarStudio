"use client";

import { useFormStatus } from "react-dom";

type Props = {
  /** Text shown in the browser confirm dialog. Destructive actions only. */
  message: string;
  children: React.ReactNode;
  className?: string;
  title?: string;
  /** Label while the server action runs. */
  pendingLabel?: string;
};

// Submit button that asks for confirmation before firing its form's server
// action, and disables itself while the action runs (double-click safety).
// Must be rendered inside the <form> it submits — useFormStatus reads the
// nearest parent form.
export default function ConfirmSubmit({
  message,
  children,
  className,
  title,
  pendingLabel,
}: Props) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={className}
      title={title}
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {pending ? (pendingLabel ?? "Eliminando…") : children}
    </button>
  );
}
