// @ts-nocheck -- ported client compatibility layer; host contracts remain strictly checked.
import { catalogState } from './catalog.js';
import { acceptTeamSnapshot, refreshTeams, subscribeTeams, teamState } from './team-cache.js';
import { useTeamLocale, localizeTeam, localizedExperts } from './team-locale.js';
import { LibraryCard } from './library-ui.js';
import { useTeamCapabilityHealth } from './use-team-capabilities.js';
import type { ExpertCapabilityRegistry } from './capability-registry.js';
import type { ExpertCapabilityHealth } from './capability-options.js';
import { skillDisplayName } from '../../client/skill-labels.js';
import { Button, Input, MaybeAntdProvider } from './antd-ui.js';
import { antdLocale } from './antd-locale.js';
import { CategorySelect } from './category-select.js';
import React from 'react';
import { effectiveCoordinator, type ExpertTeam, type TeamInput, type TeamSnapshot, } from '../team-contract.js';
import type { ExpertSummary } from '../expert-contract.js';
import type { AgencyCatalogRemote, AgencyTeamsRemote } from './remote.js';
import { TeamEditor } from './team-editor.js';
import { CapabilityCreationDialog } from './capability-creation-dialog.js';
import { ExpertCreationConversationError, type ExpertCreationKind } from './expert-conversation-creation.js';
import { TeamDialog, TeamConfirm, TeamAvatars, Avatar, teamIssue, teamRepairIssue, IconUsers, IconFileText, IconBulb, IconSend, IconSearch, } from './team-shared.js';
// @ts-expect-error package subpath has no declaration file
import CopyPlus from 'lucide-react/dist/esm/icons/copy-plus.mjs';
// @ts-expect-error package subpath has no declaration file
import PencilLine from 'lucide-react/dist/esm/icons/pencil-line.mjs';
// @ts-expect-error package subpath has no declaration file
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.mjs';
// @ts-expect-error package subpath has no declaration file
import Plus from 'lucide-react/dist/esm/icons/plus.mjs';
export { TEAM_CSS } from './team-style.js';
export type TeamRemote = AgencyCatalogRemote & AgencyTeamsRemote;
export async function unwrap<T>(promise: Promise<{
    ok: true;
    value: T;
} | {
    ok: false;
    error: {
        message: string;
    };
}>): Promise<T> {
    const result = await promise;
    if (!result.ok)
        throw new Error(result.error.message);
    return result.value;
}
export function TeamDetails(props: {
    health?: ExpertCapabilityHealth;
    team: ExpertTeam;
    experts: readonly ExpertSummary[];
    close(): void;
    onSelect?(example?: string): void;
    onEdit?(): void;
    onDelete?(): void;
    onManageConnectors?(): void;
}) {
    const { locale, tx } = useTeamLocale();

    props = { ...props, team: localizeTeam(props.team, locale), experts: localizedExperts(props.experts, locale) };
    const [prompt, setPrompt] = React.useState(false);
    return (<TeamDialog title={tx("{0}详情", [props.team.name])} close={props.close} className="agt-detail">
      <header className="agt-detail-head">
        <TeamAvatars team={props.team} experts={props.experts} large/>
        <div className="agt-detail-identity">
          <div className="agt-name-line">
            <h2>{props.team.name}</h2>
            {props.team.tags.length > 0 && (<div className="agt-tags">
              {props.team.tags.map((tag) => (<span className="agt-tag" key={tag}>
                  {tag}
                </span>))}
            </div>)}
          </div>
          <p>
            {isDeletableTeam(props.team) ? tx("我的专家团") : tx("内置专家团")} ·{' '}
            {props.team.members.length}{tx("位专家")}</p>
        </div>
      </header>
      <p className="agt-description agt-detail-summary">{props.team.description}</p>
      {props.health && <p role="status" className="agt-help">{tx(props.health.state === 'ready' ? '能力就绪' : props.health.state === 'degraded' ? '可降级运行' : props.health.state === 'unknown' ? '能力检查中' : '必需能力未就绪')} · {props.health.ready}/{props.health.total}</p>}
      {props.health?.issues.length > 0 && <ul className="agt-help">{props.health.issues.map(issue => <li key={`${issue.type}:${issue.name}`}>{issue.type === 'skill' ? skillDisplayName(issue.name, locale) : issue.name} · {tx(issue.required ? '必需' : '可选')} · {tx(({ missing: '未安装', disabled: '已停用', starting: '连接中', error: '故障', empty: '未发现工具', ready: '可用' })[issue.state])}</li>)}</ul>}
      <dl className="agt-detail-overview">
        <div><dt>{tx("团队目标")}</dt><dd>{props.team.goal}</dd></div>
        {props.team.constraints && <div><dt>{tx("通用约束（选填）")}</dt><dd>{props.team.constraints}</dd></div>}
        <div><dt>{tx("交付要求")}</dt><dd>{props.team.deliveryRequirements}</dd></div>
      </dl>
      <div className="agt-detail-content">
      <section className="agt-detail-primary">
        <h3>
          <IconBulb />{tx("团队帮你做")}</h3>
        {props.onSelect
          ? <><div className="agt-examples agt-examples-actionable">
              {props.team.examples.map((example, i) => (<Button key={i} block style={{ height: 'auto', whiteSpace: 'normal', justifyContent: 'space-between' }} onClick={() => props.onSelect?.(example)}>
                  <span>{example}</span>
                  <IconSend size={16}/>
                </Button>))}
            </div><p className="agt-help">{tx("选择后填入聊天草稿，由你确认发送。")}</p></>
          : <div className="agt-example-list">{props.team.examples.map(example => <p key={example}>“{example}”</p>)}</div>}
      </section>
      {(props.team.skills ?? []).length > 0 && <section><h3>{tx("技能")}</h3><div className="agt-plugin-chips">{(props.team.skills ?? []).map(skill => <span key={skill.name} title={skill.name}>{skillDisplayName(skill.name, locale)}{skill.required ? ` · ${tx("必需")}` : ''}</span>)}</div></section>}
      {(props.team.connectorStates ?? []).length > 0 && <section><h3>{tx("连接器")}</h3><div className="agt-connector-list">{(props.team.connectorStates ?? []).map(connector => <div key={connector.dependency}>
        <span className="agt-connector-state" data-state={connector.state} data-ready={connector.installed && connector.enabled && connector.credentialsReady && connector.state === 'running' && connector.toolCount !== 0}><i aria-hidden="true"/><strong>{connector.dependency}</strong><small>{connectorStatus(connector, tx)}</small></span>
      </div>)}</div>{props.onManageConnectors && <Button onClick={props.onManageConnectors}>{tx("管理连接器")}</Button>}</section>}
      <section className="agt-detail-members">
        <h3>
          <IconUsers />{tx("团队成员")}</h3>
        <div className="agt-detail-roster">{props.team.members.map(member => {
          const expert = props.experts.find(item => item.slug === member.expertSlug)
          return <article key={member.expertSlug}>
            <Avatar expert={expert} size={40}/>
            <div><strong>{expert?.name ?? tx("成员失效")}</strong><span>{member.duty}</span><p>{member.instructions}</p></div>
          </article>
        })}</div>
        <p className="agt-help">{tx("由当前会话协调，成员分别分析后统一汇总。")}</p>
      </section>
      <section className="agt-detail-delivery">
        <h3>
          <IconFileText />{tx("主理人提示词")}</h3>
        <Button style={{ marginTop: 8 }} onClick={() => setPrompt(!prompt)} aria-expanded={prompt}>{tx("查看主理人提示词")}</Button>
        {prompt && (<Input.TextArea className="agt-read-prompt" readOnly aria-label={tx("主理人提示词正文")} value={effectiveCoordinator(props.team, locale)} style={{ height: 280, resize: 'none', overflow: 'auto' }}/>)}
      </section>
      </div>
      {(props.onEdit || props.onDelete) && <footer className="agt-detail-actions">
        {props.onEdit && <Button onClick={props.onEdit}>{tx("编辑专家团")}</Button>}
        {props.onDelete && <Button danger onClick={props.onDelete}>{tx("删除专家团")}</Button>}
      </footer>}
    </TeamDialog>);
}

