export type UpdateChannel = 'stable';

export const UPDATE_BASE_URL = 'https://clawclaw.xzinfra.com/updates';

export const UPDATE_FEEDS: Record<UpdateChannel, {
  url: string;
  allowPrerelease: boolean;
}> = {
  stable: {
    url: `${UPDATE_BASE_URL}/stable`,
    allowPrerelease: false,
  },
};
