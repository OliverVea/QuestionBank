/**
 * The one rule every LaTeX-producing prompt must state: the client renderer
 * (renderContent) only renders math wrapped in dollar signs — inline `$...$`,
 * display `$$...$$`. Bare `\frac{a}{b}` or `(a+bi)^3` renders literally. Keep this
 * shared so transcription, extraction, and grading stay consistent.
 */
export const LATEX_DELIMITER_INSTRUCTION =
  'Write all mathematics as LaTeX wrapped in dollar signs so it renders: inline math ' +
  'as $...$ and display math as $$...$$. Bare LaTeX without dollar signs (e.g. ' +
  '\\frac{a}{b} or (a+bi)^3) will NOT render — always wrap it.';
