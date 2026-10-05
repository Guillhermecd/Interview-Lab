export const HEALTH_STATUS_OK = 'ok';

export interface HealthResponse {
  status: typeof HEALTH_STATUS_OK;
}

export interface ApiErrorDetail {
  field: string;
  message: string;
}

// Standard error body of every 4xx/5xx response. Clients decide behaviour by
// `code`, never by the text of `message`.
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: ApiErrorDetail[];
  // Present on RATE_LIMITED and QUOTA_EXCEEDED: seconds until the limit resets.
  retryAfterSeconds?: number;
}

export interface QueryColumn {
  name: string;
  // PostgreSQL type name in lowercase (e.g. "int8", "numeric", "timestamptz").
  type: string;
}

export interface QueryResult {
  columns: QueryColumn[];
  // One array per row, in column order, so duplicate column names are preserved.
  rows: unknown[][];
  rowCount: number;
  // True when the query produced more rows than the configured limit.
  truncated: boolean;
  durationMs: number;
}

export interface ExecuteQueryRequest {
  sql: string;
}

export const VISUALIZATION_TYPES = ['table', 'bar', 'line'] as const;
export type VisualizationType = (typeof VISUALIZATION_TYPES)[number];

export interface VisualizationSuggestion {
  type: VisualizationType;
  // Column names of the result, present for bar and line charts.
  xColumn?: string;
  yColumn?: string;
}

// Tokens spent with the LLM provider to answer one question.
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

export interface AskRequest {
  question: string;
}

export interface AnsweredQuestion {
  status: 'answered';
  question: string;
  // The SQL written by the LLM, before the guard adjusted its LIMIT.
  sql: string;
  result: QueryResult;
  explanation: string;
  visualization: VisualizationSuggestion;
  // How many times SQL was generated: 2 when the first attempt was refused.
  attempts: number;
  // Tables the SQL reads, as found by the SQL guard in its syntax tree.
  tables: string[];
  // True when the SQL was reused from the cache instead of generated now.
  cached: boolean;
  usage: TokenUsage;
}

// The LLM judged that the exposed data cannot answer the question.
export interface UnansweredQuestion {
  status: 'not_answerable';
  question: string;
  reason: string;
  usage: TokenUsage;
}

export type AskResponse = AnsweredQuestion | UnansweredQuestion;

// Why the last answer of a conversation needs the user's attention, decided
// by the server: it waits for review, was blocked by the SQL guard, or ran out
// of time.
export const CONVERSATION_ATTENTIONS = ['pending_review', 'blocked', 'timeout'] as const;
export type ConversationAttention = (typeof CONVERSATION_ATTENTIONS)[number];

export interface Conversation {
  id: string;
  // First question of the conversation; null until one is asked.
  title: string | null;
  createdAt: string;
  updatedAt: string;
  // Present only when the last answer needs attention.
  attention?: ConversationAttention;
}

export type MessageRole = 'user' | 'assistant';
// pending_review: the SQL was generated in review mode and waits for the user
// to approve or edit it before it runs (D-32).
export type AssistantMessageStatus = 'answered' | 'not_answerable' | 'error' | 'pending_review';

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  content: string;
  // The fields below are present only on assistant messages.
  status?: AssistantMessageStatus;
  sql?: string;
  visualization?: VisualizationSuggestion;
  rowCount?: number;
  // True when the user changed the SQL before running it; the SQL written by
  // the LLM is then in `generatedSql` (audit, D-33).
  edited?: boolean;
  generatedSql?: string;
  // Tables the SQL reads; present on assistant messages that have SQL.
  tables?: string[];
  createdAt: string;
}

// auto: generate and run at once. review: stop after generating the SQL.
export const ASK_MODES = ['auto', 'review'] as const;
export type AskMode = (typeof ASK_MODES)[number];

export interface AskQuestionRequest {
  question: string;
  mode?: AskMode;
}

export interface ExecuteReviewedSqlRequest {
  // The SQL to run: the generated one, as is or edited by the user.
  sql: string;
}

export interface ConversationList {
  items: Conversation[];
}

export interface MessageList {
  items: ConversationMessage[];
}

// Events of the answer stream (Server-Sent Events), in the order they occur:
// sql (once per attempt) → rows → token (many) → done. In review mode the
// stream is sql → review, and the execution endpoint continues with
// rows → token → done. An `error` event ends the stream at any point.
export interface SqlStreamEvent {
  sql: string;
  attempt: number;
}

export interface RowsStreamEvent {
  result: QueryResult;
  visualization: VisualizationSuggestion;
}

// Review mode: the SQL is ready and waits for approval; nothing ran yet.
export interface ReviewStreamEvent {
  messageId: string;
  sql: string;
  // Tables the SQL reads.
  tables: string[];
}

export interface TokenStreamEvent {
  text: string;
}

