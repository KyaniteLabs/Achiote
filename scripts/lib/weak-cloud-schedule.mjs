export function shouldStartRound({ now = new Date(), endAt, minRoundStartWindowMs }) {
  if (!(endAt instanceof Date) || Number.isNaN(endAt.getTime())) return false;
  const remainingMs = endAt.getTime() - now.getTime();
  return remainingMs >= Math.max(0, minRoundStartWindowMs);
}
