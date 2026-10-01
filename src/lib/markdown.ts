/** Minimal markdown for job descriptions (headings, bold, italics, bullet lists, paragraphs). */
export function markdownToHtml(md: string) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>");
  return md
    .split(/\n{2,}/)
    .map((block) => {
      if (block.startsWith("## ")) return `<h2>${inline(block.slice(3))}</h2>`;
      if (block.split("\n").every((l) => l.startsWith("- "))) return `<ul>${block.split("\n").map((l) => `<li>${inline(l.slice(2))}</li>`).join("")}</ul>`;
      return `<p>${inline(block).replace(/\n/g, "<br/>")}</p>`;
    })
    .join("");
}
