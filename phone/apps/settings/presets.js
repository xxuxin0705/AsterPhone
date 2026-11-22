// 设置 → 预设：方案 = 一份预设（酒馆里的或导入的）+ 里面每条开不开；全局用哪个方案，每个应用跟全局、用别的或不用
import { h, pickFile, uid } from '../../core/util.js';
import { commit } from '../../core/store.js';
import { group, item, switchEl, btn, dialog, actionSheet, toast } from '../../core/ui.js';
import { P, PRESET_APPS, tavernNames, srcName, entriesOf, importFile, removeFile } from '../../core/preset.js';

export function openPresets(sub) {
  sub('presets', '预设', body => {
    const names = tavernNames();
    const planName = id => (P().plans.find(x => x.id === id) || {}).name || '不用';
    const sources = () => [...names.map(n => ({ value: 't:' + n, label: n })), ...P().files.map(f => ({ value: 'f:' + f.id, label: f.name + '（导入的）' }))];

    // 谁用哪个方案：改了只换那几行右边的字
    const paints = [], repaint = () => paints.forEach(f => f());
    const useRow = (title, get, set, follow) => {
      const el = item({ title, value: '', chevron: true, onClick: async () => {
        const v = await actionSheet(`${title}用哪个方案`, [...(follow ? [{ value: '', label: '跟全局' }] : []), { value: 'none', label: '不用预设' }, ...P().plans.map(x => ({ value: x.id, label: x.name }))]);
        if (v == null) return; set(v); commit('presets'); repaint();
      } });
      paints.push(() => { el.querySelector('.as-list-item__value').textContent = follow && !get() ? `跟全局（${planName(P().all)}）` : get() === 'none' ? '不用' : planName(get()); });
      return el;
    };
    const uses = group('谁用哪个方案', [useRow('全局', () => P().all, v => { P().all = v === 'none' ? '' : v; }),
      ...PRESET_APPS.map(([a]) => useRow(a, () => P().apps[a], v => { if (v) P().apps[a] = v; else delete P().apps[a]; }, true))]);

    // 方案：上面一排切换，每个方案那一块只画一次，切换只是显示 / 藏起来（重画会闪）
    const views = new Map(), chips = h('div.as-chips'), box = h('div');
    const chipOf = x => h('button.as-chip', { dataset: { id: x.id }, onclick: () => show(x.id) }, x.name);
    const show = id => {
      chips.querySelectorAll('.as-chip').forEach(c => c.classList.toggle('is-active', c.dataset.id === id));
      if (id && !views.has(id)) { const v = view(P().plans.find(x => x.id === id)); views.set(id, v); box.append(v); }
      views.forEach((v, k) => { v.hidden = k !== id; });
    };
    const add = plan => { P().plans.push(plan); commit('presets'); chips.append(chipOf(plan)); planBox.hidden = false; show(plan.id); repaint(); };
    const view = plan => {
      const list = h('div'), src = item({ title: '用哪份预设', value: srcName(plan.src), chevron: true, onClick: async () => {
        const v = await actionSheet('用哪份预设', sources()); if (v == null || v === plan.src) return;
        plan.src = v; plan.on = {}; commit('presets'); src.querySelector('.as-list-item__value').textContent = srcName(v); fill();
      } });
      // 条目：「聊天记录」那条是分界，手机要发的东西放在那里，不能关
      const fill = () => entriesOf(plan.src).then(L => list.replaceChildren(L.length ? group('条目', L.map(e => e.id === 'chatHistory'
        ? item({ title: '聊天记录', value: '手机的内容放这里' }) : item({ title: e.name, right: switchEl(plan.on[e.id] ?? e.on, v => { plan.on[e.id] = v; commit('presets'); }, e.name) }))) : group('', [item({ title: '这份预设读不到了，换一份' })])),
        e => toast('读不到这份预设：' + e.message));
      fill();
      return h('div', group('', [src]), h('div.as-lib-actions', btn('复制一份', 'secondary', () => add({ ...plan, id: uid('pp_'), name: plan.name + ' 副本', on: { ...plan.on } })),
        btn('改名', 'secondary', async () => { const n = await dialog({ title: '改名', input: { value: plan.name } }); if (!n || !n.trim()) return; plan.name = n.trim(); commit('presets'); chips.querySelector(`[data-id="${plan.id}"]`).textContent = plan.name; repaint(); }),
        btn('删除', 'secondary', async () => {
          if (!(await dialog({ title: `删除「${plan.name}」？`, confirm: '删除', danger: true }))) return;
          P().plans = P().plans.filter(x => x !== plan); if (P().all === plan.id) P().all = '';
          for (const a in P().apps) if (P().apps[a] === plan.id) delete P().apps[a];
          commit('presets'); chips.querySelector(`[data-id="${plan.id}"]`).remove(); views.get(plan.id).remove(); views.delete(plan.id); planBox.hidden = !P().plans.length; repaint(); show(P().plans[0]?.id);
        })), list);
    };
    const create = async () => {
      if (!sources().length) return toast('读不到酒馆里的预设，先导入一份预设文件');
      const v = await actionSheet('用哪份预设', sources()); if (v == null) return;
      add({ id: uid('pp_'), name: srcName(v), src: v, on: {} });
    };

    // 导入的预设文件：存在小手机里，两边酒馆都能用
    const files = h('div');
    const paintFiles = () => files.replaceChildren(P().files.length ? group('导入的预设', P().files.map(f => item({ title: f.name, right: btn('删除', 'secondary', async () => {
      if (!(await dialog({ title: `删除「${f.name}」？`, confirm: '删除', danger: true }))) return;
      await removeFile(f.id); paintFiles();
    }) }))) : '');
    paintFiles();
    const imp = btn('导入预设文件', 'secondary', async () => {
      const file = await pickFile('.json,.settings'); if (!file) return;
      try { const f = await importFile(file); paintFiles(); toast(`导入了「${f.name}」`); } catch (e) { toast(e.message); }
    });

    chips.append(...P().plans.map(chipOf));
    const planBox = group('方案', [h('div.as-field', chips)]); planBox.hidden = !P().plans.length;   // 还没有方案就只留下面两个按钮
    body.append(uses, planBox, h('div.as-lib-actions', btn('新建方案', 'secondary', create), imp), names.length ? '' : h('div.as-list-group__footer', '读不到酒馆里的预设，可以导入预设文件'), box, files);
    repaint(); show(P().plans[0]?.id);
  });
}
