export type ConsortiumId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type ApiLang = 'ES' | 'EN';

export interface ConsortiumInfo {
  id: ConsortiumId;
  shortCode: string;
  name: string;
  domain: string;
  province: string;
  aliases: readonly string[];
  centerLat: number;
  centerLon: number;
  radiusKm: number;
}

export interface Municipality {
  id: string;
  name: string;
}

export interface Nucleo {
  id: string;
  municipioId: string;
  zoneId: string;
  name: string;
}

export interface TariffZone {
  id: string;
  name: string;
  color: string | null;
}

export interface TransportMode {
  id: string;
  description: string;
  observations: string;
}

export interface FrequencyDef {
  id: string;
  acronym: string;
  name: string;
}

export interface StopLineRef {
  lineId: string;
  code: string;
  displayCode: string;
  color: string;
}

export interface LineDirectionInfo {
  direction: number;
  destination: string;
  startTime: string;
  endTime: string;
}

export interface Line {
  id: string;
  code: string;
  displayCode: string;
  name: string;
  modeId: string;
  mode: string;
  operators: string[];
  hasNews: boolean;
  color: string;
  isCircular: boolean;
  directions: LineDirectionInfo[];
}

export interface LineDetail extends Line {
  pmr: string;
  concession: string;
  observations: string;
  hasOutbound: boolean;
  hasInbound: boolean;
  thermometerOutboundUrl: string | null;
  thermometerInboundUrl: string | null;
  polyline: string | null;
  polylineOutbound: string | null;
  polylineInbound: string | null;
}

export interface LineStop {
  id: string;
  code: string;
  name: string;
  nucleoId: string;
  zoneId: string;
  lat: number | null;
  lon: number | null;
  direction: number;
  order: number;
  distanceMeters: number;
  modes: string;
  startTime: string | null;
  endTime: string | null;
}

export interface Stop {
  id: string;
  code: string;
  name: string;
  nucleoId: string;
  nucleoName: string;
  municipioId: string;
  municipioName: string;
  zoneId: string;
  lat: number | null;
  lon: number | null;
  modes: string;
  lines: StopLineRef[];
  correspondencesRaw?: string[];
  observations?: string;
  inactive?: boolean;
}

export type ArrivalSource = 'scheduled' | 'realtime';

export type StopBoardingType = 'normal' | 'board_only' | 'alight_only';

export interface StopService {
  lineId: string;
  lineCode: string;
  displayCode: string;
  lineName: string;
  lineColor: string;
  direction: number;
  destination: string;
  departureTime: string;
  departureSeconds: number;
  etaMinutes: number;
  stopType: StopBoardingType;
  source: ArrivalSource;
  distanceMeters: number | null;
  vehicle: string | null;
}

export interface StopServicesResult {
  consorcioId: ConsortiumId;
  stopId: string;
  stopCode: string;
  stopName: string;
  nucleoName: string;
  lat: number | null;
  lon: number | null;
  windowStart: string;
  windowEnd: string;
  fetchedAt: string;
  stale: boolean;
  source: ArrivalSource;
  providerName: string;
  services: StopService[];
}

export interface LineScheduleBlock {
  name: string;
  color: string | null;
  type: string;
}

export interface LineScheduleNucleoHeader {
  name: string;
  colspan: number;
  color: string | null;
}

export interface LineScheduleTrip {
  times: string[];
  frequencyAcronym: string;
  observations: string;
}

export interface LineSchedulePlanner {
  id: string;
  startDate: string;
  endDate: string;
  showEndDate: boolean;
  outboundNucleos: LineScheduleNucleoHeader[];
  inboundNucleos: LineScheduleNucleoHeader[];
  outboundBlocks: LineScheduleBlock[];
  inboundBlocks: LineScheduleBlock[];
  outboundTrips: LineScheduleTrip[];
  inboundTrips: LineScheduleTrip[];
}

export interface LineSchedule {
  consorcioId: ConsortiumId;
  lineId: string;
  planners: LineSchedulePlanner[];
  frequencies: FrequencyDef[];
  cutoffTime: string | null;
  modeObservations: string;
}

export interface OdBlock {
  name: string;
  color: string | null;
  type: string;
}

export interface OdCheckpoint {
  blockName: string;
  time: string;
}

export interface OdJourney {
  lineId: string;
  lineCode: string;
  displayCode: string;
  lineName: string;
  lineColor: string;
  mode: string;
  originBlock: string;
  destinationBlock: string;
  departureTime: string;
  arrivalTime: string;
  departureSeconds: number;
  arrivalSeconds: number;
  durationSeconds: number;
  frequencyAcronym: string;
  frequencyDescription: string;
  observations: string;
  originCheckpoints: OdCheckpoint[];
  destinationCheckpoints: OdCheckpoint[];
}

export interface OdScheduleResult {
  consorcioId: ConsortiumId;
  originNucleo: Nucleo;
  destinationNucleo: Nucleo;
  date: string;
  journeys: OdJourney[];
  totalAvailable: number;
  originBlocks: string[];
  destinationBlocks: string[];
  frequencies: FrequencyDef[];
  fare: FareJumpResult | null;
}

export interface ZoneJump {
  originZone: string;
  destinationZone: string;
  jumps: number;
}

export interface InterurbanFare {
  jumps: number;
  singleTicketEur: number | null;
  cardEur: number | null;
}

export interface UrbanFare {
  name: string;
  tuEur: number | null;
  userPriceEur: number | null;
}

export interface FareJumpResult {
  consorcioId: ConsortiumId;
  originNucleoId: string;
  originNucleoName: string;
  destinationNucleoId: string;
  destinationNucleoName: string;
  jumps: number | null;
  error: string | null;
  singleTicketEur: number | null;
  cardEur: number | null;
}

