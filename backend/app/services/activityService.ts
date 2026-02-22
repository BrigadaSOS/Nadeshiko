import { UserActivity, ActivityType, type UserActivityTrackData } from '@app/models/UserActivity';
import type { User } from '@app/models/User';

export async function trackActivity(user: User, type: ActivityType, data: UserActivityTrackData): Promise<void> {
  await UserActivity.trackForUser(user, type, data);
}