export interface DoneStreamEvent {
  messageId: string;
  status: 'answered' | 'not_answerable';
  attempts: number;
  usage: TokenUsage;
  // Present when a reviewed SQL was executed.
  edited?: boolean;
  // Present on an answered question: the SQL came from the cache.
  cached?: boolean;
  // Present on an answered question: tables the executed SQL reads.
  tables?: string[];
}

export interface AnswerStreamEvents {
  sql: SqlStreamEvent;
  rows: RowsStreamEvent;
  review: ReviewStreamEvent;
  token: TokenStreamEvent;
  done: DoneStreamEvent;
  error: ApiErrorBody;
}

export type AnswerStreamEventName = keyof AnswerStreamEvents;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  // Decided by the server: whether this user may use the registry. The client
  // only shows or hides screens with it; every request is checked again.
  canManageCatalog: boolean;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

// Tokens spent today (UTC) by the signed-in user, and the limits that apply.
// How close today's usage is to the daily quota, decided by the server.
export const USAGE_LEVELS = ['normal', 'attention', 'critical'] as const;
export type UsageLevel = (typeof USAGE_LEVELS)[number];

export interface UsageSummary {
  today: TokenUsage;
  level: UsageLevel;
  dailyTokenQuota: number;
  questionsPerMinute: number;
  byConversation: { conversationId: string; title: string | null; tokens: number }[];
}

// ---------------------------------------------------------------------------
// Operations dashboard (Phase 09c). Every number arrives computed by the
// server: totals, comparisons with the previous period, trends and statuses.
// The client only formats values and draws them.

export const DASHBOARD_PERIODS = ['7d', '30d', 'month', 'quarter', 'year', 'custom'] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

// Calendar days (YYYY-MM-DD) in the time zone of the business, both inclusive.
export interface DashboardRange {
  from: string;
  to: string;
}

export interface DashboardFilterOptions {
  distributionCenters: { id: string; name: string; regionId: string }[];
  regions: { id: string; name: string }[];
  categories: string[];
}

export type KpiTrend = 'up' | 'down' | 'flat';
// Whether the change is good news: a rise in stock days is bad, for example.
export type KpiSentiment = 'good' | 'bad' | 'neutral';

interface DashboardKpiBase {
  // Null when it cannot be computed (no deliveries or no outflow in the period).
  value: number | null;
  // The same measure in the previous period.
  previousValue: number | null;
  // Change against the previous period, in the unit of each indicator.
  delta: number | null;
  trend: KpiTrend;
  sentiment: KpiSentiment;
  // The measure along the period, oldest first; empty when not available.
  spark: number[];
}

// delta: percent.
export type RevenueKpi = DashboardKpiBase;

// delta: percent.
export interface OrdersKpi extends DashboardKpiBase {
  averageTicket: number | null;
  averageTicketDeltaPercent: number | null;
}

// Value of the stock at cost, at the end of the period. delta: percent.
export interface StockValueKpi extends DashboardKpiBase {
  distributionCenters: number;
  activeProducts: number;
}

// Days the stock lasts at the pace of the period. delta: days.
export interface CoverageKpi extends DashboardKpiBase {
  turnsPerYear: number | null;
}

// Products below their minimum stock at the end of the period. delta: items.
export interface BelowMinimumKpi extends DashboardKpiBase {
  critical: number;
  attention: number;
}

// Percent of the deliveries of the period made on time. delta: percentage points.
export interface OnTimeDeliveryKpi extends DashboardKpiBase {
  targetPercent: number;
  onTimeOrders: number;
  deliveredOrders: number;
}

export interface DashboardKpis {
  revenue: RevenueKpi;
  orders: OrdersKpi;
  stockValue: StockValueKpi;
  coverageDays: CoverageKpi;
  belowMinimum: BelowMinimumKpi;
  onTimeDelivery: OnTimeDeliveryKpi;
}

// One day of the period next to the day in the same position of the previous one.
export interface RevenuePoint {
  date: string;
  revenue: number;
  cumulative: number;
  previousDate: string;
  previousRevenue: number;
  previousCumulative: number;
}

export interface RegionRevenue {
  regionId: string;
  name: string;
  revenue: number;
  previousRevenue: number;
  deltaPercent: number | null;
  trend: KpiTrend;
  sentiment: KpiSentiment;
}

export interface TopProducts {
  items: { productId: string; name: string; category: string; revenue: number }[];
  // Part of the revenue of the period that these products make.
  sharePercent: number | null;
}

export interface CenterStock {
  distributionCenterId: string;
  name: string;
  total: number;
  // One entry per category of `categories`, in the same order.
  byCategory: number[];
}

export const ABC_CLASSES = ['A', 'B', 'C'] as const;
export type AbcClass = (typeof ABC_CLASSES)[number];

