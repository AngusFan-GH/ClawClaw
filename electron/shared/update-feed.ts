export type UpdateChannel = 'stable' | 'beta' | 'dev';

export const UPDATE_BASE_URL = 'https://clawclaw.xzinfra.com/updates';

export const UPDATE_FEEDS: Record<
  UpdateChannel,
  {
    url: string;
    allowPrerelease: boolean;
  }
> = {
  stable: {
    url: `${UPDATE_BASE_URL}/stable`,
    allowPrerelease: false,
  },
  beta: {
    url: `${UPDATE_BASE_URL}/stable`,
    allowPrerelease: false,
  },
  dev: {
    url: `${UPDATE_BASE_URL}/stable`,
    allowPrerelease: false,
  },
};
