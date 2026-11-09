/** Local development is explicit; it never changes deployed authentication. */
export function localCompanionMode() {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.BLUEPRINT_COMPANION_STORAGE === "local"
  );
}
export function loopbackHost(host: string | null) {
  return !!host && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
}
