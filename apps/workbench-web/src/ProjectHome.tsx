import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Archive, ArrowDownAZ, ArrowDownToLine, ArrowRight, ArrowUpFromLine, Check, ChevronDown, Clock3, Code2, Copy, Folder, FolderOpen, Grid2X2, Layers, List, Loader2, MoreHorizontal, Pencil, Plus, Search, Star, X } from 'lucide-react';
import type { EngineeringBundle, ProjectSummary, WorkspaceCatalog } from '../../../packages/protocol/src/index';
import { api, ApiError } from './api';
import './project-home.css';

export interface ProjectHomeProps {
  catalog: WorkspaceCatalog;
  onRefresh: () => Promise<WorkspaceCatalog>;
  onOpen: (project: ProjectSummary) => Promise<void>;
  busyProjectId?: string;
}
type Section = 'recent' | 'all' | 'favorites' | 'archived';
type Dialog = { type: 'create' } | { type: 'rename'; project: ProjectSummary } | null;
const sections: Array<{ id: Section; name: string; icon: typeof Clock3 }> = [
  { id: 'recent', name: '最近', icon: Clock3 }, { id: 'all', name: '全部工程', icon: Folder },
  { id: 'favorites', name: '收藏', icon: Star }, { id: 'archived', name: '归档', icon: Archive },
];
const templateNames: Record<ProjectSummary['template'], string> = { blank: '空白设计', 'react-monitor': 'React 示例', linked: '源码工程' };
const sortDate = (project: ProjectSummary) => new Date(project.lastOpenedAt || project.updatedAt).getTime() || 0;
function dateLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '时间未知';
  return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}