export interface FaresSummary {
  consorcioId: ConsortiumId;
  interurban: InterurbanFare[];
  urban: UrbanFare[];
  jumpCalculation: FareJumpResult | null;
}

export interface SalesPoint {
  id: string;
  typeId: string;
  type: string;
  nucleoId: string;
  nucleoName: string;
  municipioId: string;
  municipioName: string;
  address: string;
  lat: number | null;
  lon: number | null;
  distanceMeters?: number;
}

export interface ServiceAlert {
  id: string;
  consorcioId: ConsortiumId;
  categoryId: string;
  category: string;
  title: string;
  subtitle: string;
  summary: string;
  body: string;
  startDate: string;
  endDate: string;
  lines: string[];
  isNew: boolean;
}

export interface NearbyStop {
  consorcioId: ConsortiumId;
  id: string;
  code: string;
  name: string;
  nucleoName: string;
  municipioName: string;
  zoneId: string;
  lat: number | null;
  lon: number | null;
  distanceMeters: number;
  lines: StopLineRef[];
  services?: StopServicesResult;
}

export interface ConsortiumCatalog {
  schemaVersion: 1;
  consorcioId: ConsortiumId;
  syncedAt: string;
  lang: ApiLang;
  lines: Record<string, Line>;
  stops: Record<string, Stop>;
  nucleos: Record<string, Nucleo>;
  municipios: Record<string, Municipality>;
  zones: Record<string, TariffZone>;
  modes: Record<string, TransportMode>;
  frequencies: Record<string, FrequencyDef>;
  interurbanFares: InterurbanFare[];
  urbanFares: UrbanFare[];
}

export interface NetworkTopology {
  schemaVersion: 1;
  consorcioId: ConsortiumId;
  syncedAt: string;
  lines: Record<string, Line>;
  stops: Record<string, Stop>;
  lineStops: Record<string, LineStop[]>;
}

export interface WalkTransfer {
  fromStopCode: string;
  toStopCode: string;
  distanceMeters: number;
  durationSeconds: number;
}

export interface JourneyLeg {
  lineId: string;
  lineLabel: string;
  lineColor: string;
  mode: string;
  direction: number;
  fromStopCode: string;
  fromStopName: string;
  toStopCode: string;
  toStopName: string;
  departureSeconds: number;
  arrivalSeconds: number;
  stopsCount: number;
  estimated: boolean;
}

export interface JourneyTransfer {
  fromStopCode: string;
  fromStopName: string;
  toStopCode: string;
  toStopName: string;
  walkMeters: number;
  walkSeconds: number;
  arrivalSeconds: number;
  departureSeconds: number;
  waitSeconds: number;
}

export interface JourneyAccessWalk {
  fromStopCode: string;
  fromStopName: string;
  toStopCode: string;
  toStopName: string;
  walkMeters: number;
  walkSeconds: number;
}

export interface Journey {
  legs: JourneyLeg[];
  transfers: JourneyTransfer[];
  originWalk?: JourneyAccessWalk;
  destinationWalk?: JourneyAccessWalk;
  departureSeconds: number;
  arrivalSeconds: number;
  durationSeconds: number;
  transferCount: number;
  estimated: boolean;
}

export interface RouteWalkSuggestion {
  type: 'origin' | 'destination' | 'both';
  walkMeters: number;
  walkSeconds: number;
  suggestedOriginStopCode?: string;
  suggestedOriginStopName?: string;
  suggestedDestStopCode?: string;
  suggestedDestStopName?: string;
  lineLabels: string[];
  estimatedDurationSeconds: number;
  baselineDurationSeconds: number | null;
  transfers: number;
  baselineTransfers: number | null;
}

export interface RouteSearchResult {
  consorcioId: ConsortiumId;
  journeys: Journey[];
  rateLimited: boolean;
  partial: boolean;
  estimatedFallback: boolean;
  hydratedCorridors: number;
  totalCorridors: number;
  warnings: string[];
  walkSuggestion?: RouteWalkSuggestion;
}

export interface RouteSearchOptions {
  fromStopCode: string;
  toStopCode: string;
  date?: Date;
  sortByDuration?: boolean;
  afterSeconds?: number;
  maxTransfers?: number;
  maxWalkMeters?: number;
  maxOriginWalkMeters?: number;
  maxDestWalkMeters?: number;
  refresh?: boolean;
  estimate?: boolean;
  hydrationBatchSize?: number;
  requestDelayMs?: number;
}

export type FavoriteKind = 'stop' | 'nucleo';

export interface FavoriteItem {
  alias: string;
  consorcioId: ConsortiumId;
  kind: FavoriteKind;
  id: string;
  name: string;
  addedAt: string;
}

export interface UserConfig {
  schemaVersion: 1;
  defaultConsortiumId?: ConsortiumId;
}

export interface ConsortiumCacheStatus {
  consorcioId: ConsortiumId;
  shortCode: string;
  name: string;
  catalog: {
    present: boolean;
    fresh: boolean;
    linesCount: number;
    stopsCount: number;
    nucleosCount: number;
    syncedAt: string | null;
  };
  topology: {
    present: boolean;
    fresh: boolean;
    linesCount: number;
    stopsCount: number;
    syncedAt: string | null;
  };
  schedulesCount: number;
  servicesCount: number;
  pointsPresent: boolean;
  totalBytes: number;
}

export interface CacheStatus {
  cacheDir: string;
  consortiums: ConsortiumCacheStatus[];
  totalBytes: number;
}

export type SyncProgressCallback = (done: number, total: number, label: string) => void;
