'use strict';
const $ = id => document.getElementById(id);
const MEMBERS = ['우진','동욱','세호','유진','지성','홍규'];
const STATUS = {blocked:'결정·확인 필요',planned:'할 일',in_progress:'진행 중',review:'검수 대기',completed:'완료'};
const GROUPS = ['프론트','백엔드','데브옵스','서버','머신러닝','논문','DB'];
const PAGES = {overview:['한눈에 보기','문서와 작업을 한곳에서, 다음 단계는 더 분명하게.'],documents:['프로젝트 여정','어디까지 왔는지, 무엇이 남았는지. 단계별 작업과 근거를 함께 확인하세요.'],board:['진행 보드','해야 할 일부터 완료된 기록까지, 근거와 함께.'],team:['함께 만드는 사람들','우진 · 동욱 · 세호 · 유진 · 지성 · 홍규'],notes:['메모','팀과 AI가 이어서 작업할 수 있도록 기록하세요.']};
let docs=[], workspace={cards:[],notes:[],assignments:{}}, version='', current='overview', selected='', editing=null, rawMode=false, loading=false;
let activity={team:[],commits:[]},activityError='';
/** Completed work counts for its performer: names, GitHub/aliases and `<github>_GPT|_CL` AI ids (team.json). */
function performers(text){const words=String(text||'').split(/[\s,·/()]+/).filter(Boolean).map(w=>w.replace(/_(GPT|CL)$/i,'').toLowerCase());return MEMBERS.filter(m=>{const p=activity.team.find(t=>t.name===m),names=[m,p?.github,p?.aiPrefix,...(p?.aliases||[])].filter(Boolean).map(n=>n.toLowerCase());return words.some(w=>names.includes(w));});}
const involves=(t,m)=>t.assignees.includes(m)||(t.status==='completed'&&performers(t.performedBy).includes(m));
let pendingTask='';
let remoteSnapshot=null,checkingRemotes=false;
let stages=[],selectedStage='',stageScope=true;
function stageTasks(id){return workspace.cards.filter(c=>c.stage===id);}
function waitingFor(task){return (task.dependsOn||[]).filter(n=>workspace.cards.find(c=>c.number===n)?.status!=='completed');}
function stageStats(id){const tasks=stageTasks(id);return {tasks,done:tasks.filter(c=>c.status==='completed').length,active:tasks.filter(c=>['in_progress','review'].includes(c.status)).length};}
function stageDocuments(id){const phase=stages.find(s=>s.id===id),tasks=stageTasks(id);return docs.filter(d=>phase?.docs.includes(d.path)||tasks.some(c=>c.source===d.path||c.number===d.task));}
function renderJourney(){
 if(!stages.length)return;
 if(!selectedStage)selectedStage=stages.find(s=>s.id!=='operations'&&stageStats(s.id).done<stageStats(s.id).tasks.length)?.id||stages[0].id;
 const product=workspace.cards.filter(c=>c.stage&&c.stage!=='operations'),productDone=product.filter(c=>c.status==='completed').length;
 const focus=stages.find(s=>s.id!=='operations'&&stageStats(s.id).done<stageStats(s.id).tasks.length);
 $('journey-summary').innerHTML=`<div><p class="eyebrow">OUR PROJECT, STEP BY STEP</p><h2>${focus?'지금 연결할 단계, '+esc(focus.title):'등록된 제품 작업을 마쳤습니다'}</h2><p>로컬 구현에서 실제 서비스와 연구 검증으로 이어갑니다.<br>단계는 병행할 수 있으며, 완료 여부는 연결된 카드의 근거를 따릅니다.</p></div><div class="journey-count"><strong>${productDone}<span> / ${product.length}</span></strong><span>제품 작업 완료 · 운영 작업 제외</span><progress max="${product.length||1}" value="${productDone}" aria-label="제품 작업 ${productDone}/${product.length} 완료"></progress></div>`;
 $('stage-steps').innerHTML=stages.map((s,i)=>{const {tasks,done,active}=stageStats(s.id),complete=tasks.length>0&&done===tasks.length;return `<button class="stage-step ${s.id===selectedStage?'selected':''} ${complete?'complete':''}" data-stage="${s.id}" aria-pressed="${s.id===selectedStage}"><span class="step-number">${s.id==='operations'?'↻':String(i+1).padStart(2,'0')}</span><strong>${esc(s.title)}</strong><small>${complete?'등록 작업 완료':active?'진행 중':done?'일부 완료':'준비 중'} · ${done}/${tasks.length}</small><progress max="${tasks.length||1}" value="${done}" aria-label="${esc(s.title)} ${done}/${tasks.length} 완료"></progress></button>`;}).join('');
 $('stage-steps').querySelectorAll('button').forEach(b=>b.onclick=()=>{selectedStage=b.dataset.stage;stageScope=true;selected='';$('doc-search').value='';$('doc-group').value='';renderJourney();renderDocList();renderDocument();syncSelects();});
 const phase=stages.find(s=>s.id===selectedStage),{tasks,done,active}=stageStats(selectedStage),waiting=tasks.filter(c=>c.status!=='completed'&&waitingFor(c).length),ready=orderedTasks(tasks.filter(c=>['planned','in_progress','review'].includes(c.status)&&!waitingFor(c).length));
 $('stage-detail').innerHTML=`<div class="stage-intro"><span class="eyebrow">${phase.id==='operations'?'ALWAYS ON':'STEP '+String(stages.indexOf(phase)+1).padStart(2,'0')}</span><h2>${esc(phase.title)}</h2><p>${esc(phase.goal)}</p><div class="stage-gate"><strong>단계 완료 기준</strong><p>${esc(phase.exit)}</p></div><div class="stage-totals"><span><b>${done}</b> 완료</span><span><b>${active}</b> 진행·검수</span><span><b>${waiting.length}</b> 선행 대기</span></div><p class="next-step">${ready.length?'다음 실행 후보 <a href="#task='+ready[0].number+'">'+esc(ready[0].number+' '+ready[0].title)+' →</a>':waiting.length?'선행 대기 카드의 연결 작업을 먼저 확인하세요.':'등록 작업이 완료되었습니다. 아래 근거 문서를 확인하세요.'}</p></div><div class="stage-work"><div class="section-heading"><h3>이 단계의 작업</h3><span>${tasks.length}개</span></div>${orderedTasks(tasks).map(t=>`<a class="journey-task" href="#task=${t.number}"><span class="journey-task-main"><small>${esc(t.number)} · ${esc(t.category)} <span class="task-stars">${'★'.repeat(t.priority||0)}</span></small><strong>${esc(t.title)}</strong><small>${t.status==='completed'?esc('수행: '+(t.performedBy||'근거 문서 참조')):waitingFor(t).length?esc('선행 대기 '+waitingFor(t).join(' · ')):esc(t.assignees.join(' · ')||'착수 가능 · 담당 미배정')}</small></span>${badge(t.status)}</a>`).join('')||'<p class="empty">아직 등록된 작업이 없습니다.</p>'}</div>`;
 $('library-scope').textContent=stageScope?phase.title+' · 연결된 근거 문서':'전체 프로젝트 문서';
 $('all-documents').textContent=stageScope?'전체 문서 탐색':'단계 문서로 돌아가기';
}
async function checkRemotes(){
 if(checkingRemotes)return;checkingRemotes=true;
 try{
  const result=await api('/api/collaboration');remoteSnapshot=result;
  let seen={};try{seen=JSON.parse(localStorage.getItem('goodpose-remote-seen')||'{}');}catch{}
  const changed=result.branches.filter(b=>seen[b.name]!==b.sha&&(seen[b.name]||b.ahead>0));
  $('collaboration-summary').textContent=result.error||(changed.length?`새 원격 변경 ${changed.length}개 · 작업 전 확인하세요`:`원격 브랜치 확인 완료 · ${result.branch||''}`);
  $('collaboration-panel').classList.toggle('has-updates',changed.length>0||!result.fresh);
  $('remote-list').innerHTML=(result.checkedAt?`<p class="caption">마지막 성공 확인 ${esc(new Date(result.checkedAt).toLocaleString('ko-KR'))} · 최대 30개 최근 브랜치</p>`:'')+result.branches.map(b=>`<div class="remote-row"><strong>${esc(b.name)}</strong><span>현재 브랜치에 없는 커밋 ${b.ahead}개</span><code>${esc(b.sha.slice(0,8))}</code>${b.overlap.length?`<p class="dependency">내 작업 파일과 겹침: ${esc(b.overlap.join(', '))}</p>`:''}</div>`).join('');
 }catch(error){$('collaboration-summary').textContent='브랜치 확인 실패 · 다시 확인해주세요.';}finally{checkingRemotes=false;}
}
const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const docURL = path => '#doc='+encodeURIComponent(path);
const badge = status => `<span class="badge ${esc(status)}">${esc(STATUS[status]||status)}</span>`;
const date = seconds => new Date(seconds*1000).toLocaleDateString('ko-KR');
const assigned = path => workspace.assignments[path]||[];
function notice(message){$('notice').textContent=message;$('notice').hidden=!message;}
async function api(path, options){const response=await fetch(path,options);const body=await response.json();if(!response.ok)throw new Error(body.error||'요청에 실패했습니다.');return body;}
async function refresh(silent=false){
 if(loading||$('editor').open)return;
 loading=true;
 try{
  const [documents,data,journey]=await Promise.all([api('/api/documents'),api('/api/workspace'),api('/api/stages')]);
  docs=documents.documents;workspace=data.data;version=data.version;stages=journey.stages;
  $('item-stage').innerHTML='<option value="unclassified">단계를 선택하세요</option>'+stages.map(s=>`<option value="${s.id}">${esc(s.title)}</option>`).join('');
  try{activity=await api('/api/activity');activityError='';}catch(error){activityError=error.message;}
  $('doc-count').textContent=docs.length;$('sync-time').textContent=new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})+' 갱신';
  render();if(!silent)notice('');
 }catch(error){notice(error.message+' · 새로고침으로 다시 시도하세요.');}finally{loading=false;}
}
function plans(){return docs.filter(d=>d.status);}
function allTasks(){const sources=new Set(workspace.cards.map(c=>c.source));return [...plans().filter(d=>!sources.has(d.path)).map(d=>({...d,id:d.path,kind:'plan',source:d.path,assignees:assigned(d.path)})),...workspace.cards.map(c=>({...c,kind:'card'}))];}
function orderedTasks(tasks){
 const result=[],seen=new Set(),byNumber=new Map(tasks.map(t=>[t.number,t]));
 const visit=t=>{if(seen.has(t.id))return;seen.add(t.id);for(const n of t.dependsOn||[])if(byNumber.has(n))visit(byNumber.get(n));result.push(t);};
 tasks.slice().sort((a,b)=>(a.order??999)-(b.order??999)||(b.priority||0)-(a.priority||0)).forEach(visit);return result;
}
function route(){
 const hash=location.hash.slice(1);
 if(hash.startsWith('doc=')){
  try{selected=decodeURIComponent(hash.slice(4));}catch{selected='';}
  current='documents';rawMode=false;if(!stageDocuments(selectedStage).some(d=>d.path===selected))stageScope=false;
 }else if(hash.startsWith('task=')){pendingTask=decodeURIComponent(hash.slice(5));current='board';}
 else current=PAGES[hash]?hash:'overview';
 render();
}
function render(){
 for(const el of document.querySelectorAll('.view'))el.hidden=el.id!==current;
 for(const el of document.querySelectorAll('[data-nav]'))el.classList.toggle('active',el.dataset.nav===current);
 $('page-title').textContent=PAGES[current][0];$('page-description').textContent=PAGES[current][1];
 $('add-item').textContent=current==='notes'?'＋ 메모 남기기':'＋ 작업 추가';
 if(current==='overview')renderOverview();
 if(current==='documents'){renderJourney();renderDocList();renderDocument();}
 if(current==='board')renderBoard();
 if(current==='notes')renderNotes();
 if(current==='team')renderTeam();
 syncSelects();
 if(pendingTask&&version){const task=workspace.cards.find(c=>c.number===pendingTask);pendingTask='';if(task)openEditor('card',task.id);else notice('작업 번호를 찾을 수 없습니다. 최신 자료를 확인하세요.');}
}
function renderOverview(){
 const pp=workspace.cards, active=pp.filter(d=>['in_progress','review'].includes(d.status));
 const metrics=[['프로젝트 문서',docs.length,'개 문서'],['진행·검수 작업',active.length,'개 작업'],['완료된 작업',pp.filter(c=>c.status==='completed').length,'개 기록'],['미처리 메모',workspace.notes.filter(n=>n.status!=='completed').length,'개 요청']];
 $('metrics').innerHTML=metrics.map(([label,n,unit])=>`<div class="metric"><p>${label}</p><strong>${n}</strong><small>${unit}</small></div>`).join('');
 $('active-plans').innerHTML=active.map(d=>`<a class="plan-card" href="#task=${d.number}"><div class="card-top">${badge(d.status)}<span class="card-meta">${esc(d.assignees.join(' · ')||'미배정')}</span></div><h3>${esc(d.number+' '+d.title)}</h3><div class="card-meta"><span>${esc(d.category)}</span><span>작업·근거 확인 ↗</span></div></a>`).join('')||'<div class="empty">진행 중인 작업이 없습니다. <a href="#documents">프로젝트 여정에서 다음 작업 찾기 →</a></div>';
 const quick=[['docs/team-requirements.md','팀 요구사항','기능·역할·완료 조건'],['docs/project-board.md','관리판 운영 안내','팀 배정과 AI 메모 처리'],['docs/research/guided-collection-v2.md','데이터 수집 가이드','Lite 안내형 좌표·라벨 수집'],['docs/plans/backlog.md','다음 작업','남은 결정과 후속 구현']];
 $('quick-docs').innerHTML=quick.map(([p,t,s],i)=>`<a href="${docURL(p)}"><span class="number">0${i+1}</span><span><strong>${t}</strong><small>${s}</small></span><span class="arrow">↗</span></a>`).join('');
 $('shelves').innerHTML=GROUPS.map(g=>`<button class="shelf" data-group="${g}"><strong>${g}</strong><span>${docs.filter(d=>(d.groups||[d.group]).includes(g)).length}개 ↗</span></button>`).join('');
 $('shelves').querySelectorAll('button').forEach(b=>b.onclick=()=>{stageScope=false;$('doc-group').value=b.dataset.group;$('doc-search').value='';location.hash='documents';});
}
function renderDocList(){
 const q=$('doc-search').value.trim().toLowerCase(), group=$('doc-group').value;
 const source=stageScope?stageDocuments(selectedStage):docs;
 const filtered=source.filter(d=>(!group||(d.groups||[d.group]).includes(group))&&(!q||`${d.title} ${d.path} ${d.body}`.toLowerCase().includes(q)));
 $('search-count').textContent=`${filtered.length}개 문서 · 제목과 본문 검색`;
 $('doc-list').innerHTML=filtered.map(d=>`<button class="doc-link ${d.path===selected?'selected':''}" data-path="${esc(d.path)}"><strong>${esc(d.title)}</strong><small>${esc(d.path)}</small></button>`).join('')||'<p class="empty">일치하는 문서가 없습니다.</p>';
 $('doc-list').querySelectorAll('button').forEach(b=>b.onclick=()=>{location.hash=docURL(b.dataset.path);});
}
function linkTo(href,path){
 if(href.startsWith('#'))return href;
 try{
  const base=new URL(path,'http://documents.local/');const url=new URL(href,base);
  if(['http:','https:'].includes(url.protocol)&&url.hostname!=='documents.local')return url.href;
  if(url.origin===base.origin){
   const target=decodeURIComponent(url.pathname.slice(1));
   if(docs.some(d=>d.path===target))return docURL(target);
   if(docs.some(d=>d.path.startsWith(target.replace(/\/$/,'')+'/')))return '#folder='+encodeURIComponent(target);
  }
 }catch{}
 return '';
}
function inline(text,path){
 const tokens=[];const token=html=>{tokens.push(html);return '\u0000'+(tokens.length-1)+'\u0000';};
 let value=String(text).replace(/\u0000/g,'');
 value=value.replace(/`([^`]+)`/g,(_,v)=>token('<code>'+esc(v)+'</code>'));
 value=value.replace(/!?\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g,(_,label,href)=>{
  const url=linkTo(href,path);return token(url?`<a href="${esc(url)}"${url.startsWith('http')?' target="_blank" rel="noopener noreferrer"':''}>${esc(label)}</a>`:`<span title="${esc(href)}">${esc(label)} <small>(파일: ${esc(href)})</small></span>`);
 });
 value=esc(value).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/~~([^~]+)~~/g,'<del>$1</del>');
 return value.replace(/\u0000(\d+)\u0000/g,(_,i)=>tokens[Number(i)]);
}
function markdown(body,path){
 const lines=body.replace(/\r/g,'').split('\n'), out=[], headings=[];let i=0;
 const cells=line=>line.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
 while(i<lines.length){
  const line=lines[i];
  if(!line.trim()){i++;continue;}
  const fence=line.match(/^\s*(`{3,}|~{3,})/);
  if(fence){const block=[];i++;while(i<lines.length&&!lines[i].trim().startsWith(fence[1]))block.push(lines[i++]);i++;out.push('<pre><code>'+esc(block.join('\n'))+'</code></pre>');continue;}
  const heading=line.match(/^(#{1,6})\s+(.+)$/);
  if(heading){const level=heading[1].length,id='section-'+headings.length;headings.push({id,title:heading[2],level});out.push(`<h${level} id="${id}">${inline(heading[2],path)}</h${level}>`);i++;continue;}
  if(line.includes('|')&&i+1<lines.length&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1])){
   const header=cells(line);i+=2;const rows=[];while(i<lines.length&&lines[i].includes('|'))rows.push(cells(lines[i++]));
   out.push('<div class="table-wrap"><table><thead><tr>'+header.map(c=>'<th>'+inline(c,path)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+inline(c,path)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>');continue;
  }
  if(/^\s*([-*_])\1{2,}\s*$/.test(line)){out.push('<hr>');i++;continue;}
  if(/^\s*>/.test(line)){out.push('<blockquote>'+inline(line.replace(/^\s*>\s?/,''),path)+'</blockquote>');i++;continue;}
  if(/^\s*(?:[-*+] |\d+\. )/.test(line)){
   const ordered=/^\s*\d+\. /.test(line),tag=ordered?'ol':'ul',items=[];
   while(i<lines.length&&new RegExp(ordered?'^\\s*\\d+\\. ':'^\\s*[-*+] ').test(lines[i])){
    let content=lines[i++].replace(/^\s*(?:[-*+] |\d+\. )/,'');const check=content.match(/^\[([ xX])\]\s*/);
    items.push('<li>'+(check?`<input type="checkbox" disabled ${check[1].toLowerCase()==='x'?'checked':''}>`:'')+inline(check?content.slice(check[0].length):content,path)+'</li>');
   }out.push(`<${tag}>${items.join('')}</${tag}>`);continue;
  }
  const para=[line];i++;
  while(i<lines.length&&lines[i].trim()&&!/^\s*(?:#|```|~~~|>|[-*+] |\d+\. )/.test(lines[i])&&!(lines[i].includes('|')&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1]||'')))para.push(lines[i++]);
  out.push('<p>'+para.map(l=>inline(l,path)).join('<br>')+'</p>');
 }
 const toc=headings.filter(h=>h.level===2);
 return (toc.length?'<details class="toc"><summary>이 문서의 목차</summary>'+toc.map(h=>`<a href="#${h.id}" data-anchor="${h.id}">${esc(h.title)}</a>`).join('')+'</details>':'')+'<article class="markdown">'+out.join('\n')+'</article>';
}
function renderDocument(){
 const doc=docs.find(d=>d.path===selected);
 if(!doc){$('reader-meta').innerHTML='';$('reader-content').innerHTML='<div class="empty">'+(selected?'문서를 찾을 수 없습니다. 경로를 확인하거나 왼쪽 목록에서 선택하세요.':'왼쪽에서 문서를 선택하세요.')+'</div>';return;}
 $('reader-meta').innerHTML=`<div class="reader-actions"><div>${(doc.groups||[doc.group]).map(g=>`<span class="badge">${esc(g)}</span>`).join(' ')}<p class="reader-path">${esc(doc.path)} · ${date(doc.modified)}</p></div><button id="toggle-raw">${rawMode?'읽기 화면':'MD 원문'}</button></div>`;
 $('reader-content').innerHTML=rawMode?'<pre class="raw">'+esc(doc.body)+'</pre>':markdown(doc.body,doc.path);
 $('toggle-raw').onclick=()=>{rawMode=!rawMode;renderDocument();};
 $('reader-content').querySelectorAll('a').forEach(a=>a.onclick=event=>{
  const href=a.getAttribute('href');
  if(href.startsWith('#folder=')){
   event.preventDefault();$('doc-search').value=decodeURIComponent(href.slice(8));$('doc-group').value='';renderDocList();
  }else if(href.startsWith('#')&&!href.startsWith('#doc=')){
   event.preventDefault();const anchor=a.dataset.anchor||href.slice(1);let target=document.getElementById(anchor);
   if(!target){const slug=s=>s.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu,'').replace(/\s/g,'-');target=Array.from($('reader-content').querySelectorAll('h1,h2,h3,h4')).find(h=>slug(h.textContent)===decodeURIComponent(anchor));}
   target?.scrollIntoView({behavior:'smooth'});
  }
 });
}
function renderBoard(){
 const q=$('board-search').value.toLowerCase(),kind=$('board-kind').value,member=$('board-member').value;
 const category=$('board-category').value;
 const priority=$('board-priority').value;
 const tasks=orderedTasks(allTasks()).filter(t=>(!kind||(kind==='plan'?(t.plan||t.kind==='plan'):!t.plan&&t.kind==='card'))&&(!category||t.category===category)&&(priority===''||String(t.priority||0)===priority)&&(!member||(member==='unassigned'?!t.assignees.length&&!(t.status==='completed'&&performers(t.performedBy).length):involves(t,member)))&&`${t.number||''} ${t.title} ${t.body} ${t.assignees.join(' ')} ${t.owner||''}`.toLowerCase().includes(q));
 $('kanban').innerHTML=Object.entries(STATUS).map(([state,label])=>{const items=tasks.filter(t=>t.status===state);return `<section class="column"><h2>${label}<span>${items.length}</span></h2>${items.map(t=>{const waiting=(t.dependsOn||[]).filter(n=>workspace.cards.find(c=>c.number===n)?.status!=='completed');return `<button class="task-card priority-${t.priority||0}" data-kind="${t.kind}" data-id="${esc(t.id)}"><div class="card-top"><span class="task-number">${esc(t.number||'등록 필요')}</span><span class="task-stars" title="${esc(t.priorityNote||'중요도 미분류')}">${'★'.repeat(t.priority||0)||'☆'}</span></div><small>${esc(t.category||'MD 계획서')} · 규모 ${'●'.repeat(t.size||1)} · 배치 ${t.order||'—'}</small><h3>${esc(t.title)}</h3><p>${esc(t.performedBy&&t.status==='completed'?'수행: '+t.performedBy:t.assignees.join(' · ')||'담당 미배정')}</p>${waiting.length?`<p class="dependency">선행 대기 ${esc(waiting.join(', '))}</p>`:''}<p>${esc(t.body.slice(0,100))}</p>${t.log?.at(-1)?`<small>${esc(t.log.at(-1).by)} · ${esc(t.log.at(-1).text.slice(0,80))}</small>`:''}</button>`;}).join('')||'<p class="empty">작업 없음</p>'}</section>`;}).join('');
 $('kanban').querySelectorAll('button').forEach(b=>b.onclick=()=>openEditor(b.dataset.kind,b.dataset.id));
}
function renderTeam(){
 const tasks=allTasks();$('team-list').innerHTML=MEMBERS.map((m,i)=>{const mine=tasks.filter(t=>involves(t,m)),person=activity.team.find(t=>t.name===m),commits=activity.commits.filter(c=>c.member===m);return `<div class="note member-card"><span class="avatar color-${i}">${m[0]}</span><h3>${m}</h3><small>${person?.github?`<a href="https://github.com/${encodeURIComponent(person.github)}" target="_blank" rel="noopener noreferrer">@${esc(person.github)} ↗</a>`:'GitHub 연결 대기'}</small><p>배정 ${tasks.filter(t=>t.assignees.includes(m)&&t.status!=='completed').length}개 · 완료 ${mine.filter(t=>t.status==='completed').length}개<br>최근 기록 내 커밋 ${commits.length}개</p><div class="member-actions"><button data-work="${m}">담당 작업 →</button><button data-commits="${m}">커밋 보기 →</button></div></div>`;}).join('');
 $('team-list').querySelectorAll('[data-work]').forEach(b=>b.onclick=()=>{$('board-member').value=b.dataset.work;$('board-kind').value='';$('board-search').value='';location.hash='board';});
 $('team-list').querySelectorAll('[data-commits]').forEach(b=>b.onclick=()=>{$('commit-member').value=b.dataset.commits;renderCommits();syncSelects();$('commit-list').scrollIntoView({behavior:'smooth',block:'start'});});
 renderCommits();
}
function renderCommits(){
 const member=$('commit-member').value,items=activity.commits.filter(c=>!member||(member==='unlinked'?!c.member:c.member===member));
 $('commit-list').innerHTML=activityError?`<p class="empty">커밋을 읽지 못했습니다: ${esc(activityError)}</p>`:items.map(c=>`<article class="commit-row"><span class="commit-person">${esc(c.member||'미연결')}<small>${esc(c.author)}</small></span><div><strong>${esc(c.subject)}</strong><p><code title="${esc(c.hash)}">${esc(c.hash.slice(0,8))}</code> · ${esc(new Date(c.date).toLocaleDateString('ko-KR'))}</p></div></article>`).join('')||'<p class="empty">현재 브랜치의 최근 기록에 연결된 커밋이 없습니다.</p>';
}
function renderNotes(){
 const q=$('note-search').value.toLowerCase(),state=$('note-state').value;
 const notes=workspace.notes.filter(n=>`${n.title} ${n.body} ${n.result} ${n.author}`.toLowerCase().includes(q)&&(!state||(state==='pending'?n.status!=='completed':n.status==='completed'))).sort((a,b)=>b.updated.localeCompare(a.updated));
 $('note-list').innerHTML=notes.map(n=>`<button class="note" data-id="${esc(n.id)}">${badge(n.status)}<h3>${esc(n.title)}</h3><p>${esc(n.body.slice(0,220))}</p><small>${esc(n.author||'작성자 미지정')} · ${esc(n.assignees.join(' · ')||'담당 미배정')}</small>${n.result?`<div class="result-box"><strong>${esc(n.agent||'AI')} 처리 기록</strong><p>${esc(n.result.slice(0,220))}</p></div>`:''}</button>`).join('')||'<div class="empty">표시할 메모가 없습니다.<br>상단의 메모 남기기로 요청을 기록하세요.</div>';
 $('note-list').querySelectorAll('button').forEach(b=>b.onclick=()=>openEditor('notes',b.dataset.id));
}
function openEditor(kind,id=''){
 if(!version){notice('자료를 불러온 후 다시 시도하세요.');return;}
 const item=kind==='plan'?allTasks().find(t=>t.kind==='plan'&&t.id===id):(kind==='card'?workspace.cards:workspace.notes).find(t=>t.id===id);
 editing={kind,id,item,version};
 $('editor-heading').textContent=kind==='plan'?'계획서 담당 배정':kind==='notes'?'팀·AI 메모':(item?.number?item.number+' · 작업 카드':'작업 카드 · 저장 시 번호 발급');
 $('stage-label').hidden=kind!=='card';$('item-stage').value=item?.stage||'unclassified';
 $('category-label').hidden=kind!=='card';$('item-category').value=item?.category||'데브옵스';
 $('item-priority').value=String(item?.priority||0);$('item-size').value=String(item?.size||1);$('item-order').value=String(item?.order||0);$('item-priority-note').value=item?.priorityNote||'';$('item-dependencies').value=(item?.dependsOn||[]).join(', ');$('item-performer').value=item?.performedBy||'';$('item-evidence').value=item?.evidence||'';
 for(const id of ['item-priority','item-size','item-order','item-priority-note','item-dependencies','item-performer','item-evidence'])$(id).closest('label').hidden=kind!=='card';
 $('card-tools').hidden=kind!=='card'||!item?.number;
 $('item-feedback').value='';$('feedback-label').hidden=kind!=='card';
 $('card-history').hidden=kind!=='card';
 $('card-history').innerHTML=(item?.log||[]).slice().reverse().map(e=>`<div class="history-entry"><strong>${esc(e.by)} <small>${e.kind==='ai'?'AI':'사용자'} · ${esc(new Date(e.at).toLocaleString('ko-KR'))}</small></strong><p>${esc(e.text)}</p></div>`).join('');
 $('item-title').value=item?.title||'';$('item-body').value=item?.body||'';$('item-status').value=item?.status||'planned';$('item-author').value=item?.author||'';
 $('item-source').innerHTML='<option value="">연결하지 않음</option>'+docs.map(d=>`<option value="${esc(d.path)}">${esc(d.title)} · ${esc(d.path)}</option>`).join('');
 $('item-source').value=item?.source||'';
 for(const key of ['item-title','item-body','item-status','item-source'])$(key).disabled=kind==='plan';
 $('author-label').hidden=kind!=='notes';
 $('item-assignees').innerHTML=MEMBERS.map(m=>`<label><input type="checkbox" value="${m}" ${(item?.assignees||[]).includes(m)?'checked':''}>${m}</label>`).join('');
 $('delete-item').hidden=!id||kind==='plan';$('editor-error').textContent='';$('save-item').disabled=false;
 $('ai-result').hidden=!item?.result;$('ai-result').textContent=item?.result?`${item.agent||'AI'} 처리 기록\n${item.result}`:'';
 $('source-link').hidden=!item?.source;$('source-link').href=docURL(item?.source||'');$('source-link').onclick=()=>{$('editor').close();};
 syncSelects();$('editor').showModal();
}
async function persist(next,expectedVersion=version,message=''){
 const result=await api('/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:next,version:expectedVersion,message})});workspace=result.data;version=result.version;render();
}
$('editor-form').onsubmit=async event=>{
 event.preventDefault();if(!editing)return;$('save-item').disabled=true;
 const next=structuredClone(workspace),assignees=Array.from($('item-assignees').querySelectorAll('input:checked'),el=>el.value);
 if(editing.kind==='plan')next.assignments[editing.id]=assignees;
 else{
  const key=editing.kind==='card'?'cards':'notes',previous=editing.item;
  const item={...previous,id:editing.id||crypto.randomUUID(),title:$('item-title').value.trim(),body:$('item-body').value,status:$('item-status').value,source:$('item-source').value,assignees,author:$('item-author').value,updated:new Date().toISOString(),result:previous?.result||'',agent:previous?.agent||''};
  if(key==='cards')Object.assign(item,{stage:$('item-stage').value,category:$('item-category').value,priority:Number($('item-priority').value),size:Number($('item-size').value),order:Number($('item-order').value),priorityNote:$('item-priority-note').value,dependsOn:$('item-dependencies').value.split(/[,\s]+/).filter(Boolean).map(n=>n.toUpperCase()),performedBy:$('item-performer').value,evidence:$('item-evidence').value});
  if(key==='cards'&&item.stage==='unclassified'){$('editor-error').textContent='프로젝트 단계를 선택하세요.';$('save-item').disabled=false;return;}
  if(!item.title){$('editor-error').textContent='제목을 입력하세요.';$('save-item').disabled=false;return;}
  if(key==='notes'&&previous&&(previous.title!==item.title||previous.body!==item.body))item.status='planned';
  const index=next[key].findIndex(n=>n.id===item.id);if(index<0)next[key].push(item);else next[key][index]=item;
 }
 try{await persist(next,editing.version,editing.kind==='card'?$('item-feedback').value.trim():'');$('editor').close();notice('파일에 저장했습니다.');}catch(error){$('editor-error').textContent=error.message;}finally{$('save-item').disabled=false;}
};
$('delete-item').onclick=async()=>{
 if(!editing||!confirm('이 항목을 삭제할까요? 삭제 전 백업해 두면 복구할 수 있습니다.'))return;
 const next=structuredClone(workspace),key=editing.kind==='card'?'cards':'notes';next[key]=next[key].filter(n=>n.id!==editing.id);
 try{await persist(next,editing.version);$('editor').close();notice('삭제했습니다.');}catch(error){$('editor-error').textContent=error.message;}
};
function closeEditor(){if(confirm('편집 창을 닫을까요? 저장하지 않은 입력은 사라집니다.'))$('editor').close();}
$('close-editor').onclick=closeEditor;$('editor').addEventListener('cancel',e=>{e.preventDefault();closeEditor();});
$('add-item').onclick=()=>openEditor(current==='notes'?'notes':'card');
$('refresh').onclick=()=>refresh();
$('all-documents').onclick=()=>{stageScope=!stageScope;$('doc-search').value='';$('doc-group').value='';renderJourney();renderDocList();syncSelects();};
for(const id of ['doc-search','doc-group'])$(id).addEventListener('input',renderDocList);
for(const id of ['board-search','board-kind','board-member','board-category','board-priority'])$(id).addEventListener('input',renderBoard);
for(const id of ['note-search','note-state'])$(id).addEventListener('input',renderNotes);
$('commit-member').addEventListener('input',renderCommits);
$('check-remotes').onclick=checkRemotes;
$('ack-remotes').onclick=()=>{if(!remoteSnapshot?.fresh)return;try{localStorage.setItem('goodpose-remote-seen',JSON.stringify(Object.fromEntries(remoteSnapshot.branches.map(b=>[b.name,b.sha]))));checkRemotes();}catch{notice('브라우저에서 알림 확인 상태를 저장하지 못했습니다.');}};
$('copy-task').onclick=async()=>{const n=editing?.item?.number;if(!n)return;const text=`${n} 작업을 진행해줘. 먼저 AGENTS.md와 docs/project-board.md를 읽고, python tools/project-board/work.py show ${n}으로 요구사항·선행 작업·근거 문서를 확인해줘. 원격 브랜치 변경과 중복 작업 여부를 확인하고 시작·진행·검증 결과를 같은 카드와 관련 MD에 기록해줘. 담당 배정과 무관하게 이미 완료된 작업은 수행자와 근거를 기록해서 완료하고 미검증 사항은 별도 카드로 남겨줘.`;try{await navigator.clipboard.writeText(text);$('editor-error').textContent='AI에게 보낼 지시문을 복사했습니다.';}catch{$('editor-error').textContent=text;}};
$('copy-task-link').onclick=async()=>{const link=location.origin+'/#task='+editing?.item?.number;try{await navigator.clipboard.writeText(link);$('editor-error').textContent='작업 링크를 복사했습니다.';}catch{$('editor-error').textContent=link;}};
$('backup').onclick=()=>{
 if(!version){notice('불러온 자료가 없습니다.');return;}
 const url=URL.createObjectURL(new Blob([JSON.stringify(workspace,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='goodpose-board-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('restore').onclick=()=>$('backup-file').click();
$('backup-file').onchange=async event=>{
 const file=event.target.files[0];if(!file)return;
 try{
  if(file.size>2_000_000)throw new Error('백업 크기가 너무 큽니다.');const imported=JSON.parse(await file.text());
  if(!Array.isArray(imported.cards)||!Array.isArray(imported.notes)||!imported.assignments||typeof imported.assignments!=='object')throw new Error('바른자세 백업 파일이 아닙니다.');
  if(!confirm('백업을 병합할까요? 같은 ID는 수정 시각이 최신인 항목을 남기고, 현재 계획 담당 배정은 유지합니다. 삭제한 메모가 복구될 수 있습니다.'))return;
  const next=structuredClone(workspace);
  for(const key of ['cards','notes'])for(const item of imported[key]){const index=next[key].findIndex(n=>n.id===item.id);if(index<0)next[key].push(item);else if(item.updated>next[key][index].updated)next[key][index]=item;}
  next.assignments={...imported.assignments,...next.assignments};await persist(next);notice('백업을 병합했습니다.');
 }catch(error){notice(error.message);}finally{event.target.value='';}
};

// Accessible custom menus keep native select values as the single form state.
const customSelects=new Map();let activeSelect=null;
function closeSelect(restoreFocus=false){
 if(!activeSelect)return;const {button,menu}=activeSelect;
 menu.hidePopover();button.setAttribute('aria-expanded','false');activeSelect=null;
 if(restoreFocus)button.focus();
}
function syncSelects(){
 document.querySelectorAll('select').forEach(select=>{
  let control=customSelects.get(select);
  if(!control){
   const wrapper=document.createElement('div');wrapper.className='custom-select';
   const label=select.closest('label');const labelText=label?Array.from(label.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join(' '):document.querySelector(`label[for="${select.id}"]`)?.textContent||'선택';
   const button=document.createElement('button');button.type='button';button.className='select-trigger';button.setAttribute('role','combobox');button.setAttribute('aria-label',labelText);button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
   const menu=document.createElement('div');menu.className='select-menu';menu.id=select.id+'-options';menu.setAttribute('role','listbox');menu.setAttribute('aria-label',labelText);menu.setAttribute('popover','manual');button.setAttribute('aria-controls',menu.id);
   select.after(wrapper);wrapper.append(button,menu);select.hidden=true;
   control={select,button,menu,wrapper};customSelects.set(select,control);
   const open=()=>{
    if(select.disabled)return;if(activeSelect===control){closeSelect(true);return;}closeSelect();
    menu.innerHTML=Array.from(select.options).map((o,i)=>`<button type="button" role="option" tabindex="-1" aria-selected="${o.selected}" data-index="${i}" ${o.disabled?'disabled':''}><span>${esc(o.textContent)}</span><span class="select-tick" aria-hidden="true">${o.selected?'✓':''}</span></button>`).join('');
    menu.querySelectorAll('button').forEach(option=>option.onclick=event=>{event.preventDefault();select.selectedIndex=Number(option.dataset.index);select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));closeSelect(true);syncSelects();});
    activeSelect=control;button.setAttribute('aria-expanded','true');menu.showPopover();
    const rect=button.getBoundingClientRect(),roomBelow=innerHeight-rect.bottom-16,roomAbove=rect.top-16,height=Math.min(300,Math.max(roomBelow,roomAbove));
    menu.style.width=Math.min(Math.max(rect.width,180),innerWidth-24)+'px';menu.style.maxHeight=height+'px';menu.style.left=Math.max(12,Math.min(rect.left,innerWidth-Math.max(rect.width,180)-12))+'px';
    menu.style.top=(roomBelow>=Math.min(260,menu.scrollHeight)?rect.bottom+7:Math.max(12,rect.top-Math.min(height,menu.scrollHeight)-7))+'px';
    const selectedOption=menu.querySelector('[aria-selected="true"]')||menu.querySelector('button');selectedOption?.focus({preventScroll:true});selectedOption?.scrollIntoView({block:'nearest'});
   };
   button.onclick=event=>{event.preventDefault();open();};
   button.onkeydown=event=>{if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();open();}};
   menu.onkeydown=event=>{
    const options=Array.from(menu.querySelectorAll('button:not(:disabled)'));const index=options.indexOf(document.activeElement);let next=index;
    if(event.key==='ArrowDown')next=(index+1)%options.length;else if(event.key==='ArrowUp')next=(index-1+options.length)%options.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=options.length-1;else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeSelect(true);return;}else if(event.key==='Tab'){closeSelect(true);return;}else return;
    event.preventDefault();options[next]?.focus();
   };
   select.addEventListener('change',()=>syncSelects());
  }
  control.button.innerHTML=`<span>${esc(select.selectedOptions[0]?.textContent||'선택')}</span><svg aria-hidden="true" width="14" height="14" viewBox="0 0 20 20"><path d="m5 7 5 5 5-5"/></svg>`;
  control.button.disabled=select.disabled;
 });
}
document.addEventListener('pointerdown',event=>{if(activeSelect&&!activeSelect.wrapper.contains(event.target))closeSelect();});
window.addEventListener('resize',()=>closeSelect());
$('editor').addEventListener('close',()=>closeSelect());
$('doc-group').insertAdjacentHTML('beforeend',GROUPS.map(g=>`<option>${g}</option>`).join(''));
for(const id of ['item-category','board-category'])$(id).insertAdjacentHTML('beforeend',GROUPS.map(g=>`<option>${g}</option>`).join(''));
$('item-status').innerHTML=Object.entries(STATUS).map(([v,t])=>`<option value="${v}">${t}</option>`).join('');
for(const id of ['item-author','board-member','commit-member'])$(id).insertAdjacentHTML('beforeend',MEMBERS.map(m=>`<option>${m}</option>`).join(''));
window.addEventListener('hashchange',route);
route();refresh();checkRemotes();setInterval(()=>{if(!document.hidden&&current!=='documents')refresh(true);},15000);setInterval(()=>{if(!document.hidden)checkRemotes();},300000);
