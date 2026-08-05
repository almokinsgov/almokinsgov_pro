export const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

export const formatDate = (iso) => {
  if (!iso) return "Date to confirm";
  const date = new Date(`${iso}T00:00:00`);
  return new Intl.DateTimeFormat("en-NZ", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
};

export const formatRange = (project) => {
  const start = formatDate(project.startDate);
  const end = formatDate(project.endDate);
  const time =
    project.startTime && project.endTime
      ? `${project.startTime}–${project.endTime}`
      : "Times to confirm";
  return project.startDate === project.endDate
    ? `${start}, ${time}`
    : `${start} – ${end}, ${time}`;
};

export const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const slugify = (value) =>
  String(value || "road-closure")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

export const clone = (value) => JSON.parse(JSON.stringify(value));

