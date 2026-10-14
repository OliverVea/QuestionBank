# Question Bank

**Work through a textbook's problems on paper, and get them checked and brought back until they stick.**

**[Try the demo](https://questionbank-demo.ovea.pro)**: no sign-up. It has a small sample library and one handwritten answer you can submit to see it read and graded.

## Why it exists

Working through the exercises is the best way to learn from a physics or maths textbook. It has two problems:

- **Nobody checks your work.** The answers at the back give a number, not feedback on your reasoning, and many books have no answers at all.
- **You forget.** A problem you solved in March is gone by June unless you see it again.

Question Bank turns the problems in a book into a personal question bank. You keep solving on paper. An AI model checks your working, and the app decides when each problem should come back.

## How it works

From a printed page to a scheduled review, in nine steps:

<table>
  <tr>
    <td width="33%" valign="top"><img src="docs/screenshots/story-1-photograph.png" alt="Photograph the pages: Two pages of a problem set, shot with a phone at an angle."><br><b>1. Photograph the pages.</b> Two pages of a problem set, shot with a phone at an angle.</td>
    <td width="33%" valign="top"><img src="docs/screenshots/story-2-figures.png" alt="Figures are found: Each page is flattened and its figures are outlined. You can fix a box by hand."><br><b>2. Figures are found.</b> Each page is flattened and its figures are outlined. You can fix a box by hand.</td>
    <td width="33%" valign="top"><img src="docs/screenshots/story-3-problems.png" alt="Problems are read off: Text and maths come out as LaTeX, and each figure lands on the problem that cites it."><br><b>3. Problems are read off.</b> Text and maths come out as LaTeX, and each figure lands on the problem that cites it.</td>
  </tr>
  <tr>
    <td width="33%" valign="top"><img src="docs/screenshots/story-4-maths.png" alt="Maths-heavy pages too: A page of integrals, read from a photo of the sheet held in the air."><br><b>4. Maths-heavy pages too.</b> A page of integrals, read from a photo of the sheet held in the air.</td>
    <td width="33%" valign="top"><img src="docs/screenshots/story-5-answer-photo.png" alt="Answer on paper: Solve the next problem by hand and photograph your working."><br><b>5. Answer on paper.</b> Solve the next problem by hand and photograph your working.</td>
    <td width="33%" valign="top"><img src="docs/screenshots/story-6-reading.png" alt="Check the reading: A first agent only reads your handwriting into LaTeX. It is told not to solve, correct or grade."><br><b>6. Check the reading.</b> A first agent only reads your handwriting into LaTeX. It is told not to solve, correct or grade.</td>
  </tr>
  <tr>
    <td width="33%" valign="top"><img src="docs/screenshots/story-7-grade.png" alt="Get it graded: A second agent critiques the confirmed reading and suggests a rating. You set the final one."><br><b>7. Get it graded.</b> A second agent critiques the confirmed reading and suggests a rating. You set the final one.</td>
    <td width="33%" valign="top"><img src="docs/screenshots/story-8-scheduled.png" alt="It comes back: A full mark schedules the problem for review in a week, then a month."><br><b>8. It comes back.</b> A full mark schedules the problem for review in a week, then a month.</td>
    <td width="33%" valign="top"><img src="docs/screenshots/story-9-library.png" alt="Keep going: The library tracks progress per book, your day streak and weekly goals."><br><b>9. Keep going.</b> The library tracks progress per book, your day streak and weekly goals.</td>
  </tr>
</table>

The screenshots are from one real run. The pages in [docs/demo](docs/demo/demo-pages.pdf) were printed, photographed with a phone, scanned by the app, answered by hand and graded.

## Grading you can trust

An AI model that solves a problem while it reads your handwriting tends to "see" the answer it expected. Question Bank keeps these jobs apart:

1. **Reading.** One model only copies your handwriting into typed maths. It is told not to solve, correct or grade, and you check its reading before anything else happens.
2. **Critique.** A second model reviews the reading you confirmed, explains what is right and wrong, and suggests a mark. You can question the critique in a chat.
3. **Your call.** You set the final mark: not yet, partly, or fully solved. The model advises, you decide.

## What you can do

**Build a book**
- Photograph one or several pages, or paste text, and the problems are pulled out with their maths and diagrams.
- Review what was found before it is added, and ask for changes in a chat.
- Fix diagram outlines by hand when the automatic cut-out misses.

**Solve and get feedback**
- Answer on paper and send a photo. Correct the reading in an editor that shows the maths as you type.
- Read the critique, discuss it, and set your mark.
- Skip or snooze problems you don't want right now. Every past attempt is kept.

**Keep it**
- A problem you solve fully comes back after a week, then after a month. A partial or wrong answer doesn't move it up; you see it again at the same interval.
- **Learn** takes you through new problems in book order. **Practice** gathers what is due across all your books.
- Progress per book, a day streak, and weekly goals.

**Privacy**
- Photos of your answers are sent to the model to be read and then discarded. They are never stored.
- Each account's books and answers are kept separate from everyone else's.
- Works on phone and desktop, and can be installed like an app.

## Current limitations

This is an active personal project. Known rough edges:

- Scanning the same pages twice can number the problems differently. Check the labels when you review a scan.
- Diagrams are sometimes not attached to their problem automatically. You can attach them from the book's edit page.
- If the model declines to grade an answer, the app just reports that grading failed and doesn't retry.
- The demo replays recorded results. Only the provided sample answer can be graded there.

The full list of planned work is in [TODO.md](TODO.md).

## Running it yourself

See [docs/setup.md](docs/setup.md) to run it locally, configure it, or deploy it. Without any accounts or keys, `QB_DEMO=1 npm run dev` runs the demo on your machine.

## License

[PolyForm Noncommercial 1.0.0](LICENSE): free for personal and other non-commercial use.
