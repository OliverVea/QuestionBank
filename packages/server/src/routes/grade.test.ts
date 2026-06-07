import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { FakeProvider } from '../llm/fake-provider.js';
import { ImageStore } from '../storage/images.js';
import { Store } from '../storage/store.js';

let dir: string;
let questionId: string;

async function appWithIssues(issues: unknown) {
  dir = await mkdtemp(join(tmpdir(), 'qb-grade-'));
  const store = await Store.open(dir);
  const structured = { reasoning: 'checked each step', issues };
  const app = createApp(store, new FakeProvider({ structured }), new ImageStore(dir));
  const bookId = (await request(app).post('/api/books').send({ title: 'B' })).body.id;
  const chapterId = (await request(app).post(`/api/books/${bookId}/chapters`).send({ title: 'C' }))
    .body.id;
  questionId = (
    await request(app).post(`/api/chapters/${chapterId}/questions`).send({ canonicalText: 'q' })
  ).body.id;
  return app;
}

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const conversation = [{ role: 'user', text: 'my answer' }];

describe('grade route — derives the grade from the issue list', () => {
  it('empty issues → correct', async () => {
    const app = await appWithIssues([]);
    const res = await request(app)
      .post(`/api/questions/${questionId}/grade`)
      .send({ conversation });
    expect(res.status).toEqual(200);
    expect(res.body).toMatchObject({ issues: [], recommendedGrade: 'correct' });
  });

  it('a medium issue → partial', async () => {
    const issues = [{ severity: 'medium', description: 'sign error' }];
    const app = await appWithIssues(issues);
    const res = await request(app)
      .post(`/api/questions/${questionId}/grade`)
      .send({ conversation });
    expect(res.body).toMatchObject({ issues, recommendedGrade: 'partial' });
  });

  it('a critical issue → incorrect', async () => {
    const issues = [
      { severity: 'minor', description: 'odd notation' },
      { severity: 'critical', description: 'wrong result' },
    ];
    const app = await appWithIssues(issues);
    const res = await request(app)
      .post(`/api/questions/${questionId}/grade`)
      .send({ conversation });
    expect(res.body.recommendedGrade).toEqual('incorrect');
  });

  it('400 on an empty conversation', async () => {
    const app = await appWithIssues([]);
    const res = await request(app).post(`/api/questions/${questionId}/grade`).send({ conversation: [] });
    expect(res.status).toEqual(400);
  });

  it('404 when the question does not exist', async () => {
    const app = await appWithIssues([]);
    const res = await request(app).post('/api/questions/nope/grade').send({ conversation });
    expect(res.status).toEqual(404);
  });
});
