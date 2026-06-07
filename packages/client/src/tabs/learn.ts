import { api } from '../api/client.js';
import type { Book, Grade, Message, Question } from '../api/types.js';
import { createImageInput } from '../components/image-input.js';
import { renderContent } from '../render/content.js';

const GRADES: Grade[] = ['correct', 'partial', 'incorrect'];

function renderQuestionHeader(parent: HTMLElement, question: Question): void {
  if (question.label) {
    const label = document.createElement('div');
    label.className = 'qlabel';
    label.textContent = question.label;
    parent.appendChild(label);
  }
  const body = document.createElement('div');
  body.className = 'qbody';
  renderContent(body, question.canonicalText);
  parent.appendChild(body);
}

// --- Answer / transcribe / confirm view ---

export function renderAnswerView(host: HTMLElement, question: Question, onDone: () => void): void {
  host.innerHTML = '';

  const cancelRow = document.createElement('div');
  cancelRow.className = 'learn-cancel-row';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'link learn-cancel';
  cancelBtn.textContent = '← Back';
  cancelBtn.addEventListener('click', onDone);
  cancelRow.appendChild(cancelBtn);
  host.appendChild(cancelRow);

  const wrap = document.createElement('div');
  wrap.className = 'card learn-grade';
  host.appendChild(wrap);
  renderQuestionHeader(wrap, question);

  const pickedFiles: File[] = [];

  const step = document.createElement('div');
  step.className = 'learn-answer-step';
  wrap.appendChild(step);

  const typed = document.createElement('textarea');
  typed.className = 'learn-typed';
  typed.placeholder = 'Type your answer (optional if you attach a photo)…';
  step.appendChild(typed);

  const imageInput = createImageInput({
    multiple: true,
    onFiles: (files) => {
      pickedFiles.push(...files);
      fileList.textContent = `${pickedFiles.length} photo(s) attached`;
      updateContinue();
    },
  });
  step.appendChild(imageInput.element);

  const fileList = document.createElement('div');
  fileList.className = 'status learn-files';
  step.appendChild(fileList);

  const transcribeBtn = document.createElement('button');
  transcribeBtn.className = 'btn learn-transcribe';
  transcribeBtn.textContent = 'Transcribe & continue';
  transcribeBtn.disabled = true;
  step.appendChild(transcribeBtn);

  const error = document.createElement('div');
  error.className = 'error learn-error';
  wrap.appendChild(error);

  function updateContinue(): void {
    transcribeBtn.disabled = pickedFiles.length === 0 && typed.value.trim() === '';
  }
  typed.addEventListener('input', updateContinue);

  transcribeBtn.addEventListener('click', () => {
    error.textContent = '';
    transcribeBtn.disabled = true;
    imageInput.setDisabled(true);
    void (async () => {
      try {
        let transcription = '';
        let imagePaths: string[] = [];
        if (pickedFiles.length > 0) {
          transcribeBtn.textContent = 'Transcribing…';
          const out = await api.transcribeAnswer(question.id, pickedFiles);
          transcription = out.transcription;
          imagePaths = out.imagePaths;
        }
        renderConfirmStep(wrap, question, {
          answerText: typed.value.trim(),
          transcription,
          imagePaths,
          onDone,
        });
        step.remove();
      } catch {
        error.textContent = 'Transcription failed — try again.';
        transcribeBtn.disabled = false;
        imageInput.setDisabled(false);
        transcribeBtn.textContent = 'Transcribe & continue';
      }
    })();
  });
}

interface ConfirmState {
  answerText: string;
  transcription: string;
  imagePaths: string[];
  onDone: () => void;
}

