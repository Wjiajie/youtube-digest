// Read-only operator adapter: stdin is a private.resource_maintenance_snapshot() JSON result.
// No database access, credentials, provider calls, or user-controlled fields are echoed.
const fail = () => { process.stdout.write('{"status":"invalid","reasons":["invalid_input"]}\n'); process.exitCode = 2; };

function instant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    || !Number.isFinite(Date.parse(value))) return false;
  const day = value.slice(0, 10), parsedDay = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(parsedDay) && new Date(parsedDay).toISOString().slice(0, 10) === day;
}
function validSnapshot(value) {
  const keys = ["version", "observed_at", "overdue_roots", "oldest_overdue_at", "last_attempt_at", "last_finished_at", "last_success_at",
    "last_status", "last_error_code", "last_duration_ms", "last_processed_owners", "success_count", "failure_count"];
  const count = number => Number.isSafeInteger(number) && number >= 0;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))
    || value.version !== 1 || !instant(value.observed_at)
    || !["oldest_overdue_at", "last_attempt_at", "last_finished_at", "last_success_at"].every(key => value[key] === null || instant(value[key]))
    || ![value.overdue_roots, value.success_count, value.failure_count].every(count)
    || (value.overdue_roots === 0) !== (value.oldest_overdue_at === null)
    || (value.success_count === 0) !== (value.last_success_at === null)) return false;
  if (value.last_status === "never_run") return value.success_count === 0 && value.failure_count === 0
    && [value.last_attempt_at, value.last_finished_at, value.last_error_code, value.last_duration_ms, value.last_processed_owners].every(item => item === null);
  if (value.last_attempt_at === null || value.last_finished_at === null || typeof value.last_duration_ms !== "number"
    || !Number.isFinite(value.last_duration_ms) || value.last_duration_ms < 0) return false;
  if (value.last_status === "succeeded") return value.success_count > 0 && value.last_error_code === null
    && count(value.last_processed_owners) && value.last_processed_owners <= 1000
    && Date.parse(value.last_success_at) === Date.parse(value.last_finished_at);
  return value.last_status === "failed" && value.failure_count > 0 && value.last_processed_owners === null
    && typeof value.last_error_code === "string" && /^[0-9A-Z]{5}$/.test(value.last_error_code) && value.last_error_code !== "00000";
}

try {
  const args = process.argv.slice(2);
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!["--max-success-age-seconds", "--max-overdue-seconds"].includes(key) || values.has(key)
      || !/^[1-9]\d*$/.test(value ?? "") || !Number.isSafeInteger(Number(value))) throw new Error();
    values.set(key, Number(value));
  }
  if (values.size !== 2) throw new Error();
  let input = "", bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 8192) throw new Error();
    input += chunk.toString("utf8");
  }
  const snapshot = JSON.parse(input);
  if (!validSnapshot(snapshot)) throw new Error();
  const observed = Date.parse(snapshot.observed_at);
  const age = snapshot.last_success_at === null ? null : (observed - Date.parse(snapshot.last_success_at)) / 1000;
  const overdue = snapshot.oldest_overdue_at === null ? 0 : (observed - Date.parse(snapshot.oldest_overdue_at)) / 1000;
  const reasons = [];
  if (age !== null && age < 0 || overdue < 0 || snapshot.last_finished_at !== null &&
    (Date.parse(snapshot.last_finished_at) > observed || Date.parse(snapshot.last_attempt_at) > Date.parse(snapshot.last_finished_at)
      || snapshot.last_success_at !== null && Date.parse(snapshot.last_success_at) > Date.parse(snapshot.last_finished_at))) reasons.push("clock_inconsistent");
  if (snapshot.last_status === "never_run") reasons.push("never_run");
  else if (snapshot.last_status === "failed") reasons.push("last_attempt_failed");
  if (age === null || age > values.get("--max-success-age-seconds")) reasons.push("success_stale");
  if (overdue > values.get("--max-overdue-seconds")) reasons.push("overdue_backlog");
  process.stdout.write(JSON.stringify({ status: reasons.length ? "unhealthy" : "healthy", reasons,
    overdueRoots: snapshot.overdue_roots, oldestOverdueSeconds: overdue, lastSuccessAgeSeconds: age,
    lastStatus: snapshot.last_status, lastErrorCode: snapshot.last_error_code }) + "\n");
  process.exitCode = reasons.length ? 1 : 0;
} catch { fail(); }
