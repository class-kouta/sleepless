export async function fetchLatestCount() {
  const response = await fetch("/api/counts/latest", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("COUNT_FETCH_FAILED");

  const data = await response.json();
  if (!Number.isInteger(data.postCount) || data.postCount < 0
    || !["hourly", "daily"].includes(data.kind)) {
    throw new Error("COUNT_RESPONSE_INVALID");
  }
  return data;
}
