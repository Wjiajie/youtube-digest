import * as Sentry from "@sentry/browser";

let initialized = false;

export function initExtensionObservability() {
  if (initialized) return;
  initialized = true;
  const dsn = import.meta.env.WXT_PUBLIC_SENTRY_DSN;
  Sentry.init({
    dsn,
    enabled: Boolean(dsn),
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) {
        event.request = {
          method: event.request.method,
          url: event.request.url,
        };
      }
      event.user = event.user?.id ? { id: event.user.id } : undefined;
      event.extra = undefined;
      event.contexts = undefined;
      event.breadcrumbs = event.breadcrumbs?.map((breadcrumb) => ({
        category: breadcrumb.category,
        level: breadcrumb.level,
        message: breadcrumb.message,
        timestamp: breadcrumb.timestamp,
        type: breadcrumb.type,
      }));
      return event;
    },
  });
}
