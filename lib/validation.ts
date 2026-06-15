// Shared field validators — usable from both server actions and client forms.

/**
 * A LinkedIn URL is valid when it's empty (the field is optional) or contains
 * "linkedin.com". The scheme is not required — "linkedin.com/in/jane" and
 * "www.linkedin.com/in/jane" both pass, "https://" is optional.
 */
export function isValidLinkedinUrl(value: string | null | undefined): boolean {
  const v = (value ?? "").trim();
  if (!v) return true;
  return /(^|[./@])linkedin\.com/i.test(v);
}

export const LINKEDIN_URL_ERROR = "LinkedIn URL must contain linkedin.com.";