function connectorStatus(connector: ExpertTeam['connectorStates'][number], tx: (key: string, values?: readonly unknown[]) => string): string {
    if (!connector.installed)
        return tx("未安装");
    if (!connector.enabled)
        return tx("已停用");
    if (!connector.credentialsReady)
        return tx("待配置");
    if (connector.state === 'starting')
        return tx("连接中");
    if (connector.state === 'running')
        return tx(connector.toolCount === 0 ? '未发现工具' : '可用');
    return tx("故障");
}
function teamInput(team: ExpertTeam): TeamInput {
    const { runtime: _runtime, skills: _skills, connectors: _connectors, connectorStates: _connectorStates, provenance: _provenance, conversationCreated: _conversationCreated, ...input } = team;
    return input;
}

export const isConversationCreatedTeam = (team: Pick<ExpertTeam, 'conversationCreated'>): boolean => team.conversationCreated === true;
export const isDeletableTeam = (team: Pick<ExpertTeam, 'builtin' | 'conversationCreated'>): boolean => !team.builtin || isConversationCreatedTeam(team);
const teamSource = (team: Pick<ExpertTeam, 'builtin' | 'conversationCreated'>): 'builtin' | 'custom' => isDeletableTeam(team) ? 'custom' : 'builtin';

export function TeamsPanel(props: {
    capabilityRegistry?: ExpertCapabilityRegistry;
    remote: TeamRemote;
    onOpenConnectors?(): void;
    onExpertsChanged?(): void;
    headerLinks?: React.ReactNode;
    sharedHeader?: boolean;
    onSummary?: (value: {
        total: number;
        enabled: number;
    }) => void;
    title?: string;
    onCreateWithConversation?(kind: ExpertCreationKind): Promise<void>;
    onSelectTeam?(team: ExpertTeam, example?: string): boolean | Promise<boolean>;
    onCreatedTeam?(team: ExpertTeam, experts: readonly ExpertSummary[]): void;
}) {
    const { locale, tx } = useTeamLocale();
    const healthFor = useTeamCapabilityHealth(props.capabilityRegistry);

    const [snapshot, setSnapshot] = React.useState<TeamSnapshot | null>(() => teamState(props.remote));
    const [rawExperts, setExperts] = React.useState<ExpertSummary[]>(() => {
        const catalog = catalogState(props.remote);
        return catalog.revision < 0 ? [] : [...catalog.experts];
    });
    const experts = localizedExperts(rawExperts, locale);
    React.useEffect(() => {
        const available = snapshot?.teams.filter(team => !teamIssue(team, rawExperts, snapshot.enabledExperts, healthFor(team, rawExperts))).length ?? 0;
        props.onSummary?.({ total: snapshot?.teams.length ?? 0, enabled: available });
    }, [snapshot, rawExperts, props.onSummary, healthFor]);
    const [query, setQuery] = React.useState('');
    const [filter, setFilter] = React.useState<'all' | 'builtin' | 'custom'>('all');
    const [status, setStatus] = React.useState('');
    const [error, setError] = React.useState('');
    const [notice, setNotice] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [creationOpen, setCreationOpen] = React.useState(false);
    const [details, setDetails] = React.useState<ExpertTeam | null>(null);
    const [editor, setEditor] = React.useState<{
        value?: TeamInput;
        revision: number;
    } | null>(null);
    const [confirm, setConfirm] = React.useState<{
        team: ExpertTeam;
        action: 'delete';
    } | null>(null);
    const alive = React.useRef(true);
    const sequence = React.useRef(0);
    React.useEffect(() => {
        alive.current = true;
        void load();
        const timer = setInterval(() => { if (!busy) void load(); }, 3000);
        const unsubscribe = subscribeTeams(props.remote, () => {
            if (!alive.current)
                return;
            const next = teamState(props.remote);
            if (!next)
                return;
            sequence.current++;
            setSnapshot(next);
        });
        return () => {
            alive.current = false;
            sequence.current++;
            clearInterval(timer);
            unsubscribe();
        };
    }, [props.remote, busy]);
    const load = async () => {
        const generation = ++sequence.current;
        try {
            const teams = await refreshTeams(props.remote);
            if (!alive.current)
                return;
            // 团队缓存通知会推进 sequence，避免旧查询覆盖新快照；专家名册仍要落到当前面板。
            if (generation === sequence.current)
                setSnapshot(teams);
            const known = catalogState(props.remote);
            if (known.revision >= 0)
                setExperts([...known.experts]);
            else {
                const catalog = await unwrap(props.remote.getCatalog());
                if (!alive.current)
                    return;
                setExperts(catalog.experts);
            }
            setError('');
        }
        catch (cause) {
            if (alive.current)
                setError(cause instanceof Error ? tx(cause.message) : tx("加载失败。"));
        }
    };
    const accept = (value: TeamSnapshot) => {
        if (!alive.current)
            return;
        sequence.current++;
        const next = { ...value, engine: value.engine ?? snapshot?.engine };
        acceptTeamSnapshot(props.remote, next);
        setSnapshot(next);
        props.onExpertsChanged?.();
    };
    const change = async (team: ExpertTeam, action: 'delete', confirmed = false) => {
        if (busy || !snapshot)
            return;
        if (!confirmed) {
            setConfirm({ team, action });
            setError('');
            return;
        }
        setBusy(true);
        setError('');
        try {
            accept(await unwrap(props.remote.deleteTeam(team.id, snapshot.revision)));
            setDetails(null);
            setNotice(tx("专家团已删除，成员与历史会话保留。"));
            setConfirm(null);
        }
        catch (cause) {
            setError(cause instanceof Error ? tx(cause.message) : tx("操作失败。"));
        }
        finally {
            setBusy(false);
        }
    };
    const copy = (team: ExpertTeam) => {
        setDetails(null);
        const { id: _id, builtin: _builtin, runtime: _runtime, skills: _skills, connectors: _connectors, connectorStates: _connectorStates, provenance: _provenance, conversationCreated: _conversationCreated, ...value } = team;
        setEditor({
            value: {
                ...structuredClone(value),
                name: tx("{0}副本", [team.name]).slice(0, 40),
            },
            revision: snapshot!.revision,
        });
    };
    const summon = async (team: ExpertTeam) => {
        if (busy || !snapshot)
            return;
        setBusy(true);
        setError('');
        try {
            accept(await unwrap(props.remote.recallTeam(team.id, snapshot.revision)));
            setNotice(tx("专家团现在可在对话中使用。"));
        }
        catch (cause) {
            setError(cause instanceof Error ? tx(cause.message) : tx("操作失败。"));
        }
        finally {
            setBusy(false);
        }
    };
    const filteredTeams = snapshot?.teams.map(team => localizeTeam(team, locale)).filter(team =>
        (filter === 'all' || teamSource(team) === filter) &&
        (!status || (() => {
            const repair = teamRepairIssue(team, experts, healthFor(team, rawExperts)) !== undefined;
            const recalled = team.members.every(member => snapshot.enabledExperts.includes(member.expertSlug));
            return status === 'available' ? recalled && !repair : status === 'recall' ? !recalled && !repair : repair;
        })()) &&
        `${team.name} ${team.description} ${team.goal} ${team.deliveryRequirements} ${team.tags.join(' ')} ${team.examples.join(' ')} ${team.members.map(member => experts.find(expert => expert.slug === member.expertSlug)?.name ?? '').join(' ')}`
            .toLowerCase().includes(query.toLowerCase())) ?? [];
    const edit = (team: ExpertTeam) => setEditor({
        value: teamInput(team),
        revision: snapshot!.revision,
    });
    const panel = (<section className="aag-section aag-team-library" id="aag-team-source-panel">
      {!props.sharedHeader && <div className="aag-toolbar">
        <div className="aag-title-row">
          {!props.sharedHeader && <h2 className="aag-title">{props.title ?? tx("专家团")}</h2>}
          {!props.sharedHeader && props.headerLinks}
          <span className="aag-header-stat">
            <strong>{snapshot?.teams.length ?? 0}</strong>{tx("个专家团")}</span>
        </div>
      </div>}

      <div className="aag-filters aag-card-filters">
        <div className="aag-field aag-field-source">
          <CategorySelect id="aag-team-source" label={tx("来源")} value={filter} onChange={(value) => { if (value === 'builtin' || value === 'custom' || value === 'all') setFilter(value) }} options={[
            { value: 'all', label: tx("全部来源") },
            { value: 'builtin', label: tx("内置") },
            { value: 'custom', label: tx("自定义") },
          ]}/>
        </div>
        <div className="aag-field aag-field-status">
          <CategorySelect id="aag-team-status" label={tx("状态")} value={status} onChange={setStatus} options={[
            { value: '', label: tx("全部状态") },
            { value: 'available', label: tx("可用") },
            { value: 'recall', label: tx("待召唤") },
            { value: 'blocked', label: tx("需修复") },
        ]}/>
        </div>
        <div className="aag-field aag-field-search">
          <div className="aag-search-wrap">
            <Input id="aag-team-search" className="aag-search" aria-label={tx("搜索专家团")} placeholder={tx("搜索团队、用途或成员")} value={query} autoComplete="off" spellCheck={false} prefix={<IconSearch size={16}/>} allowClear={{ clearIcon: <span aria-label={tx("清除搜索")}/> }} onChange={(event) => setQuery(event.target.value)}/>
          </div>
        </div>
        <div className="aag-filter-actions">
          <Button type="primary" icon={<Plus size={17} strokeWidth={1.7} aria-hidden="true"/>} disabled={!snapshot || busy} onClick={() => setCreationOpen(true)}>{tx("新建专家团")}</Button>
        </div>
      </div>
      {error && (<div className="aag-error" role="alert">
          {error}
          <button type="button" onClick={() => void load()}>{tx("刷新重试")}</button>
        </div>)}
      {snapshot?.engine?.state === 'disabled' && (<p className="aag-note" role="note">{tx(snapshot.engine.recommendation)}</p>)}
      {notice && (<p role="status" className="aag-custom-notice">
          {notice}
        </p>)}
      {!snapshot && !error && <p role="status">{tx("正在加载专家团…")}</p>}
      <div className="aag-expert-grid aag-team-grid">
        {filteredTeams.map((team) => {
            const repairIssue = teamRepairIssue(team, experts, healthFor(team, rawExperts));
            const memberCount = team.members.length;
            const validMembers = team.members.every(member => experts.some(expert => expert.slug === member.expertSlug && !expert.conflict));
            const recalled = team.members.every(member => snapshot!.enabledExperts.includes(member.expertSlug));
            return (<LibraryCard key={team.id} testId="team-card" name={team.name} avatar={<div className="aag-team-avatar">
                  <TeamAvatars team={team} experts={experts}/>
                </div>} metadata={<>{tx("{0} 位专家", [memberCount])}{team.tags.slice(0, 2).map(tag => <span key={tag} className="aag-source-badge">{tag}</span>)}{repairIssue ? <> · {tx("需修复")}</> : null}</>} description={repairIssue
                    ? `${team.description} ${tx(repairIssue)}`
                    : team.description} guidance={<span title={team.deliveryRequirements}>{tx('交付要求')} · {team.deliveryRequirements}</span>} openLabel={tx("查看详情")} onOpen={() => setDetails(team)} actions={<>
                  <button type="button" className={`aag-card-action aag-card-action-primary aag-team-summon${recalled ? ' is-active' : ''}`} disabled={busy || recalled || !validMembers || !!repairIssue} title={tx("召唤团队成员")} aria-label={tx("召唤团队成员")} aria-pressed={recalled} onClick={() => void summon(team)}>
                    <IconUsers size={18}/>{tx("召唤")}</button>
                  <button type="button" className="aag-card-action aag-team-copy" disabled={busy} onClick={() => copy(team)}>
                    <CopyPlus size={17} strokeWidth={1.7} aria-hidden="true"/>{tx("复制")}</button>
                  {!team.builtin && <button type="button" className="aag-card-action aag-team-edit" disabled={busy} onClick={() => edit(team)}>
                    <PencilLine size={17} strokeWidth={1.7} aria-hidden="true"/>{tx("编辑")}</button>}
                  {isDeletableTeam(team) && <button type="button" className="aag-card-action aag-card-action-danger aag-team-delete" disabled={busy} onClick={() => void change(team, 'delete')}>
                    <Trash2 size={17} strokeWidth={1.7} aria-hidden="true"/>{tx("删除")}</button>}
                </>}/>);
        })}
      </div>{' '}
      {snapshot && !filteredTeams.length && (<div className="aag-empty">
          <IconUsers size={40}/>
          <h3>{tx("没有找到专家团")}</h3>
          <p>{tx("换个关键词，或创建自己的专家团。")}</p>
          <Button onClick={() => {
                setQuery('');
                setFilter('all');
            }}>{tx("清除筛选")}</Button>
        </div>)}
      {details && (<TeamDetails team={details} experts={experts} health={healthFor(details, rawExperts)} close={() => setDetails(null)} onSelect={props.onSelectTeam === undefined || teamIssue(details, experts, snapshot!.enabledExperts, healthFor(details, rawExperts)) !== undefined ? undefined : (example) => { void Promise.resolve(props.onSelectTeam?.(details, example)).then(selected => { if (selected) setDetails(null) }) }} onManageConnectors={props.onOpenConnectors} onEdit={!details.builtin
                ? () => {
                    setEditor({
                        value: teamInput(details),
                        revision: snapshot!.revision,
                    });
                    setDetails(null);
                }
                : undefined} onDelete={isDeletableTeam(details) ? () => void change(details, 'delete') : undefined}/>)}
      <CapabilityCreationDialog open={creationOpen} copy={{
            title: tx("新建专家团"),
            hint: tx("选择创建方式，稍后仍可继续编辑和完善专家团。"),
            manual: tx("手动创建"),
            manualHint: tx("创建本地专家团配置，直接填写团队目标、成员和分工。"),
            conversation: tx("通过对话创建"),
            conversationHint: tx("让 expert-manager 通过提问梳理并生成完整专家团包。"),
            conversationBusy: tx("正在打开对话…"),
            cancel: tx("取消"),
        }} onClose={() => setCreationOpen(false)} onManual={() => setEditor({ revision: snapshot!.revision })}
        onConversation={props.onCreateWithConversation === undefined ? undefined : () => props.onCreateWithConversation!('team')}
        errorMessage={(cause) => {
            if (cause instanceof ExpertCreationConversationError) {
                return cause.code === 'workspaceUnavailable'
                    ? tx("当前没有可用的工作区，请先创建或打开工作区。")
                    : tx("无法准备新对话的输入框，请重试。");
            }
            return cause instanceof Error ? cause.message : String(cause);
        }}/>
      {editor && (<TeamEditor initial={editor.value} experts={experts} enabledExperts={snapshot!.enabledExperts} close={() => setEditor(null)} refresh={async () => {
                const latest = await unwrap(props.remote.getTeams());
                accept(latest);
                const catalog = await unwrap(props.remote.getCatalog());
                setExperts(catalog.experts);
                return latest;
            }} save={async (value, revision) => {
                const existing = new Set(snapshot!.teams.map(team => team.id));
                const next = await unwrap(props.remote.saveTeam(value, revision ?? editor.revision));
                const created = next.teams.find(team => !existing.has(team.id));
                accept(next);
                setEditor(null);
                setNotice(tx("专家团配置已保存。"));
                if (created)
                    props.onCreatedTeam?.(created, rawExperts);
            }}/>)}
      {confirm && (<TeamConfirm title={tx("删除专家团？")} label={tx("确认删除")} busy={busy} error={error} onCancel={() => setConfirm(null)} onConfirm={() => {
                const current = confirm;
                void change(current.team, current.action, true);
            }}>
          <p>
            {tx("删除“{0}”的配置，保留成员专家和历史会话。", [confirm.team.name])}
          </p>
        </TeamConfirm>)}
    </section>);
    return <MaybeAntdProvider locale={antdLocale(locale)}>{panel}</MaybeAntdProvider>;
}