function renderConfirmStep(wrap: HTMLElement, question: Question, state: ConfirmState): void {
  const confirm = document.createElement('div');
  confirm.className = 'learn-confirm';
  wrap.appendChild(confirm);

  // --- Transcription section ---
  const tLabel = document.createElement('label');
  tLabel.textContent = 'Transcription:';
  confirm.appendChild(tLabel);

  const transcription = document.createElement('textarea');
  transcription.className = 'learn-transcription';
  transcription.value = state.transcription;
  confirm.appendChild(transcription);

  const preview = document.createElement('div');
  preview.className = 'learn-transcription-preview qbody';
  confirm.appendChild(preview);

  function updatePreview(): void {
    renderContent(preview, transcription.value);
  }
  transcription.addEventListener('input', updatePreview);
  updatePreview();

  // --- Retranscribe section (only if we have photos) ---
  if (state.imagePaths.length > 0) {
    const retranscribeSection = document.createElement('div');
    retranscribeSection.className = 'learn-retranscribe';
    confirm.appendChild(retranscribeSection);

    const noteLabel = document.createElement('label');
    noteLabel.textContent = 'Something wrong? Describe the correction in plain English:';
    retranscribeSection.appendChild(noteLabel);

    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.className = 'learn-correction-note';
    noteInput.placeholder = 'e.g. "I wrote 2a not sa"';
    retranscribeSection.appendChild(noteInput);

    const retranscribeBtn = document.createElement('button');
    retranscribeBtn.className = 'btn learn-retranscribe-btn';
    retranscribeBtn.textContent = 'Re-transcribe';
    retranscribeSection.appendChild(retranscribeBtn);

    const retranscribeError = document.createElement('div');
    retranscribeError.className = 'error';
    retranscribeSection.appendChild(retranscribeError);

    retranscribeBtn.addEventListener('click', () => {
      const note = noteInput.value.trim();
      if (!note) return;
      retranscribeBtn.disabled = true;
      retranscribeBtn.textContent = 'Retranscribing…';
      retranscribeError.textContent = '';
      void (async () => {
        try {
          const out = await api.retranscribeAnswer(question.id, {
            imagePaths: state.imagePaths,
            currentTranscription: transcription.value,
            correctionNote: note,
          });
          transcription.value = out.transcription;
          noteInput.value = '';
          updatePreview();
        } catch {
          retranscribeError.textContent = 'Retranscription failed — try again.';
        } finally {
          retranscribeBtn.disabled = false;
          retranscribeBtn.textContent = 'Re-transcribe';
        }
      })();
    });
  }

  // --- Typed answer section ---
  if (state.answerText) {
    const aLabel = document.createElement('label');
    aLabel.textContent = 'Typed answer:';
    confirm.appendChild(aLabel);

    const answer = document.createElement('textarea');
    answer.className = 'learn-typed-confirm';
    answer.value = state.answerText;
    confirm.appendChild(answer);
  }

  const gradeBtn = document.createElement('button');
  gradeBtn.className = 'btn learn-grade-go';
  gradeBtn.textContent = 'Looks good — grade it';
  confirm.appendChild(gradeBtn);

  gradeBtn.addEventListener('click', () => {
    const typedVal = confirm.querySelector<HTMLTextAreaElement>('.learn-typed-confirm')?.value.trim() ?? '';
    const combined = [typedVal, transcription.value.trim()]
      .filter((s) => s !== '')
      .join('\n\n');
    confirm.remove();
    renderGradingView(wrap, question, {
      combinedAnswer: combined,
      answerText: typedVal,
      transcription: transcription.value.trim(),
      imagePaths: state.imagePaths,
      onDone: state.onDone,
    });
  });
}

// --- Grading chat view ---

interface GradingState {
  combinedAnswer: string;
  answerText: string;
  transcription: string;
  imagePaths: string[];
  onDone: () => void;
}

function appendBadge(host: HTMLElement, grade: Grade): void {
  const badge = document.createElement('span');
  badge.className = `badge grade-badge grade-${grade}`;
  badge.textContent = grade;
  host.appendChild(badge);
}

export function renderGradingView(wrap: HTMLElement, question: Question, state: GradingState): void {
  const conversation: Message[] = [];
  let lastGrade: Grade | undefined;
  let lastCritique = '';

  const chat = document.createElement('div');
  chat.className = 'chat grade-chat';
  wrap.appendChild(chat);

  const error = document.createElement('div');
  error.className = 'error grade-error';
  wrap.appendChild(error);

  const replyHost = document.createElement('div');
  replyHost.className = 'row learn-reply-row';
  wrap.appendChild(replyHost);

  const ratingHost = document.createElement('div');
  ratingHost.className = 'row learn-rating-row';
  wrap.appendChild(ratingHost);

  function appendTurn(role: 'user' | 'assistant', text: string, grade?: Grade): void {
    const msg = document.createElement('div');
    msg.className = `msg msg-${role}`;
    const span = document.createElement('span');
    span.textContent = text;
    msg.appendChild(span);
    if (grade) appendBadge(msg, grade);
    chat.appendChild(msg);
  }

  function renderRating(): void {
    ratingHost.innerHTML = '';
    if (lastGrade === undefined) return;
    const select = document.createElement('select');
    select.className = 'learn-rating';
    for (const g of GRADES) {
      const opt = document.createElement('option');
      opt.value = g;
      opt.textContent = g;
      if (g === lastGrade) opt.selected = true;
      select.appendChild(opt);
    }
    const save = document.createElement('button');
    save.className = 'btn learn-save';
    save.textContent = 'Save attempt';
    save.addEventListener('click', () => {
      void (async () => {
        await api.createAttempt(question.id, {
          imagePaths: state.imagePaths,
          answerText: state.answerText,
          transcription: state.transcription,
          recommendedGrade: lastGrade!,
          rating: select.value as Grade,
          critiqueText: lastCritique,
        });
        state.onDone();
      })();
    });
    ratingHost.append(select, save);
  }

  function ensureReplyBox(): void {
    if (replyHost.childElementCount > 0) return;
    const reply = document.createElement('textarea');
    reply.className = 'learn-reply';
    reply.placeholder = 'Clarify or add to your answer…';
    const send = document.createElement('button');
    send.className = 'btn learn-reply-send';
    send.textContent = 'Send';
    send.addEventListener('click', () => {
      const text = reply.value.trim();
      if (text === '') return;
      reply.value = '';
      void doGrade(text, send);
    });
    replyHost.append(reply, send);
  }

  async function doGrade(userText: string, control: HTMLButtonElement): Promise<void> {
    error.textContent = '';
    control.disabled = true;
    conversation.push({ role: 'user', text: userText });
    appendTurn('user', userText);
    try {
      const turn = await api.gradeTurn(question.id, { conversation });
      conversation.push({ role: 'assistant', text: turn.critiqueText });
      appendTurn('assistant', turn.critiqueText, turn.recommendedGrade);
      lastGrade = turn.recommendedGrade;
      lastCritique = turn.critiqueText;
      renderRating();
      ensureReplyBox();
    } catch {
      error.textContent = 'Grading failed — try again.';
      conversation.pop();
    } finally {
      control.disabled = false;
    }
  }

  // Auto-grade the combined answer on open.
  const opener = document.createElement('button');
  opener.style.display = 'none';
  wrap.appendChild(opener);
  void doGrade(state.combinedAnswer, opener);
}