export interface AbcCurve {
  activeProducts: number;
  classes: { class: AbcClass; products: number; revenueSharePercent: number }[];
  // Cumulative revenue against the share of products, from the best seller on.
  points: { productsPercent: number; revenuePercent: number }[];
  // Where class A and class B end, in percent of the products.
  classAEndPercent: number;
  classBEndPercent: number;
}

export interface DashboardOverview {
  period: DashboardPeriod;
  range: DashboardRange;
  previousRange: DashboardRange;
  // When this answer was computed (ISO 8601).
  dataUntil: string;
  // Categories in a fixed order; charts color them by position.
  categories: string[];
  kpis: DashboardKpis;
  revenueSeries: RevenuePoint[];
  revenueByRegion: RegionRevenue[];
  topProducts: TopProducts;
  stockByCenter: CenterStock[];
  abc: AbcCurve;
}

export const STOCK_ALERT_STATUSES = ['critical', 'attention', 'ok'] as const;
export type StockAlertStatus = (typeof STOCK_ALERT_STATUSES)[number];

export interface StockAlert {
  productId: string;
  product: string;
  unit: string;
  distributionCenterId: string;
  distributionCenter: string;
  quantity: number;
  minimumQuantity: number;
  // Days the stock lasts at the average outflow of the last 30 days; null
  // when nothing left in that time.
  coverageDays: number | null;
  status: StockAlertStatus;
}

export interface StockAlertList {
  counts: Record<StockAlertStatus, number> & { all: number };
  items: StockAlert[];
}

export const STOCK_MOVEMENT_TYPES = ['inbound', 'outbound', 'transfer', 'adjustment'] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export interface StockMovement {
  id: string;
  movedAt: string;
  type: StockMovementType;
  product: string;
  unit: string;
  distributionCenter: string;
  // Present on transfers only.
  destinationCenter?: string;
  // Positive, except for an adjustment that removes stock.
  quantity: number;
  responsibleName: string;
  document: string;
}

export interface StockMovementList {
  items: StockMovement[];
}

// ---------------------------------------------------------------------------
// Registry (Phase 09e): products and stock movements, written only by users
// the server allows (AuthUser.canManageCatalog).

// How a product is counted: bag, bar, roll, pair or unit.
export const PRODUCT_UNITS = ['sc', 'br', 'rl', 'pr', 'un'] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

export interface CatalogProduct {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: ProductUnit;
  price: number;
  cost: number;
  // False once archived: kept in the history, out of new movements.
  active: boolean;
  // Stock in all distribution centers together.
  totalQuantity: number;
}

// What the user types to create a product, or to replace its data.
export interface ProductInput {
  sku: string;
  name: string;
  category: string;
  unit: ProductUnit;
  price: number;
  cost: number;
}

export const PRODUCT_STATUS_FILTERS = ['active', 'archived', 'all'] as const;
export type ProductStatusFilter = (typeof PRODUCT_STATUS_FILTERS)[number];

// Lists come in pages (API contract): `page` starts at 1.
export interface Page<Item> {
  items: Item[];
  page: number;
  pageSize: number;
  total: number;
}

export type CatalogProductPage = Page<CatalogProduct>;

// The stock of one product in one distribution center.
export interface ProductStockLevel {
  distributionCenterId: string;
  distributionCenter: string;
  quantity: number;
  minimumQuantity: number;
}

export interface CatalogProductDetail extends CatalogProduct {
  // One entry per distribution center, including those with no stock.
  stockLevels: ProductStockLevel[];
}

export interface MinimumStockInput {
  minimumQuantity: number;
}

// What the forms of the registry offer.
export interface CatalogOptions {
  categories: string[];
  units: ProductUnit[];
  distributionCenters: { id: string; name: string }[];
}

// A movement to record. The server sets the time and who is responsible (the
// signed-in user); the balance is updated in the same transaction.
export interface StockMovementInput {
  type: StockMovementType;
  productId: string;
  distributionCenterId: string;
  // Transfers only: where the stock goes.
  destinationCenterId?: string;
  // Positive; an adjustment may be negative, to take stock out.
  quantity: number;
  // Invoice, order or reason.
  document: string;
}

export interface RecordedStockMovement {
  movement: StockMovement;
  // The balances changed by the movement, after it.
  stockLevels: ProductStockLevel[];
}

export type StockMovementPage = Page<StockMovement>;

// ---------------------------------------------------------------------------
// The tables the AI can read, for the schema panel of the chat (Phase 09b).

export interface SchemaColumn {
  name: string;
  // As PostgreSQL prints it: "bigint", "numeric(12,2)", "timestamp with time zone".
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  // Present when the column points to another exposed table.
  references?: { table: string; column: string };
}

export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
}

export interface SchemaOverview {
  tables: SchemaTable[];
}
