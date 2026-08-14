// Metric mapping layer — decouples the dashboard from raw Meta metric
// names, which Meta changes over time. The frontend only ever sees the
// internal keys; each maps to platform-specific Graph Insights metrics.
//
// availability per metric/platform is resolved at sync time: a metric
// whose Graph call fails with permission/deprecation errors is recorded
// as unavailable rather than crashing the sync.

export type InternalMetricKey =
  | "views"
  | "reach"
  | "follows"
  | "unfollows"
  | "page_visits"
  | "profile_visits"
  | "content_interactions"
  | "video_views_3s"
  | "watch_time_ms"
  | "conversations_started"
  | "new_contacts"
  | "leads";

export type MetricDef = {
  key: InternalMetricKey;
  label: string;
  /** Graph Insights metric name per platform (null = not available). */
  facebookMetric: string | null;
  instagramMetric: string | null;
  format?: "number" | "duration_ms";
};

// Facebook Page metric names verified against the current Page Insights
// metric list; Instagram against the IG User Insights list. Anything Meta
// has deprecated will surface as `unavailable` at sync time — the mapping
// layer downgrades gracefully instead of failing.
export const METRICS: MetricDef[] = [
  { key: "views", label: "Views", facebookMetric: "page_views_total", instagramMetric: "views" },
  // page_impressions_unique + page_fan_adds/removes were deprecated by Meta
  // (June 2025, new Page experience) — use the documented replacements.
  { key: "reach", label: "Reach", facebookMetric: "page_total_media_view_unique", instagramMetric: "reach" },
  { key: "follows", label: "Follows", facebookMetric: "page_daily_follows_unique", instagramMetric: "follows_and_unfollows" },
  { key: "unfollows", label: "Unfollows", facebookMetric: "page_daily_unfollows_unique", instagramMetric: null },
  { key: "page_visits", label: "Facebook visits", facebookMetric: "page_views_total", instagramMetric: null },
  { key: "profile_visits", label: "Instagram profile visits", facebookMetric: null, instagramMetric: "profile_views" },
  { key: "content_interactions", label: "Content interactions", facebookMetric: "page_post_engagements", instagramMetric: "total_interactions" },
  { key: "video_views_3s", label: "3-second video views", facebookMetric: "page_video_views", instagramMetric: null },
  { key: "watch_time_ms", label: "Watch time", facebookMetric: "page_video_view_time", instagramMetric: null, format: "duration_ms" },
  { key: "conversations_started", label: "Conversations started", facebookMetric: "page_messages_new_conversations_unique", instagramMetric: null },
  { key: "new_contacts", label: "New contacts", facebookMetric: "page_messages_new_conversations_unique", instagramMetric: null },
  // `leads` is not an insights metric — computed from meta_leads rows.
  { key: "leads", label: "Leads", facebookMetric: null, instagramMetric: null },
];

export const metricByKey = new Map(METRICS.map((m) => [m.key, m]));

export function fbMetricNames(): string[] {
  return [
    ...new Set(
      METRICS.map((m) => m.facebookMetric).filter((m): m is string => Boolean(m)),
    ),
  ];
}

export function igMetricNames(): string[] {
  return [
    ...new Set(
      METRICS.map((m) => m.instagramMetric).filter((m): m is string => Boolean(m)),
    ),
  ];
}
