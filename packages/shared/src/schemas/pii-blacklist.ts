/**
 * PII field name blacklist for event payload validation.
 *
 * Events are anonymous by design. Any payload key matching this blacklist
 * causes Zod validation to fail. This is a first-line defence — it does NOT
 * replace infrastructure-level DLP scanning.
 *
 * @see GDPR Art. 5(1)(c) — data minimisation principle
 * @module @estalara/shared/schemas/pii-blacklist
 */

/** Normalise a key for blacklist comparison: lowercase, strip separators. */
export function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '');
}

export const PII_BLACKLIST = new Set([
  // Email
  'email',
  'mail',
  'emailaddress',
  // Phone
  'phone',
  'mobile',
  'phonenumber',
  'tel',
  'telephone',
  'cellphone',
  // Name
  'fullname',
  'firstname',
  'lastname',
  'name',
  'username',
  'givenname',
  'familyname',
  'surname',
  // Address
  'address',
  'streetaddress',
  'homeaddress',
  'postalcode',
  'zip',
  'zipcode',
  'city',
  'street',
  // Network identifiers
  'ip',
  'ipaddress',
  'remoteaddr',
  'xforwardedfor',
  // Government IDs
  'ssn',
  'socialsecurity',
  'nationalid',
  'passport',
  'driverslicense',
  'taxid',
  // Financial
  'creditcard',
  'cardnumber',
  'cvv',
  'iban',
  'bankaccount',
  // Biometric / sensitive
  'dateofbirth',
  'dob',
  'birthday',
  'birthdate',
  'gender',
  'nationality',
]);

/**
 * Zod superRefine callback that recursively walks an unknown value and
 * rejects any object key whose normalised form appears in PII_BLACKLIST.
 *
 * Usage:
 *   z.object({ payload: z.record(z.unknown()) })
 *     .superRefine((data, ctx) => noPii(data.payload, ctx, ['payload']))
 */
export function noPii(
  value: unknown,
  ctx: {
    addIssue: (issue: { code: 'custom'; message: string; path: (string | number)[] }) => void;
  },
  path: (string | number)[] = [],
): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (PII_BLACKLIST.has(normaliseKey(key))) {
      ctx.addIssue({
        code: 'custom',
        message: `PII field detected in event payload: "${key}". Events must be anonymous — remove or hash this field before sending.`,
        path: [...path, key],
      });
    }
    noPii(child, ctx, [...path, key]);
  }
}
