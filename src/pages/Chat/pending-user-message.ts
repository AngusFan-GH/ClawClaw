import type { RawMessage } from '@/stores/chat';
import { extractText } from './message-utils';

function normalizeComparableUserMessageText(message: RawMessage | null | undefined): string {
  return extractText(message).replace(/\s+/g, ' ').trim();
}

function getComparableAttachmentPaths(message: RawMessage | null | undefined): string[] {
  return (message?._attachedFiles || [])
    .map((file) => (typeof file.filePath === 'string' ? file.filePath.trim() : ''))
    .filter(Boolean)
    .sort();
}

function haveSameComparableAttachments(left: RawMessage | null | undefined, right: RawMessage | null | undefined): boolean {
  const leftPaths = getComparableAttachmentPaths(left);
  const rightPaths = getComparableAttachmentPaths(right);
  if (leftPaths.length !== rightPaths.length) return false;
  return leftPaths.every((path, index) => path === rightPaths[index]);
}

function isLikelySamePendingUserMessage(
  historyMessage: RawMessage,
  pendingUserMessage: RawMessage,
  optimisticTimestampMs?: number,
): boolean {
  if (historyMessage.role !== 'user' || pendingUserMessage.role !== 'user') {
    return false;
  }

  if (
    typeof historyMessage.idempotencyKey === 'string'
    && historyMessage.idempotencyKey.length > 0
    && historyMessage.idempotencyKey === pendingUserMessage.idempotencyKey
  ) {
    return true;
  }

  const historyText = normalizeComparableUserMessageText(historyMessage);
  const pendingText = normalizeComparableUserMessageText(pendingUserMessage);
  if (!pendingText || historyText !== pendingText) {
    return false;
  }

  if (optimisticTimestampMs && historyMessage.timestamp) {
    const historyTimestampMs = historyMessage.timestamp < 1e12
      ? historyMessage.timestamp * 1000
      : historyMessage.timestamp;
    if (Math.abs(historyTimestampMs - optimisticTimestampMs) > 5 * 60_000) {
      return false;
    }
  }

  return haveSameComparableAttachments(historyMessage, pendingUserMessage);
}

export function historyContainsPendingUserMessage(
  history: RawMessage[],
  pendingUserMessage: RawMessage | null,
  options: { optimisticTimestampMs?: number } = {},
): boolean {
  if (!pendingUserMessage) return false;

  if (history.some((message) => isLikelySamePendingUserMessage(message, pendingUserMessage, options.optimisticTimestampMs))) {
    return true;
  }

  const latestHistoryTimestampMs = history.reduce((latest, message) => {
    if (!message.timestamp) return latest;
    const ts = message.timestamp < 1e12 ? message.timestamp * 1000 : message.timestamp;
    return ts > latest ? ts : latest;
  }, 0);
  if (
    options.optimisticTimestampMs
    && latestHistoryTimestampMs > 0
    && latestHistoryTimestampMs < options.optimisticTimestampMs - 5 * 60_000
  ) {
    return false;
  }

  const latestHistoryUser = [...history].reverse().find((message) => message.role === 'user');
  return latestHistoryUser
    ? isLikelySamePendingUserMessage(latestHistoryUser, pendingUserMessage)
    : false;
}
