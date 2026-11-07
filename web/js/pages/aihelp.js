// Shared AI call flow (PRD §5.3): show estimate, confirm when > ¥0.1, explain missing key.
import { h, GET, POST, ApiError, confirmBox, modal, toast, yuan, esc } from '../ui.js';

let statusCache = null;
export async function aiStatus(force = false) {
  if (!statusCache || force) statusCache = await GET('/ai/status').catch(() => ({ has_key: false, estimates: {} }));
  return statusCache;
}
export const resetAiStatus = () => { statusCache = null; };

export async function callAI(path, body = {}) {
  try {
    return await POST(path, body);
  } catch (e) {
    if (e instanceof ApiError && e.data?.need_confirm) {
      const ok = await confirmBox('确认调用 AI', `${e.message}。实际花费以服务商账单为准，是否继续？`, { ok: '继续' });
      if (!ok) return null;
      return POST(path, { ...body, confirm: true });
    }
    if (e instanceof ApiError && e.data?.code === 'no_key') {
      toast('还没有配置 API Key：请到【我的 → AI 设置】填写后使用');
      return null;
    }
    throw e;
  }
}

/** Button that is greyed (but visible) without a key; hover title explains (PRD §5.1). */
export function aiButton(label, cost, status, onclick, cls = 'btn sm') {
  const b = h('button', { class: cls, onclick, title: status.has_key ? '' : '在【我的 → AI 设置】填写 API Key 后可用', disabled: !status.has_key },
    label, cost != null && status.has_key ? h('span', { class: 'muted', style: 'font-weight:500;letter-spacing:0;text-transform:none' }, ` ≈${yuan(cost)}`) : null);
  return b;
}

export function textModal(title, text, foot) {
  const body = h('div', {}, h('h2', {}, title), h('div', { class: 'ai-box' }, text), foot || null);
  return modal(body, { wide: true });
}