function ErrorMessage({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return <><span>{message}</span>{error instanceof ApiError && <code>{error.code}</code>}</>;
}
function BrandMark() {
  return <span className="home-brand-mark" aria-hidden="true"><i/><i/><i/></span>;
}

function ProjectPreview({ project }: { project: ProjectSummary }) {
  const monitor = project.template === 'react-monitor';
  return <div className={`home-project-preview ${monitor ? 'is-monitor' : 'is-blank'}`}>
    {project.thumbnail ? <img src={project.thumbnail} alt={`${project.name} 工程画布预览`} loading="lazy"/> : monitor ?
      <svg viewBox="0 0 440 248" role="img" aria-label="React 示例工程模板预览">
        <rect x="37" y="28" width="366" height="210" rx="8" fill="white"/><rect x="37" y="28" width="366" height="25" rx="8" fill="#fbfcff"/>
        <path d="M37 53H403" stroke="#edf0f5"/><circle cx="49" cy="40" r="2" fill="#cad3e5"/><circle cx="56" cy="40" r="2" fill="#cad3e5"/><circle cx="63" cy="40" r="2" fill="#cad3e5"/>
        <rect x="51" y="67" width="46" height="7" rx="2" fill="#26384a"/><rect x="51" y="82" width="62" height="4" rx="2" fill="#d8dfeb"/>
        <rect x="339" y="67" width="49" height="15" rx="4" fill="#1b8dff"/>
        <rect x="51" y="99" width="105" height="40" rx="5" fill="#f1f6ff"/><rect x="166" y="99" width="105" height="40" rx="5" fill="#f4f4ff"/><rect x="281" y="99" width="107" height="40" rx="5" fill="#f0f8f6"/>
        <rect x="60" y="108" width="36" height="4" rx="2" fill="#aabbd4"/><rect x="60" y="120" width="43" height="8" rx="2" fill="#4978ab"/>
        <rect x="175" y="108" width="36" height="4" rx="2" fill="#b7b2d9"/><rect x="175" y="120" width="43" height="8" rx="2" fill="#8272b6"/>
        <rect x="290" y="108" width="36" height="4" rx="2" fill="#aacac1"/><rect x="290" y="120" width="43" height="8" rx="2" fill="#579b83"/>
        <rect x="51" y="151" width="219" height="71" rx="5" fill="#fbfcfe" stroke="#ecf0f5"/><path d="M62 207H257M62 190H257M62 173H257" stroke="#edf1f7"/>
        <path d="M62 209L78 198L95 200L113 187L132 191L151 172L169 180L189 167L207 170L227 155L257 159V217H62Z" fill="#e5f0ff"/>
        <path d="M62 209L78 198L95 200L113 187L132 191L151 172L169 180L189 167L207 170L227 155L257 159" fill="none" stroke="#4c98e8" strokeWidth="2"/>
        <rect x="282" y="151" width="105" height="71" rx="5" fill="white" stroke="#ecf0f5"/><circle cx="334" cy="186" r="22" fill="none" stroke="#eff3f9" strokeWidth="7"/>
        <path d="M334 164A22 22 0 1 1 313 192" stroke="#7db4ec" strokeWidth="7" fill="none"/>
      </svg> :
      <svg viewBox="0 0 440 248" role="img" aria-label="空白设计工程预览示意">
        <defs><pattern id={`dots-${project.id}`} x="0" y="0" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#d8dfe8"/></pattern></defs>
        <rect width="440" height="248" fill={`url(#dots-${project.id})`}/><rect x="119" y="37" width="204" height="178" rx="3" fill="white" stroke="#dce3ec"/>
        <rect x="140" y="58" width="42" height="9" rx="3" fill="#ebeff5"/><rect x="140" y="83" width="119" height="14" rx="3" fill="#dee6f1"/>
        <rect x="140" y="107" width="150" height="5" rx="2" fill="#eef1f5"/><rect x="140" y="119" width="126" height="5" rx="2" fill="#eef1f5"/>
        <rect x="140" y="145" width="162" height="48" rx="5" fill="#f2f6fb"/><rect x="140" y="145" width="162" height="48" rx="5" fill="none" stroke="#429ef7"/>
        <rect x="137.5" y="142.5" width="5" height="5" fill="white" stroke="#429ef7"/><rect x="299.5" y="142.5" width="5" height="5" fill="white" stroke="#429ef7"/>
        <rect x="137.5" y="190.5" width="5" height="5" fill="white" stroke="#429ef7"/><rect x="299.5" y="190.5" width="5" height="5" fill="white" stroke="#429ef7"/>
        <path d="M313 178L325 190L319 191L315 197Z" fill="#208fff" stroke="white" strokeWidth="1.5"/>
      </svg>}
    {!project.thumbnail && <span className="home-preview-label">工程预览示意</span>}
  </div>;
}

function Modal({ title, children, onClose, disabled }: { title: string; children: ReactNode; onClose: () => void; disabled: boolean }) {
  const modalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = modalRef.current?.querySelector<HTMLElement>('input') || modalRef.current?.querySelector<HTMLElement>('button');
    first?.focus();
    return () => { previous?.focus(); };
  }, []);
  function keydown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !disabled) { event.preventDefault(); onClose(); }
    if (event.key !== 'Tab') return;
    const targets = Array.from(modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]') || []);
    const first = targets[0]; const last = targets.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return <div className="home-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !disabled) onClose(); }}>
    <div ref={modalRef} className="home-modal" role="dialog" aria-modal="true" aria-labelledby="home-dialog-title" onKeyDown={keydown}>
      <div className="home-modal-heading"><div><span className="home-eyebrow">R-DESIGN WORKSPACE</span><h2 id="home-dialog-title">{title}</h2></div><button className="home-icon-button" aria-label="关闭弹窗" onClick={onClose} disabled={disabled}><X size={19}/></button></div>
      {children}
    </div>
  </div>;
}

