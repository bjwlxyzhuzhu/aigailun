import { GET, POST, toast, fail } from '../ui.js';
import { mountShelf } from '../shelf.js';
import { logout } from '../main.js';
import { callAI, aiStatus, textModal } from './aihelp.js';

export async function homePage(query, ctx) {
  document.body.classList.remove('calm');
  const data = await GET('/shelf');
  const host = document.createElement('div');
  ctx.app.replaceChildren(host);
  const go = (h) => { location.hash = h; };
  const shelf = mountShelf(host, {
    tapes: data.tapes, modules: data.modules, user: ctx.me.user, finalDate: data.final_exam_date || ctx.me.final_exam_date, exams: data.exams,
    onLogout: logout,
    onAction: async (t, a) => {
      try {
        if (a === 'practice') go(`#/practice/setup?chapter=${t.id}`);
        else if (a === 'wrong-chapter') go(`#/practice/setup?chapter=${t.id}&order=wrong`);
        else if (a === 'outline') {
          const st = await aiStatus();
          if (!st.has_key) return toast('AI 章节提纲需要 API Key：请到【我的 → AI 设置】填写');
          const r = await callAI('/ai/outline', { chapter: t.id });
          if (r) textModal(`第 ${t.id} 章 · ${t.title} · 复习提纲`, r.text);
        } else if (a === 'standard') go('#/wizard');
        else if (a === 'custom') go('#/wizard?tab=custom');
        else if (a === 'papers') go('#/papers');
        else if (a === 'exams') go('#/exams');
        else if (a === 'wrong') go('#/wrong');
        else if (a === 'wrong-practice') {
          const r = await POST('/wrong-book/practice', { filter: {} });
          go(`#/practice/${r.attempt_id}`);
        }
      } catch (e) { fail(e); }
    },
  });
  return () => shelf.destroy();
}
