type LuraLogoProps = {
  className?: string;
};

/** Original four-tentacle mark: compact enough for navigation, distinct at 24 px. */
export function LuraLogo({ className }: LuraLogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Lura"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="lura-octopus-gradient" x1="12" y1="9" x2="54" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#081A3A" />
          <stop offset="0.58" stopColor="#102E63" />
          <stop offset="1" stopColor="#1C4A8C" />
        </linearGradient>
      </defs>
      <path
        fill="url(#lura-octopus-gradient)"
        d="M32 6.5C18.3 6.5 9.5 16.1 9.5 29.8c0 7 3 12.6 8.8 16.8-1.9 1.4-4.1 2.2-6.8 2.2-3.4 0-5.7 2.1-5.2 5.1.6 3.7 5.1 5.6 10 4.5 4.1-.9 7.4-3.2 10-6.8.9 4.8 2.8 7.2 5.7 7.2s4.8-2.4 5.7-7.2c2.6 3.6 5.9 5.9 10 6.8 4.9 1.1 9.4-.8 10-4.5.5-3-1.8-5.1-5.2-5.1-2.7 0-4.9-.8-6.8-2.2 5.8-4.2 8.8-9.8 8.8-16.8C54.5 16.1 45.7 6.5 32 6.5Z"
      />
      <circle cx="24.4" cy="29.4" r="3.1" fill="#FFFFFF" />
      <circle cx="39.6" cy="29.4" r="3.1" fill="#FFFFFF" />
      <circle cx="24.4" cy="29.4" r="1.25" fill="#081A3A" />
      <circle cx="39.6" cy="29.4" r="1.25" fill="#081A3A" />
    </svg>
  );
}
