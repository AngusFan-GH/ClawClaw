type ErrorWithMessageAndDetails = {
  message?: unknown;
  details?: unknown;
};

const CONNECT_ERROR_DETAIL_CODES = {
  AUTH_TOKEN_MISMATCH: 'AUTH_TOKEN_MISMATCH',
  AUTH_UNAUTHORIZED: 'AUTH_UNAUTHORIZED',
  AUTH_RATE_LIMITED: 'AUTH_RATE_LIMITED',
  PAIRING_REQUIRED: 'PAIRING_REQUIRED',
  CONTROL_UI_DEVICE_IDENTITY_REQUIRED: 'CONTROL_UI_DEVICE_IDENTITY_REQUIRED',
  CONTROL_UI_ORIGIN_NOT_ALLOWED: 'CONTROL_UI_ORIGIN_NOT_ALLOWED',
  AUTH_TOKEN_MISSING: 'AUTH_TOKEN_MISSING',
  AUTH_DEVICE_TOKEN_MISMATCH: 'AUTH_DEVICE_TOKEN_MISMATCH',
} as const;

function normalizeErrorMessage(message: unknown): string {
  if (typeof message === 'string') {
    return message;
  }
  if (message instanceof Error && typeof message.message === 'string') {
    return message.message;
  }
  return 'unknown error';
}

export function resolveGatewayErrorDetailCode(
  error: { details?: unknown } | null | undefined,
): string | null {
  const details = error?.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return null;
  }
  const code = (details as { code?: unknown }).code;
  return typeof code === 'string' && code.trim().length > 0 ? code : null;
}

function formatErrorFromMessageAndDetails(error: ErrorWithMessageAndDetails): string {
  const message = normalizeErrorMessage(error.message);
  const detailCode = resolveGatewayErrorDetailCode(error);

  switch (detailCode) {
    case CONNECT_ERROR_DETAIL_CODES.AUTH_TOKEN_MISMATCH:
      return 'Gateway token mismatch';
    case CONNECT_ERROR_DETAIL_CODES.AUTH_UNAUTHORIZED:
      return 'Gateway authentication failed';
    case CONNECT_ERROR_DETAIL_CODES.AUTH_RATE_LIMITED:
      return 'Too many failed Gateway authentication attempts';
    case CONNECT_ERROR_DETAIL_CODES.PAIRING_REQUIRED:
      return 'Gateway pairing required';
    case CONNECT_ERROR_DETAIL_CODES.CONTROL_UI_DEVICE_IDENTITY_REQUIRED:
      return 'Device identity required. Use localhost/secure context or explicitly allow insecure auth.';
    case CONNECT_ERROR_DETAIL_CODES.CONTROL_UI_ORIGIN_NOT_ALLOWED:
      return 'Control UI origin not allowed by Gateway configuration';
    case CONNECT_ERROR_DETAIL_CODES.AUTH_TOKEN_MISSING:
      return 'Gateway token missing';
    case CONNECT_ERROR_DETAIL_CODES.AUTH_DEVICE_TOKEN_MISMATCH:
      return 'Stored device token expired or mismatched';
    default:
      break;
  }

  const normalized = message.trim().toLowerCase();
  if (
    normalized === 'fetch failed' ||
    normalized === 'failed to fetch' ||
    normalized === 'connect failed'
  ) {
    return 'Gateway connection failed';
  }
  return message;
}

export function formatGatewayConnectError(error: unknown): string {
  if (error && typeof error === 'object') {
    return formatErrorFromMessageAndDetails(error as ErrorWithMessageAndDetails);
  }
  return normalizeErrorMessage(error);
}
