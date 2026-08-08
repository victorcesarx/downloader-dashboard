import { t } from './i18n.js';
import { formatBytes } from './utils.js';

export function isKnownSize(size) {
  return Number.isFinite(size) && size >= 0;
}

export function formatMediaSize(size, decimals = 2) {
  return isKnownSize(size) ? formatBytes(size, decimals) : t('common.unknown');
}

export function summarizeMediaSizes(items) {
  let knownBytes = 0;
  let unknownCount = 0;
  for (const item of items) {
    if (isKnownSize(item?.size)) knownBytes += item.size;
    else unknownCount += 1;
  }
  return { knownBytes, unknownCount, allKnown: unknownCount === 0 };
}

export function formatSizeSummary(items) {
  const { knownBytes, unknownCount } = summarizeMediaSizes(items);
  if (unknownCount === 0) return formatBytes(knownBytes);
  if (knownBytes === 0) return t('common.unknown');
  return t('common.known_plus_unknown', {
    size: formatBytes(knownBytes),
    count: unknownCount,
  });
}
