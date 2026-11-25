export {
  CtanClient,
  DEFAULT_BASE_URL,
  defaultColorForMode,
  extractDisplayLineCode,
  normalizeHexColor,
  parseApiNumber,
  parseRetryAfterMs,
} from './api/client.js';
export type { CtanClientOptions } from './api/client.js';
export { CtamdApiError, CtamdError, CtamdValidationError } from './api/errors.js';
export { CACHE_DIR_ENV_VAR, getCacheDir } from './cache/paths.js';
export { CacheStore } from './cache/store.js';
export type { CacheStoreOptions, CachedOdScheduleData } from './cache/store.js';
export { syncConsortiumCatalog, syncConsortiumTopology } from './cache/sync.js';
export type { SyncCatalogOptions, SyncTopologyOptions } from './cache/sync.js';
export { SUPPORTED_SHELLS, generateCompletionScript } from './cli/completions.js';
export type { CompletionShell } from './cli/completions.js';
export { FavoritesStore, normalizeFavoriteAlias } from './config/favorites.js';
export type { FavoritesStoreOptions } from './config/favorites.js';
export {
  CONFIG_DIR_ENV_VAR,
  DEFAULT_CONSORCIO_ENV_VAR,
  getConfigDir,
} from './config/paths.js';
export { UserConfigStore } from './config/settings.js';
export type { UserConfigStoreOptions } from './config/settings.js';
export {
  CONSORTIUMS,
  findNearestConsortiums,
  getConsortiumById,
  isValidConsortiumId,
  resolveConsortium,
} from './consortiums.js';
export { Ctamd, findMatchingLine, normalizeLineQuery } from './ctamd.js';
export type { CtamdOptions, LineRoute, StopScheduleEntry } from './ctamd.js';
export { colorizeLineLabel, detectColorLevel, stripAnsi } from './format/colors.js';
export type { ColorLevel } from './format/colors.js';
export {
  ArrivalProviderRegistry,
  CtanScheduledProvider,
} from './realtime/provider.js';
export type { ArrivalProvider, StopArrivalQueryOptions } from './realtime/provider.js';
export { findAlternativeWalkSuggestion, findCandidateCorridors } from './routing/corridors.js';
export type {
  CandidateCorridor,
  CorridorAccessWalk,
  CorridorLeg,
  CorridorSearchOptions,
  CorridorTransfer,
} from './routing/corridors.js';
export { parseOdSchedule, partitionOdBlocks } from './routing/odParser.js';
export type { ParseOdScheduleOptions, ParsedOdSchedule } from './routing/odParser.js';
export {
  buildEstimatedJourneysFromCorridors,
  fetchStopTimesByLine,
  findJourneysFromCorridors,
  removeDominated,
  routeWithHydrationDetailed,
} from './routing/router.js';
export type { ScheduleLookup } from './routing/router.js';
export {
  defaultSpeedForMode,
  estimateLegDurationSeconds,
  pairLegDepartures,
} from './routing/scheduleMatcher.js';
export type { PairedDeparture } from './routing/scheduleMatcher.js';
export {
  DEFAULT_DEST_WALK_METERS,
  DEFAULT_ORIGIN_WALK_METERS,
  buildWalkTransferMap,
  estimateAccessWalkSeconds,
  findNearbyAccessWalks,
} from './routing/transfers.js';
export type { NearbyAccessWalk } from './routing/transfers.js';
export type * from './types.js';
export { isDateInPlannerRange, matchesFrequencyOnDate } from './utils/frequency.js';
export { boundingBox, haversineMeters, parseCoordinate } from './utils/geo.js';
export { cleanApiText, normalizeSearchText, splitCommaList } from './utils/text.js';
export {
  computeEtaMinutes,
  formatCtanHoraIni,
  formatDateKey,
  formatDurationHHMM,
  formatSecondsToHHMM,
  isSameLocalDay,
  normalizeScheduleSeconds,
  parseAfterOption,
  parseClockToSeconds,
  parseCtanTimestamp,
  resolveQueryDate,
  withLocalTime,
} from './utils/time.js';
