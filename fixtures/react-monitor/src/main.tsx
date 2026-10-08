import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { installRuntime } from '@rdesign/runtime-web';
import './styles.css';

type Device = { name: string; zone: string; status: '在线' | '待检查'; cpu: number; memory: number; latency: number };
const devices: Device[] = [
  { name: 'Atlas · 计算节点', zone: '上海 / 华东 01', status: '在线', cpu: 28, memory: 62, latency: 12 },
  { name: 'Beacon · 边缘网关', zone: '深圳 / 华南 02', status: '在线', cpu: 42, memory: 38, latency: 18 },
  { name: 'Cedar · 存储节点', zone: '北京 / 华北 03', status: '待检查', cpu: 64, memory: 76, latency: 36 },
];
function DeviceRow({ device }: { device: Device }) {
  return <tr data-rdesign-id="device-row" data-rdesign-scope="shared"><td><strong>{device.name}</strong><small>{device.zone}</small></td><td><span className={`status-pill ${device.status === '在线' ? '' : 'warning'}`}>{device.status}</span></td><td>{device.cpu}%</td><td>{device.memory}%</td><td>{device.latency} ms</td><td><button className="row-action" aria-label={`查看 ${device.name}`} onClick={() => window.dispatchEvent(new CustomEvent('device-detail', { detail: device.name }))}>查看 →</button></td></tr>;
}
function MetricIcon({ kind }: { kind: 'nodes' | 'pulse' | 'time' }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">{kind === 'nodes' ? <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></> : kind === 'pulse' ? <path d="M2 12h5l3-7 4 14 3-7h5"/> : <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>}</svg>;
}
function App() {
  const [route, setRoute] = useState(location.pathname === '/' ? '/overview' : location.pathname);
  const [monitoring, setMonitoring] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [tick, setTick] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { const pop = () => setRoute(location.pathname); window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, []);
  useEffect(() => { const timer = window.setInterval(() => setTick(value => (value + 1) % 12), 4000); return () => clearInterval(timer); }, []);
  useEffect(() => { const show = (event: Event) => setDetail((event as CustomEvent<string>).detail); window.addEventListener('device-detail', show); return () => window.removeEventListener('device-detail', show); }, []);
  useEffect(() => {
    if (!settingsOpen && !detail) return;
    closeRef.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setSettingsOpen(false); setDetail(null); }
      if (event.key === 'Tab') {
        const dialog = document.querySelector('[role="dialog"]');
        const focusables = Array.from(dialog?.querySelectorAll<HTMLElement>('button,input,select') ?? []).filter(node => !node.hasAttribute('disabled'));
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  }, [settingsOpen, detail]);
  function navigate(event: React.MouseEvent<HTMLAnchorElement>, destination: string) { event.preventDefault(); history.pushState({}, '', destination); setRoute(destination); }
  const points = [70, 61, 63, 47, 51, 42, 52, 36, 39, 22, 33, 28, 42, 34, 25, 30, 20, 29, 18, 26, 22, 28, 17, 21].map((y, i) => `${12 + i * 25},${y + (i === 23 ? tick : 0)}`).join(' ');
  return <div className="monitor-app" data-rdesign-ready="true">
    <aside className="monitor-sidebar"><a className="brand" href="/overview" onClick={event => navigate(event, '/overview')}><span className="brand-symbol">p<span>·</span></span><span>pulse<small>CONNECTED SYSTEMS</small></span></a><div className="workspace-label">工作空间</div><nav aria-label="主导航"><a data-rdesign-id="nav-overview" href="/overview" className={route === '/overview' ? 'active' : ''} onClick={event => navigate(event, '/overview')}><span>◫</span>设备总览</a><a data-rdesign-id="nav-devices" href="/devices" className={route === '/devices' ? 'active' : ''} onClick={event => navigate(event, '/devices')}><span>▦</span>全部设备<em>3</em></a><a data-rdesign-id="nav-alerts" href="/alerts" className={route === '/alerts' ? 'active' : ''} onClick={event => navigate(event, '/alerts')}><span>♧</span>报警记录<em className="alert-count">1</em></a></nav><div className="sidebar-bottom"><div className="service-status"><span/>所有系统运行正常</div><div className="profile"><span>LW</span><div>Lin Workspace<small>个人工作空间</small></div><b>⌄</b></div></div></aside>
    <main className="monitor-main"><header className="topbar"><div>工作空间 <span>/</span> {route === '/devices' ? '全部设备' : route === '/alerts' ? '报警记录' : '设备总览'}</div><div className="topbar-right"><span className="env-label"><i/> 演示环境</span><button data-rdesign-id="settings-button" className="icon-button" aria-label="打开设置" onClick={() => { setSaved(false); setSettingsOpen(true); }}>⚙</button></div></header>
      <div className="page-content"><section className="page-heading"><div><div className="eyebrow">YOUR INFRASTRUCTURE, AT A GLANCE</div><h1>{route === '/devices' ? '全部设备' : route === '/alerts' ? '报警记录' : '设备总览'}</h1><p>让每一次连接都清晰可见。实时掌握你的设备运行状态。</p></div><div className="heading-actions"><span className="update-label"><i/> 每 4 秒更新</span><button data-rdesign-id="start-button" style={{ borderRadius: 8, fontSize: 13, color: '#eafff5', backgroundColor: '#168060' }} className="start-button" onClick={() => setMonitoring(value => !value)}>开始监控</button></div></section>
      {monitoring && <div data-rdesign-id="monitor-active" role="status" className="notice"><span/>实时监控已开启 · 正在接收设备数据<button onClick={() => setMonitoring(false)}>停止</button></div>}
      {saved && <div role="status" className="notice">工作空间设置已保存</div>}
      {route !== '/alerts' && <><section data-rdesign-id="device-grid" className="device-grid" style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }} aria-label="设备指标概览">
        <article data-rdesign-id="card-alpha" className="metric-card" style={{ borderRadius: 14 }}><div className="metric-top"><span className="metric-icon"><MetricIcon kind="nodes"/></span><span className="metric-tag">设备连接</span></div><h2 data-rdesign-id="card-alpha-title">在线设备</h2><div className="metric-value">2<span>/ 3</span></div><div className="metric-footer"><span className="positive">↗ 66.7%</span><span>连接成功率</span></div><div className="card-decoration alpha"/></article>
        <article data-rdesign-id="card-beta" className="metric-card" style={{ borderRadius: 14 }}><div className="metric-top"><span className="metric-icon lavender"><MetricIcon kind="pulse"/></span><span className="metric-tag">系统负载</span></div><h2 data-rdesign-id="card-beta-title">平均 CPU 使用率</h2><div className="metric-value">{45 + tick % 3}<span>%</span></div><div className="metric-footer"><span className="positive">↓ 4.2%</span><span>较上一小时</span></div><div className="card-decoration beta"/></article>
        <article data-rdesign-id="card-gamma" className="metric-card" style={{ borderRadius: 14 }}><div className="metric-top"><span className="metric-icon sand"><MetricIcon kind="time"/></span><span className="metric-tag">网络质量</span></div><h2 data-rdesign-id="card-gamma-title">平均响应时间</h2><div className="metric-value">22<span>ms</span></div><div className="metric-footer"><span className="positive">● 良好</span><span>低于 50 ms 阈值</span></div><div className="card-decoration gamma"/></article>
      </section>
      {route === '/overview' && <section className="chart-panel"><div className="panel-heading"><div><h2>运行趋势</h2><p>CPU 使用率 · 最近 24 小时</p></div><div className="chart-legend"><span/><span>平均负载</span><button>24 小时 ⌄</button></div></div><div className="chart-body"><div className="axis-labels"><span>100%</span><span>50%</span><span>0%</span></div><svg data-rdesign-id="cpu-chart" className="trend-chart" viewBox="0 0 600 105" preserveAspectRatio="none" aria-label="CPU 使用率趋势"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#168060" stopOpacity=".18"/><stop offset="100%" stopColor="#168060" stopOpacity="0"/></linearGradient></defs><path d="M0 10H600 M0 53H600 M0 96H600" stroke="#e8edeb" strokeDasharray="4 5"/><polygon points={`12,96 ${points} 587,96`} fill="url(#chart-fill)"/><polyline points={points} fill="none" stroke="#168060" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/><circle cx="587" cy={21 + tick} r="4" fill="#168060" stroke="white" strokeWidth="2"/></svg></div><div className="chart-times"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>现在</span></div></section>}
      <section className="table-panel"><div className="panel-heading"><div><h2>设备列表 <span className="title-count">3</span></h2><p>连接、资源与网络的完整视图</p></div><button className="secondary-button" onClick={event => navigate(event as unknown as React.MouseEvent<HTMLAnchorElement>, '/devices')}>查看全部 ↗</button></div><div className="table-scroll"><table data-rdesign-id="device-table"><thead><tr><th>设备名称</th><th>状态</th><th>CPU</th><th>内存</th><th>延迟</th><th/></tr></thead><tbody>{devices.map(device => <DeviceRow key={device.name} device={device}/>)}</tbody></table></div></section></>}
      {route === '/alerts' && <section className="alerts-panel"><div className="panel-heading"><div><h2>待处理报警</h2><p>保持关注，防患于未然</p></div><span className="status-pill warning">1 条待处理</span></div><div className="alert-item"><span className="alert-icon">!</span><div><h3>Cedar · 存储节点响应时间增加</h3><p>当前响应 36 ms。建议检查网络连接与存储负载。</p><small>演示事件 · 华北 03</small></div><button className="secondary-button" onClick={() => setDetail('Cedar · 存储节点')}>查看设备</button></div></section>}
      <footer className="page-footer"><span><i/> PULSE ENGINE · 演示数据</span><span>连接每一处，洞见每一刻。</span></footer></div>
    </main>
    {settingsOpen && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setSettingsOpen(false); }}><section data-rdesign-id="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-heading" className="settings-modal"><div className="modal-heading"><div><span className="eyebrow">WORKSPACE SETTINGS</span><h2 id="settings-heading">工作空间设置</h2></div><button ref={closeRef} data-rdesign-id="settings-close" className="icon-button" aria-label="关闭设置" onClick={() => setSettingsOpen(false)}>×</button></div><p className="modal-description">管理工作空间信息与监控通知。</p><form onSubmit={event => { event.preventDefault(); setSettingsOpen(false); setSaved(true); }}><label>工作空间名称<input data-rdesign-id="settings-name" name="workspace" defaultValue="Lin Workspace" required/></label><label>通知邮箱<input data-rdesign-id="settings-email" name="email" type="email" defaultValue="monitor@example.test" required/></label><label>访问密码<input data-rdesign-id="settings-password" name="password" type="password" defaultValue="private-fixture-secret"/></label><div data-rdesign-private className="private-info">内部访问令牌：fixture-private-token</div><label className="checkbox-label"><input name="notifications" type="checkbox" defaultChecked/>启用设备离线通知</label><div className="modal-actions"><button data-rdesign-id="settings-cancel" type="button" className="secondary-button" onClick={() => setSettingsOpen(false)}>取消</button><button data-rdesign-id="settings-submit" type="submit" className="start-button">保存设置</button></div></form></section></div>}
    {detail && <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="detail-heading" className="settings-modal"><div className="modal-heading"><h2 id="detail-heading">{detail}</h2><button ref={closeRef} className="icon-button" aria-label="关闭详情" onClick={() => setDetail(null)}>×</button></div><p className="modal-description">设备连接稳定。采集指标每 4 秒自动刷新。</p><div className="detail-metric">运行时间<strong>18 天 6 小时</strong></div><button className="secondary-button" onClick={() => setDetail(null)}>返回设备列表</button></section></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
if (import.meta.env.DEV || import.meta.env.VITE_RDESIGN_RUNTIME === 'true') installRuntime();
