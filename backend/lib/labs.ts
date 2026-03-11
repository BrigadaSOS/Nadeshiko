import type { User } from '@app/models/User';

export interface LabDefinition {
  key: string;
  name: string;
  description: string;
  allowedUserIds?: number[];
}

const LABS: LabDefinition[] = [
  {
    key: 'interactive-tokens',
    name: 'Interactive Tokens & Enhanced Highlighting',
    description: 'Break Japanese sentences into clickable word tokens and extend search highlights to cover full conjugated forms.',
  },
];

function isVisible(user: User, lab: LabDefinition): boolean {
  return !lab.allowedUserIds || lab.allowedUserIds.length === 0 || lab.allowedUserIds.includes(user.id);
}

export function isLabActive(user: User, key: string): boolean {
  const lab = LABS.find((l) => l.key === key);
  if (!lab || !isVisible(user, lab)) return false;

  return user.labEnrollments?.some((e) => e.labKey === key) ?? false;
}

export function getLabsForUser(user: User): Array<{ lab: LabDefinition; active: boolean }> {
  return LABS.filter((lab) => isVisible(user, lab)).map((lab) => ({
    lab,
    active: user.labEnrollments?.some((e) => e.labKey === lab.key) ?? false,
  }));
}

export function isLabVisible(user: User, key: string): boolean {
  const lab = LABS.find((l) => l.key === key);
  if (!lab) return false;

  return isVisible(user, lab);
}
