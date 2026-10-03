interface ErrorMessageProps {
  message: string;
  details?: { message: string }[] | undefined;
}

export function ErrorMessage({ message, details }: ErrorMessageProps) {
  return (
    <div role="alert" className="rounded-lg bg-danger-surface px-3 py-2 text-sm text-danger">
      <p className="font-medium">{message}</p>
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
