'use strict';
// Compare the edited record, not the entire board. Never overwrite a changed record.
const BoardEditorState = (() => {
 const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
 function merge(base, latest, kind, id, value) {
  const next = structuredClone(latest);
  const key = kind === 'card' ? 'cards' : 'notes';
  const before = kind === 'plan' ? base.assignments[id] : base[key].find(x=>x.id===id);
  const now = kind === 'plan' ? latest.assignments[id] : latest[key].find(x=>x.id===id);
  if (!equal(before,now)) throw new Error('이 항목을 다른 창이나 AI가 수정했습니다. 입력은 보존했습니다. 입력 복사 후 최신 항목을 다시 열어 확인하세요.');
  if(kind === 'plan') next.assignments[id] = value;
  else {
   const index = next[key].findIndex(x=>x.id===id);
   if(index < 0) next[key].push(value); else next[key][index] = value;
  }
  return next;
 }
 function noteStatus(previous, item) {
  return previous && (previous.title!==item.title || previous.body!==item.body) && previous.status===item.status ? 'planned' : item.status;
 }
 return {merge,noteStatus};
})();
if(typeof module !== 'undefined') module.exports = BoardEditorState;
