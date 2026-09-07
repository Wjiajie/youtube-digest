import type { ErrorEvent } from "@sentry/nextjs";

/** Keep operational errors useful without exporting Blueprint content or identity. */
export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    event.request = {
      method: event.request.method,
      url: event.request.url,
    };
  }
  if (event.user) {
    event.user = event.user.id ? { id: event.user.id } : undefined;
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => ({
      category: breadcrumb.category,
      level: breadcrumb.level,
      message: breadcrumb.message,
      timestamp: breadcrumb.timestamp,
      type: breadcrumb.type,
    }));
  }
  event.extra = undefined;
  event.contexts = undefined;
  return event;
}
