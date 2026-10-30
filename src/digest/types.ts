export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  /** Most recent recorded error, retained even after a successful run. */
  lastError: string | null;
  /** Earliest/latest event times, preserving their original log offsets. */
  firstAt: string;
  lastAt: string;
};

export type NightDigest = {
  night: string;
  /** One row per job, sorted by job in ascending code-point order. */
  rows: DigestRow[];
  /** Invalid JSON or invalid run records; blank lines are ignored. */
  badLines: number;
  /** Counts of valid run events, rather than final job statuses. */
  counts: Record<RunStatus, number>;
};

/**
 * Implemented and exported as readNight in src/digest/reader.ts.
 * Reads synchronously. Missing files and invalid YYYY-MM-DD names return null;
 * other filesystem errors propagate. Empty files return a digest with no rows.
 * Latest status/owner and first/last times follow event time, with file order
 * breaking ties. Last error is the latest event containing an error.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
