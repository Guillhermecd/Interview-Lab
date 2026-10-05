interface ErrorMessageProps {
  message: string;
  details?: { message: string }[] | undefined;
}

export function ErrorMessage({ message, details }: ErrorMessageProps) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-line-crit bg-crit-soft px-3.5 py-3 text-[13px] text-text-2"
    >
      <p className="text-[13.5px] font-semibold text-text">{message}</p>
      {details && details.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {details.map((detail) => (
            <li key={detail.message}>{detail.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
