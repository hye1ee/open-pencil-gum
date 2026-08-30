export const PARTICIPANT_ID_PATTERN = /^[a-z0-9-]{1,64}$/

/** Lowercase, spaces to hyphens, strip everything else, cap at 64 characters.
 * The result doubles as a directory segment on the dev server, so it must
 * match PARTICIPANT_ID_PATTERN or be treated as empty. */
export function normalizeParticipantId(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, '-')
    .replaceAll(/[^a-z0-9-]/g, '')
    .slice(0, 64)
  return PARTICIPANT_ID_PATTERN.test(normalized) ? normalized : ''
}
