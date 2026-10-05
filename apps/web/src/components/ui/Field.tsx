import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

export const CONTROL_CLASS =
  'h-8 w-full rounded-md border border-line-2 bg-surface px-2.5 text-[13px] text-text focus:border-accent focus:outline-2 focus:outline-offset-[-1px] focus:outline-accent disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-3';

interface FieldFrameProps {
  label: string;
  // Shown under the control: what the server (or the form) refused.
  error?: string | undefined;
  hint?: string | undefined;
  className?: string | undefined;
  children: (ids: { controlId: string; describedBy: string | undefined }) => ReactNode;
}

// Label, control and the message under it, wired for assistive technology.
function FieldFrame({ label, error, hint, className = '', children }: FieldFrameProps) {
  const controlId = useId();
  const messageId = useId();
  const message = error ?? hint;

  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label htmlFor={controlId} className="text-xs font-medium text-text-2">
        {label}
      </label>
      {children({ controlId, describedBy: message === undefined ? undefined : messageId })}
      {message !== undefined && (
        <p
          id={messageId}
          className={`text-xs ${error === undefined ? 'text-text-3' : 'text-crit'}`}
        >
          {message}
        </p>
      )}
    </div>
  );
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  className?: string | undefined;
  // SKU, quantities and money read better in the monospaced font.
  mono?: boolean;
}

export function TextField({
  label,
  error,
  hint,
  className,
  mono = false,
  ...input
}: TextFieldProps) {
  return (
    <FieldFrame label={label} error={error} hint={hint} className={className}>
      {({ controlId, describedBy }) => (
        <input
          id={controlId}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy}
          className={`${CONTROL_CLASS} ${mono ? 'font-mono' : ''}`}
          {...input}
        />
      )}
    </FieldFrame>
  );
}

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  label: string;
  options: { value: string; label: string }[];
  // Shown first, with an empty value, when nothing is chosen yet.
  placeholder?: string;
  error?: string | undefined;
  hint?: string | undefined;
  className?: string | undefined;
}

export function SelectField({
  label,
  options,
  placeholder,
  error,
  hint,
  className,
  ...select
}: SelectFieldProps) {
  return (
    <FieldFrame label={label} error={error} hint={hint} className={className}>
      {({ controlId, describedBy }) => (
        <select
          id={controlId}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy}
          className={CONTROL_CLASS}
          {...select}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldFrame>
  );
}
