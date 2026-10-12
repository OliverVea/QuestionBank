import { authFetch } from '@/lib/auth';
import './QuestionFigures.css';

interface FigureDto { id: string; url: string; printedLabel?: string }

/**
 * Append a problem's attached figures under its text. The image route needs the bearer
 * token, so each crop is fetched and shown from an object URL instead of a plain `src`.
 * Best-effort: a problem without figures, or a failed fetch, leaves `host` untouched.
 */
export async function appendFigures(host: HTMLElement, questionId: string): Promise<void> {
  try {
    const res = await authFetch(`/api/questions/${questionId}/figures`);
    if (!res.ok) return;
    const figures = await res.json() as FigureDto[];
    if (figures.length === 0) return;
    const strip = document.createElement('div');
    strip.className = 'qfigs';
    for (const fig of figures) {
      const imgRes = await authFetch(fig.url);
      if (!imgRes.ok) continue;
      const img = document.createElement('img');
      img.className = 'qfig';
      img.alt = fig.printedLabel ?? 'Figure';
      img.src = URL.createObjectURL(await imgRes.blob());
      strip.append(img);
    }
    if (strip.childElementCount > 0) host.append(strip);
  } catch {
    // The problem text is still usable without its figure.
  }
}