export function ProjectHome({ catalog, onRefresh, onOpen, busyProjectId }: ProjectHomeProps) {
  const [section, setSection] = useState<Section>('recent');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'updated' | 'name'>('updated');
  const [view, setView] = useState<'grid' | 'list'>(() => localStorage.getItem('rd-project-view') === 'list' ? 'list' : 'grid');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<'blank' | 'react-monitor'>('blank');
  const [menu, setMenu] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [dialogError, setDialogError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const actionRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeCount = catalog.projects.filter(project => !project.archived).length;
  const favorites = catalog.projects.filter(project => project.favorite && !project.archived).length;
  const archived = catalog.projects.filter(project => project.archived).length;
  const currentSection = sections.find(item => item.id === section)!;
  const isBusy = !!busy || !!busyProjectId;
  const projects = useMemo(() => catalog.projects.filter(project => {
    if (section === 'archived' ? !project.archived : project.archived) return false;
    if (section === 'favorites' && !project.favorite) return false;
    return !query.trim() || `${project.name} ${templateNames[project.template]} ${project.location}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  }).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : (section === 'recent' ? sortDate(b) - sortDate(a) : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())), [catalog.projects, section, sort, query]);

  useEffect(() => { localStorage.setItem('rd-project-view', view); }, [view]);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    function dismiss(event: MouseEvent) { if (!menuRef.current?.contains(event.target as Node)) setMenu(null); }
    function escape(event: globalThis.KeyboardEvent) { if (event.key === 'Escape') setMenu(null); }
    document.addEventListener('mousedown', dismiss); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', escape); };
  }, [menu]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(timer); }, [notice]);

  async function perform(label: string, action: () => Promise<void>, inDialog = false) {
    if (actionRef.current || busyProjectId) return;
    actionRef.current = true; setBusy(label); setError(null); setDialogError(null); setNotice('');
    try { await action(); } catch (cause) { if (inDialog) setDialogError(cause); else setError(cause); }
    finally { actionRef.current = false; setBusy(''); }
  }
  async function update(project: ProjectSummary, values: { name?: string; favorite?: boolean; archived?: boolean }) {
    const latest = await onRefresh();
    await api<ProjectSummary>(`/projects/${encodeURIComponent(project.id)}/update`, { operationId: crypto.randomUUID(), expectedRevision: latest.revision, ...values });
    await onRefresh();
  }
  function showCreate() { setName(''); setTemplate('blank'); setDialogError(null); setDialog({ type: 'create' }); }
  function showRename(project: ProjectSummary) { setMenu(null); setName(project.name); setDialogError(null); setDialog({ type: 'rename', project }); }
  async function submitDialog() {
    if (!dialog || !name.trim()) return;
    const currentDialog = dialog;
    await perform(currentDialog.type, async () => {
      if (currentDialog.type === 'rename') { await update(currentDialog.project, { name: name.trim() }); setDialog(null); setNotice('工程名称已更新'); return; }
      const latest = await onRefresh();
      const result = await api<{ project: ProjectSummary; catalogRevision: number }>('/projects', { operationId: crypto.randomUUID(), expectedRevision: latest.revision, name: name.trim(), template });
      setDialog(null);
      try { await onRefresh(); await onOpen(result.project); } catch (cause) { setError(cause); }
    }, true);
  }
  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    await perform('import', async () => {
      if (file.size > 25 * 1024 * 1024) throw new Error('工程文件大于 25 MB，请选择更小的工程文件。');
      let bundle: EngineeringBundle;
      try { bundle = JSON.parse(await file.text()) as EngineeringBundle; } catch { throw new Error('文件无法读取，请选择有效的 .rdesign.json 工程文件。'); }
      if (bundle.schemaVersion !== 1 || !bundle.manifest?.name || !bundle.document || !Array.isArray(bundle.sourceFiles)) throw new Error('这不是有效的 R-Design 工程文件。');
      const latest = await onRefresh();
      await api('/projects/import', { operationId: crypto.randomUUID(), expectedRevision: latest.revision, bundle });
      await onRefresh(); setSection('recent'); setQuery(''); setNotice('工程已导入，可从列表打开');
    });
  }
  async function exportProject(project: ProjectSummary) {
    setMenu(null);
    await perform(`export-${project.id}`, async () => {
      const bundle = await api<EngineeringBundle>(`/projects/${encodeURIComponent(project.id)}/export`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${project.name.replace(/[\\/:*?"<>|]/g, '-')}.rdesign.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('工程文件已导出');
    });
  }
  function toggleProperty(project: ProjectSummary, property: 'favorite' | 'archived') {
    setMenu(null);
    void perform(`${property}-${project.id}`, async () => { await update(project, { [property]: !project[property] }); setNotice(property === 'favorite' ? (project.favorite ? '已取消收藏' : '已收藏工程') : (project.archived ? '工程已恢复' : '工程已归档')); });
  }

  return <div className="project-home" data-testid="home-page">
    <aside className="home-sidebar" aria-label="工作区导航">
      <a className="home-brand" href="/" aria-label="R-Design 主页"><BrandMark/><span>R-Design</span></a>
      <div className="home-workspace"><span className="home-workspace-avatar">R</span><div><strong>我的工作空间</strong><span>本地工程 · R-Design</span></div><ChevronDown size={14}/></div>
      <div className="home-nav-caption">工作空间</div>
      <nav className="home-nav">{sections.map(item => { const Icon = item.icon; const count = item.id === 'all' ? activeCount : item.id === 'favorites' ? favorites : item.id === 'archived' ? archived : null; return <button key={item.id} className={section === item.id ? 'active' : ''} aria-current={section === item.id ? 'page' : undefined} onClick={() => { setSection(item.id); setQuery(''); }}><Icon size={17}/><span>{item.name}</span>{count !== null && <small>{count}</small>}</button>; })}</nav>
      <div className="home-sidebar-spacer"/>
      <div className="home-sidebar-note"><Layers size={19}/><strong>每个想法，一个工程。</strong><p>画布、源码与修改记录，<br/>一起保存在工程中。</p></div>
      <div className="home-sidebar-footer"><span className="home-local-dot"/><span>本地工作空间</span><span className="home-version">v0.1</span></div>
    </aside>

    <div className="home-main">
      <header className="home-topbar"><div className="home-breadcrumb"><Folder size={15}/><span>工作空间</span><span className="home-breadcrumb-divider">/</span><strong>{currentSection.name}</strong></div><span className="home-topbar-note">设计与代码，在同一个空间</span><span className="home-user-avatar" aria-label="本地工作空间用户">R</span></header>
      <main className="home-content">
        <div className="home-heading"><div><span className="home-eyebrow">YOUR CREATIVE WORKSPACE</span><h1>工程管理<span className="home-heading-dot">.</span></h1><p>从一个想法开始，让设计在画布上生长。</p></div><div className="home-heading-actions">{catalog.canManage && <><button className="home-secondary-button" data-testid="project-home-import" onClick={() => fileRef.current?.click()} disabled={isBusy}>{busy === 'import' ? <Loader2 className="home-spin" size={15}/> : <ArrowUpFromLine size={15}/>}导入工程</button><button className="home-primary-button" data-testid="new-project" onClick={showCreate} disabled={isBusy}><Plus size={17}/>新建工程</button></>}</div></div>

        {!catalog.canManage && <div className="home-access-note"><Code2 size={16}/>当前设备可查看并打开已有工程。创建和工程管理请在桌面工作空间完成。</div>}
        <div className="home-welcome"><div className="home-welcome-copy"><span className="home-welcome-label"><span/>从设计，到实现</span><h2>留住灵感的每一步。</h2><p>在无限画布里设计，与真实界面连接，<br className="home-welcome-break"/>让每次修改都回到同一份工程。</p>{catalog.canManage && <button onClick={showCreate} disabled={isBusy}>开始一个新工程<ArrowRight size={15}/></button>}</div><div className="home-welcome-art" aria-hidden="true"><div className="home-art-grid"/><div className="home-art-code"><div><i/><i/><i/></div><span/><span/><span/><span/></div><div className="home-art-board"><div className="home-art-board-label">DESIGN FRAME</div><div className="home-art-board-title"/><div className="home-art-board-line"/><div className="home-art-board-line short"/><div className="home-art-board-block"><span/><span/></div></div><div className="home-art-cursor"><svg viewBox="0 0 22 25"><path d="M2 2V21L7 16L11 23L15 21L11 14H19Z" fill="#168bff" stroke="white" strokeWidth="2"/></svg><span>你的下一个灵感</span></div><span className="home-art-spark one"/><span className="home-art-spark two"/></div></div>

        <div className="home-library-heading"><h2>{currentSection.name === '最近' ? '最近工程' : currentSection.name}<span>{projects.length}</span></h2><div className="home-library-tools"><label className="home-search"><Search size={16}/><input data-testid="project-search" placeholder="搜索工程" aria-label="搜索工程" value={query} onChange={event => setQuery(event.target.value)}/>{query && <button aria-label="清除搜索" onClick={() => setQuery('')}><X size={14}/></button>}</label><label className="home-sort"><ArrowDownAZ size={15}/><select aria-label="工程排序" value={sort} onChange={event => setSort(event.target.value as 'updated' | 'name')}><option value="updated">{section === 'recent' ? '最近打开' : '最近更新'}</option><option value="name">名称排序</option></select></label><div className="home-view-switch" aria-label="工程显示方式"><button className={view === 'grid' ? 'active' : ''} data-testid="project-view-grid" aria-label="网格视图" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><Grid2X2 size={17}/></button><button className={view === 'list' ? 'active' : ''} data-testid="project-view-list" aria-label="列表视图" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={18}/></button></div></div></div>
        {error !== null && <div className="home-error" role="alert"><ErrorMessage error={error}/><button aria-label="关闭错误提示" onClick={() => setError(null)}><X size={14}/></button></div>}
        {notice && <div className="home-notice" role="status"><Check size={15}/>{notice}</div>}
        {projects.length === 0 ? <div className="home-empty"><div className="home-empty-icon">{query ? <Search size={28}/> : section === 'favorites' ? <Star size={28}/> : section === 'archived' ? <Archive size={28}/> : <FolderOpen size={30}/>}</div><h3>{query ? '没有找到这个工程' : section === 'favorites' ? '收藏你常用的工程' : section === 'archived' ? '归档里还没有工程' : '你的下一个想法，从这里开始'}</h3><p>{query ? '试试其他名称，或清除搜索查看所有工程。' : section === 'favorites' ? '在工程菜单中点击收藏，下次更快找到它。' : section === 'archived' ? '归档后的工程会保留在这里，可以随时恢复。' : '新建独立工程，保存你的设计画布、源码和修改记录。'}</p>{!query && !['favorites', 'archived'].includes(section) && catalog.canManage && <button className="home-primary-button" onClick={showCreate} disabled={isBusy}><Plus size={16}/>创建第一个工程</button>}{query && <button className="home-secondary-button" onClick={() => setQuery('')}>清除搜索</button>}</div> :
        <div className={`home-projects home-projects-${view}`}>{projects.map(project => <article key={project.id} className={`home-project-card ${catalog.activeProjectId === project.id ? 'is-active' : ''} ${project.archived ? 'is-archived' : ''}`} data-testid={`project-card-${project.id}`}>
          <button className="home-project-open" data-testid={`open-project-${project.id}`} aria-label={`打开工程 ${project.name}`} disabled={isBusy || project.archived} onClick={() => void perform(`open-${project.id}`, () => onOpen(project))}><ProjectPreview project={project}/><div className="home-project-info"><div className="home-project-title"><Folder size={15}/><h3>{project.name}</h3>{project.favorite && <Star className="home-favorite-star" size={13} fill="currentColor"/>}{catalog.activeProjectId === project.id && <span className="home-current-label">当前工程</span>}</div><div className="home-project-meta"><span>{templateNames[project.template]}{project.kind === 'linked' ? ' · 已关联源码' : ''}</span><span className="home-meta-dot">·</span><span>{project.lastOpenedAt ? `${dateLabel(project.lastOpenedAt)} 打开` : `${dateLabel(project.updatedAt)} 更新`}</span></div></div>{(busyProjectId === project.id || busy === `open-${project.id}`) && <span className="home-card-opening"><Loader2 size={16} className="home-spin"/>正在打开</span>}</button>
          {catalog.canManage && <div className="home-card-menu-container" ref={menu === project.id ? menuRef : undefined}><button className="home-card-menu-button" data-testid={`project-menu-${project.id}`} aria-label={`${project.name} 的工程菜单`} aria-haspopup="menu" aria-expanded={menu === project.id} disabled={isBusy} onClick={() => setMenu(menu === project.id ? null : project.id)}><MoreHorizontal size={20}/></button>{menu === project.id && <div className="home-card-menu" role="menu"><button role="menuitem" data-testid="rename-project" onClick={() => showRename(project)}><Pencil size={14}/>重命名</button><button role="menuitem" data-testid="favorite-project" onClick={() => toggleProperty(project, 'favorite')}><Star size={14}/>{project.favorite ? '取消收藏' : '收藏工程'}</button><button role="menuitem" onClick={() => void exportProject(project)}><ArrowDownToLine size={14}/>导出工程</button>{project.location && <button role="menuitem" onClick={() => { setMenu(null); void perform('copy', async () => { if (!navigator.clipboard) throw new Error('当前浏览器无法复制路径'); await navigator.clipboard.writeText(project.location); setNotice('工程路径已复制'); }); }}><Copy size={14}/>复制工程路径</button>}<div className="home-menu-divider"/><button role="menuitem" data-testid={project.archived ? 'restore-project' : 'archive-project'} onClick={() => toggleProperty(project, 'archived')}><Archive size={14}/>{project.archived ? '恢复工程' : '归档工程'}</button>{project.location && <p className="home-menu-location" title={project.location}>{project.location}</p>}</div>}</div>}
          {project.location && <div className="home-project-location" title={project.location}><Code2 size={12}/><span>{project.location}</span></div>}
        </article>)}</div>}
        <footer className="home-content-footer"><span>{activeCount} 个工程<span className="home-footer-dot">·</span>{favorites} 个收藏</span><span>每个工程，都拥有自己的画布、源码与历史。</span></footer>
      </main>
    </div>
    <input className="home-hidden" ref={fileRef} type="file" accept=".rdesign.json,.json,application/json" aria-label="选择要导入的工程文件" onChange={event => void importFile(event)}/>
    {dialog && <Modal title={dialog.type === 'create' ? '创建一个新工程' : '重命名工程'} onClose={() => setDialog(null)} disabled={isBusy}><form onSubmit={event => { event.preventDefault(); void submitDialog(); }}><label className="home-field-label" htmlFor="home-project-name">工程名称</label><input id="home-project-name" className="home-name-input" data-testid="project-name" value={name} placeholder="例如：我的产品设计" maxLength={100} onChange={event => setName(event.target.value)} autoFocus disabled={isBusy}/>{dialog.type === 'create' && <><span className="home-field-label home-template-label">选择起点</span><div className="home-template-options"><button type="button" className={template === 'blank' ? 'selected' : ''} data-testid="template-blank" aria-pressed={template === 'blank'} onClick={() => setTemplate('blank')} disabled={isBusy}><span className="home-template-icon"><Layers size={23}/></span><strong>空白设计工程</strong><p>一张空白画布，<br/>自由开始你的设计。</p>{template === 'blank' && <Check className="home-template-check" size={15}/>}</button><button type="button" className={template === 'react-monitor' ? 'selected' : ''} data-testid="template-react-monitor" aria-pressed={template === 'react-monitor'} onClick={() => setTemplate('react-monitor')} disabled={isBusy}><span className="home-template-icon"><Code2 size={23}/></span><strong>React 示例工程</strong><p>从监控看板开始，<br/>体验实时设计与源码联动。</p>{template === 'react-monitor' && <Check className="home-template-check" size={15}/>}</button></div><p className="home-modal-hint"><Folder size={13}/>画布、源码和修改记录将保存为独立工程。</p></>}{dialogError !== null && <div className="home-error" role="alert"><ErrorMessage error={dialogError}/></div>}<div className="home-modal-actions"><button type="button" className="home-secondary-button" onClick={() => setDialog(null)} disabled={isBusy}>取消</button><button className="home-primary-button" data-testid={dialog.type === 'create' ? 'create-project' : 'save-project-name'} type="submit" disabled={!name.trim() || isBusy}>{isBusy ? <Loader2 className="home-spin" size={15}/> : dialog.type === 'create' ? <Plus size={15}/> : <Check size={15}/>} {dialog.type === 'create' ? '创建并打开' : '保存名称'}</button></div></form></Modal>}
  </div>;
}
