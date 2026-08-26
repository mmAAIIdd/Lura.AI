import { useId } from 'react';

type LuraLogoProps = {
  className?: string;
};

export function LuraLogo({ className }: LuraLogoProps) {
  const gradientId = useId();

  return (
    <svg
      className={className}
      viewBox="0 0 128 128"
      role="img"
      aria-label="Lura"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gradientId} x1="34" y1="20" x2="98" y2="108" gradientUnits="userSpaceOnUse">
          <stop stopColor="#071831" />
          <stop offset="0.5" stopColor="#0D2854" />
          <stop offset="1" stopColor="#163B73" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradientId})`}
        d="M64 18C47.7 18 37.5 29.2 37.5 45.7c0 9.9 3.8 15.2 8.2 20.1 2.6 3 1.5 6.5-1.9 8-4 1.8-7.4-.2-10.6-3.6-3.3-3.5-8.2-1.5-9.3 3.7-1.6 7.4 4.7 12 11.9 11.6 6.2-.3 10.7-3.1 15.1-8 2.9-3.2 5-1.1 3.6 4.1-1.5 5.5-5.4 7.6-9.4 10.2-4.6 2.9-6.4 8.1-3.2 11.4 3.8 3.9 10 1.3 14.1-2.9 5.2-5.3 6.6-12.4 7.1-19.4.2-3.4 1.5-5 3.9-5s3.7 1.6 3.9 5c.5 7 1.9 14.1 7.1 19.4 4.1 4.2 10.3 6.8 14.1 2.9 3.2-3.3 1.4-8.5-3.2-11.4-4-2.6-7.9-4.7-9.4-10.2-1.4-5.2.7-7.3 3.6-4.1 4.4 4.9 8.9 7.7 15.1 8 7.2.4 13.5-4.2 11.9-11.6-1.1-5.2-6-7.2-9.3-3.7-3.2 3.4-6.6 5.4-10.6 3.6-3.4-1.5-4.5-5-1.9-8 4.4-4.9 8.2-10.2 8.2-20.1C90.5 29.2 80.3 18 64 18Z"
      />
    </svg>
  );
}