// --- Suggested-next card ---

function renderSuggestion(
  host: HTMLElement,
  question: Question,
  chapter: { title: string; bookId: string },
  book: { title: string },
  reload: () => void,
  openAnswer: (q: Question) => void,
): void {
  const card = document.createElement('div');
  card.className = 'card learn-suggestion';
  host.appendChild(card);

  const meta = document.createElement('div');
  meta.className = 'learn-suggestion-meta';
  meta.textContent = `${book.title} — ${chapter.title}`;
  card.appendChild(meta);

  renderQuestionHeader(card, question);

  const row = document.createElement('div');
  row.className = 'row';
  card.appendChild(row);

  const answer = document.createElement('button');
  answer.className = 'btn learn-answer';
  answer.textContent = 'Answer';
  answer.addEventListener('click', () => openAnswer(question));

  const skip = document.createElement('button');
  skip.className = 'link learn-skip';
  skip.textContent = 'Skip';
  skip.addEventListener('click', () => {
    void api.patchQuestionState(question.id, { skipped: true }).then(reload);
  });

  const snooze = document.createElement('button');
  snooze.className = 'link learn-snooze';
  snooze.textContent = 'Not now';
  snooze.addEventListener('click', () => {
    const until = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    void api.patchQuestionState(question.id, { snoozedUntil: until }).then(reload);
  });

  row.append(answer, skip, snooze);
}

// --- Navigator ---

async function openBook(host: HTMLElement, book: Book, onPick: (q: Question) => void): Promise<void> {
  host.innerHTML = '';
  const h = document.createElement('h3');
  h.textContent = book.title;
  host.appendChild(h);
  const tree = await api.getBookTree(book.id);
  for (const chapter of tree.chapters) {
    const chBtn = document.createElement('button');
    chBtn.className = 'link learn-nav-chapter';
    chBtn.textContent = chapter.title;
    chBtn.addEventListener('click', () => {
      const list = document.createElement('div');
      list.className = 'learn-nav-questions';
      for (const q of chapter.questions) {
        const qBtn = document.createElement('button');
        qBtn.className = 'link learn-nav-question';
        qBtn.textContent = q.label ?? q.canonicalText.slice(0, 40);
        qBtn.addEventListener('click', () => onPick(q));
        list.appendChild(qBtn);
      }
      host.appendChild(list);
    });
    host.appendChild(chBtn);
  }
}

async function renderNavigator(host: HTMLElement, onPick: (q: Question) => void): Promise<void> {
  host.innerHTML = '';
  const h = document.createElement('h3');
  h.textContent = 'Browse';
  host.appendChild(h);
  const books = await api.listBooks();
  for (const book of books) {
    const btn = document.createElement('button');
    btn.className = 'link learn-nav-book';
    btn.textContent = book.title;
    btn.addEventListener('click', () => void openBook(host, book, onPick));
    host.appendChild(btn);
  }
}

// --- Main Learn tab ---

export function renderLearn(host: HTMLElement): void {
  host.innerHTML = '';
  const heading = document.createElement('h2');
  heading.textContent = 'Learn';
  host.appendChild(heading);

  const cardHost = document.createElement('div');
  host.appendChild(cardHost);

  const navHost = document.createElement('div');
  navHost.className = 'learn-nav';
  host.appendChild(navHost);

  function openAnswer(q: Question): void {
    host.innerHTML = '';
    renderAnswerView(host, q, () => renderLearn(host));
  }

  function reload(): void {
    cardHost.innerHTML = 'loading…';
    void (async () => {
      const next = await api.getLearnNext();
      cardHost.innerHTML = '';
      if (next.question === null || next.question === undefined) {
        const empty = document.createElement('p');
        empty.className = 'learn-empty';
        empty.textContent = 'All caught up — nothing new to learn right now.';
        cardHost.appendChild(empty);
      } else if (next.chapter && next.book) {
        renderSuggestion(cardHost, next.question, next.chapter, next.book, reload, openAnswer);
      }
    })();
  }

  reload();
  void renderNavigator(navHost, openAnswer);
}
