import { fetchLatestCount } from "./api/counts.js";
import { formatCurrentTime } from "./lib/date-time.js";
import { renderCount, renderCountError } from "./views/counts.js";

const timeElement = document.querySelector("#current-time");

function updateTime() {
  timeElement.textContent = formatCurrentTime();
}

async function updateCount() {
  try {
    renderCount(await fetchLatestCount());
  } catch {
    renderCountError();
  }
}

updateTime();
updateCount();
