// @ts-nocheck -- ported client compatibility layer; host contracts remain strictly checked.
import { catalogState } from './catalog.js';
import { acceptTeamSnapshot, refreshTeams, subscribeTeams, teamState } from './team-cache.js';
import { useTeamLocale, localizeTeam, localizedExperts } from './team-locale.js';
import { LibraryCard } from './library-ui.js';
import { Button, Input, MaybeAntdProvider } from './antd-ui.js';
import { antdLocale } from './antd-locale.js';
import { CategorySelect } from './category-select.js';
import React from 'react';
import { effectiveCoordinator, isPluginLeadTeam, type CatalogTeam, type ExpertTeam, type LeadExpertTeam, type TeamInput, type TeamSnapshot, } from '../team-contract.js';
import type { ExpertSummary } from '../expert-contract.js';
import type { AgencyCatalogRemote, AgencyTeamsRemote } from './remote.js';
import type { TeamReferenceTarget } from './team-reference.js';
import { TeamEditor } from './team-editor.js';
import { TeamDialog, TeamConfirm, TeamAvatars, MemberList, Avatar, teamIssue, IconUsers, IconFileText, IconPlus, IconArrowRight, IconBulb, IconCopy, IconSend, IconSearch, IconEye, } from './team-shared.js';
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
    team: ExpertTeam;
    experts: readonly ExpertSummary[];
    close(): void;
    onSelect?(example?: string): void;
    onCopy?(): void;
    onEdit?(): void;
    onDelete?(): void;
}) {
    const { locale, tx } = useTeamLocale();

    props = { ...props, team: localizeTeam(props.team, locale), experts: localizedExperts(props.experts, locale) };
    const [prompt, setPrompt] = React.useState(false);
    return (<TeamDialog title={tx("{0}详情", [props.team.name])} close={props.close} className="agt-detail">
      <header className="agt-detail-head">
        <TeamAvatars team={props.team} experts={props.experts} large/>
        <div>
          <div className="agt-name-line">
            <h2>{props.team.name}</h2>
            {props.team.tags.length > 0 && (<div className="agt-tags">
              {props.team.tags.map((tag) => (<span className="agt-tag" key={tag}>
                  {tag}
                </span>))}
            </div>)}
          </div>
          <p>
            {props.team.builtin ? tx("内置专家团") : tx("我的专家团")} ·{' '}
            {props.team.members.length}{tx("位专家")}</p>
          <div className="agt-row">
            {props.onSelect && (<Button type="primary" onClick={() => props.onSelect?.()}>
                <IconSend size={16}/>{tx("召唤专家团")}</Button>)}
            {props.onCopy && (<Button onClick={props.onCopy}>
                <IconCopy size={16}/>{tx("复制并自定义")}</Button>)}
            {props.onEdit && (<Button onClick={props.onEdit}>{tx("编辑专家团")}</Button>)}
          </div>
        </div>
      </header>
      <p className="agt-description">{props.team.description}</p>
      <section>
        <h3>
          <IconBulb />{tx("团队帮你做")}</h3>
        <div className="agt-examples">
          {props.team.examples.map((example, i) => (<Button key={i} block disabled={!props.onSelect} style={{ height: 'auto', whiteSpace: 'normal', justifyContent: 'space-between' }} onClick={() => props.onSelect?.(example)}>
              <span>“{example}”</span>
              <IconSend size={16}/>
            </Button>))}
        </div>
        <p className="agt-help">{tx("选择后填入聊天草稿，由你确认发送。")}</p>
      </section>
      <section>
        <h3>
          <IconUsers />{tx("团队成员")}</h3>
        <MemberList team={props.team} experts={props.experts}/>
        <p className="agt-help">{tx("由当前会话协调，成员分别分析后统一汇总。")}</p>
        <details>
          <summary>{tx("查看成员完整分工")}</summary>
          {props.team.members.map((member) => (<p key={member.expertSlug}>
              <strong>
                {props.experts.find((e) => e.slug === member.expertSlug)
                ?.name ?? tx("成员失效")}
                ：
              </strong>
              {member.instructions}
            </p>))}
        </details>
      </section>
      <section>
        <h3>
          <IconFileText />{tx("你将获得")}</h3>
        <p>{props.team.deliveryRequirements}</p>
        <Button style={{ marginTop: 8 }} onClick={() => setPrompt(!prompt)} aria-expanded={prompt}>{tx("查看主理人提示词")}</Button>
        {prompt && (<Input.TextArea className="agt-read-prompt" readOnly aria-label={tx("主理人提示词正文")} value={effectiveCoordinator(props.team, locale)} style={{ height: 280, resize: 'none', overflow: 'auto' }}/>)}
      </section>
      {props.onDelete && (<Button danger style={{ margin: '0 16px 16px', alignSelf: 'flex-start' }} onClick={props.onDelete}>{tx("删除专家团")}</Button>)}
    </TeamDialog>);
}

function connectorStatus(connector: LeadExpertTeam['connectorStates'][number], tx: (key: string, values?: readonly unknown[]) => string): string {
    if (!connector.installed)
        return tx("未安装");
    if (!connector.enabled)
        return tx("已停用");
    if (!connector.credentialsReady)
        return tx("待配置");
    if (connector.state === 'starting')
        return tx("连接中");
    if (connector.state === 'running')
        return tx("可用");
    return tx("故障");
}

function LeadTeamDetails(props: {
    team: LeadExpertTeam;
    experts: readonly ExpertSummary[];
    busy: boolean;
    close(): void;
    select(example?: string): void;
    connector(dependency: string, action: 'install' | 'enable' | 'disable' | 'test'): void;
    openConnectors?(): void;
}) {
    const { tx } = useTeamLocale();
    const agents = [props.team.lead, ...props.team.members];
    return (<TeamDialog title={tx("{0}详情", [props.team.name])} close={props.close} className="agt-detail agt-plugin-detail">
      <header className="agt-detail-head">
        <div className="aag-team-avatar"><div className="agt-stack">{agents.slice(0, 3).map(agent => <Avatar key={agent.expertSlug} expert={props.experts.find(expert => expert.slug === agent.expertSlug)}/>)}</div></div>
        <div><div className="agt-name-line"><h2>{props.team.name}</h2><span className="agt-tag">v{props.team.packageVersion}</span><span className="agt-tag">Lead Runtime</span></div>
          <p>{tx("内置")} · {props.team.packageName}</p>
          <div className="agt-row"><Button type="primary" disabled={props.busy} onClick={() => props.select()}><IconSend size={16}/>{tx("召唤专家团")}</Button></div>
        </div>
      </header>
      <p className="agt-description">{props.team.description}</p>
      {props.team.tags.length > 0 && <div className="agt-tags">{props.team.tags.map(tag => <span className="agt-tag" key={tag}>{tag}</span>)}</div>}
      <section><h3><IconUsers />{tx("团队成员")}</h3><div className="agt-plugin-roster">{agents.map(agent => <div key={agent.expertSlug}>
        <Avatar expert={props.experts.find(expert => expert.slug === agent.expertSlug)}/><div><strong>{agent.name}</strong><span>{agent.role === 'lead' ? 'Lead' : tx("成员")}</span><p>{agent.description}</p></div>
      </div>)}</div></section>
      <section><h3>{tx("技能")}</h3>{props.team.skills.length === 0 ? <p className="agt-help">{tx("无")}</p> : <div className="agt-plugin-chips">{props.team.skills.map(skill => <span key={skill.name}>{skill.name}{skill.required ? ` · ${tx("必需")}` : ''}</span>)}</div>}</section>
      <section><h3>{tx("连接器")}</h3>{props.team.connectorStates.length === 0 ? <p className="agt-help">{tx("无")}</p> : <div className="agt-connector-list">{props.team.connectorStates.map(connector => <div key={connector.dependency}>
        <span className="agt-connector-state" data-state={connector.state} data-ready={connector.installed && connector.enabled && connector.credentialsReady}><i aria-hidden="true"/><strong>{connector.dependency}</strong><small>{connectorStatus(connector, tx)}</small></span>
        <div className="agt-row">{!connector.installed ? <Button disabled={props.busy || (!connector.installable && !connector.credentialsRequired)} onClick={() => connector.credentialsRequired ? props.openConnectors?.() : props.connector(connector.dependency, 'install')}>{connector.credentialsRequired ? tx("配置") : tx("安装")}</Button> : <>
          <Button disabled={props.busy} onClick={() => props.connector(connector.dependency, connector.enabled ? 'disable' : 'enable')}>{connector.enabled ? tx("停用") : tx("启用")}</Button>
          <Button disabled={props.busy} onClick={() => props.connector(connector.dependency, 'test')}>{tx("测试")}</Button></>}</div>
      </div>)}</div>}</section>
      {props.team.examples.length > 0 && <section><h3><IconBulb />{tx("团队帮你做")}</h3><div className="agt-examples">{props.team.examples.map(prompt => <Button key={prompt} block disabled={props.busy} onClick={() => props.select(prompt)}><span>“{prompt}”</span><IconSend size={16}/></Button>)}</div></section>}
    </TeamDialog>);
}
export function TeamsPanel(props: {
    remote: TeamRemote;
    prepareSelect?(): (team: ExpertTeam, example?: string) => boolean | Promise<boolean>;
    onSelect?(team: ExpertTeam, example?: string): boolean | Promise<boolean>;
    preparePluginSelect?(): (team: TeamReferenceTarget, example?: string) => boolean | Promise<boolean>;
    onOpenConnectors?(): void;
    onExpertsChanged?(): void;
    headerLinks?: React.ReactNode;
    sharedHeader?: boolean;
    onSummary?: (value: {
        total: number;
        enabled: number;
    }) => void;
    title?: string;
}) {
    const { locale, tx } = useTeamLocale();

    const [snapshot, setSnapshot] = React.useState<TeamSnapshot | null>(() => teamState(props.remote));
    React.useEffect(() => {
        props.onSummary?.({ total: snapshot?.teams.length ?? 0, enabled: snapshot?.enabledTeams.length ?? 0 });
    }, [snapshot?.teams.length, snapshot?.enabledTeams.length, props.onSummary]);
    const [rawExperts, setExperts] = React.useState<ExpertSummary[]>(() => {
        const catalog = catalogState(props.remote);
        return catalog.revision < 0 ? [] : [...catalog.experts];
    });
    const experts = localizedExperts(rawExperts, locale);
    const [query, setQuery] = React.useState('');
    const [filter, setFilter] = React.useState<'all' | 'builtin' | 'custom' | 'plugin'>('all');
    const [status, setStatus] = React.useState('');
    const [error, setError] = React.useState('');
    const [notice, setNotice] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [details, setDetails] = React.useState<CatalogTeam | null>(null);
    const [editor, setEditor] = React.useState<{
        value?: TeamInput;
        enabled: boolean;
        revision: number;
    } | null>(null);
    const [confirm, setConfirm] = React.useState<{
        team: ExpertTeam;
        action: 'enable' | 'delete' | 'select';
        example?: string;
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
    const changePlugin = async (id: string, enabled: boolean) => {
        if (busy || !snapshot)
            return;
        setBusy(true);
        setError('');
        try {
            accept(await unwrap(props.remote.setTeamEnabled(id, enabled, snapshot.revision)));
            props.onExpertsChanged?.();
        }
        catch (cause) {
            setError(cause instanceof Error ? tx(cause.message) : tx("操作失败。"));
        }
        finally {
            setBusy(false);
        }
    };
    const changeConnector = async (team: LeadExpertTeam, dependency: string, action: 'install' | 'enable' | 'disable' | 'test') => {
        if (busy)
            return;
        const connector = team.connectorStates.find(item => item.dependency === dependency);
        if (!connector)
            return;
        if (action === 'install' && connector.credentialsRequired) {
            props.onOpenConnectors?.();
            return;
        }
        setBusy(true);
        setError('');
        try {
            let next;
            if (action === 'install')
                next = await unwrap(props.remote.installTeamConnector(team.id, dependency, {}));
            else if (action === 'test')
                next = await unwrap(props.remote.testTeamConnector(team.id, dependency));
            else if (action === 'enable' || action === 'disable')
                next = await unwrap(props.remote.setTeamConnectorEnabled(team.id, dependency, action === 'enable'));
            else
                throw new Error(tx("当前版本不支持 Connector 生命周期操作。"));
            accept(next);
            if (details?.id === team.id)
                setDetails(next.teams.find(item => item.id === team.id && isPluginLeadTeam(item)) ?? null);
            setNotice(action === 'test' ? tx("Connector 测试完成。") : tx("Connector 状态已更新。"));
        }
        catch (cause) {
            setError(cause instanceof Error ? tx(cause.message) : tx("操作失败。"));
        }
        finally {
            setBusy(false);
        }
    };
    const selectPlugin = async (team: LeadExpertTeam, example?: string) => {
        if (busy || !snapshot)
            return;
        setBusy(true);
        setError('');
        try {
            let selected = team;
            if (!snapshot.enabledTeams.includes(team.id)) {
                const next = await unwrap(props.remote.setTeamEnabled(team.id, true, snapshot.revision));
                accept(next);
                selected = next.teams.find(item => item.id === team.id && isPluginLeadTeam(item)) ?? { ...team, enabled: true };
                props.onExpertsChanged?.();
            }
            const insert = props.preparePluginSelect?.();
            if (!insert || !(await insert({ id: selected.id, name: selected.name, examples: selected.examples }, example)))
                setError(tx("团队已启用，但无法写入当前聊天草稿。请关闭设置后，在聊天的专家团入口选择。"));
            else
                setNotice(tx("专家团已加入草稿，确认需求后发送。"));
        }
        catch (cause) {
            setError(cause instanceof Error ? tx(cause.message) : tx("操作失败。"));
        }
        finally {
            setBusy(false);
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
    const change = async (team: ExpertTeam, action: 'enable' | 'delete' | 'select', example?: string, confirmed = false) => {
        if (busy || !snapshot)
            return;
        const enabling = action !== 'delete' &&
            (action === 'select' || !snapshot.enabledTeams.includes(team.id));
        const missing = team.members.filter((m) => !snapshot.enabledExperts.includes(m.expertSlug));
        if (!confirmed && (action === 'delete' || (enabling && missing.length))) {
            setConfirm({ team, action, example });
            setError('');
            return;
        }
        const insert = props.prepareSelect?.() ?? props.onSelect;
        setBusy(true);
        setError('');
        try {
            if (action === 'delete') {
                accept(await unwrap(props.remote.deleteTeam(team.id, snapshot.revision)));
                setDetails(null);
                setNotice(tx("专家团已删除，成员与历史会话保留。"));
            }
            else {
                if (action === 'enable' ||
                    !snapshot.enabledTeams.includes(team.id) ||
                    missing.length)
                    accept(await unwrap(props.remote.setTeamEnabled(team.id, enabling, snapshot.revision)));
                if (!alive.current)
                    return;
                if (action === 'select') {
                    if (!insert || !(await insert(team, example))) {
                        setError(tx("团队已启用，但无法写入当前聊天草稿。请关闭设置后，在聊天的专家团入口选择。"));
                        return;
                    }
                    setDetails(null);
                    setNotice(tx("专家团已加入草稿，确认需求后发送。"));
                }
            }
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
        const { id: _id, builtin: _builtin, ...value } = team;
        setEditor({
            value: {
                ...structuredClone(value),
                name: tx("{0}副本", [team.name]).slice(0, 40),
            },
            enabled: false,
            revision: snapshot!.revision,
        });
    };
    const filteredTeams = snapshot?.teams.map(team => isPluginLeadTeam(team) ? team : localizeTeam(team, locale)).filter(team =>
        (filter === 'all' || (filter === 'builtin' ? team.builtin : !team.builtin)) &&
        (!status || snapshot.enabledTeams.includes(team.id) === (status === 'enabled')) &&
        (isPluginLeadTeam(team)
            ? `${team.name} ${team.description} ${team.lead.name} ${team.members.map(member => member.name).join(' ')}`
            : `${team.name} ${team.description} ${team.members.map(member => experts.find(expert => expert.slug === member.expertSlug)?.name ?? '').join(' ')}`)
            .toLowerCase().includes(query.toLowerCase())) ?? [];
    const edit = (team: ExpertTeam) => setEditor({
        value: team,
        enabled: snapshot!.enabledTeams.includes(team.id),
        revision: snapshot!.revision,
    });
    const panel = (<section className="aag-section aag-team-library" id="aag-team-source-panel">
      {!props.sharedHeader && <div className="aag-toolbar">
        <div className="aag-title-row">
          {!props.sharedHeader && <h2 className="aag-title">{props.title ?? tx("专家团")}</h2>}
          {!props.sharedHeader && props.headerLinks}
          <span className="aag-header-stat">
            <strong>{snapshot?.teams.length ?? 0}</strong>{tx("个专家团")}</span>
          <span className="aag-header-stat">{tx("已启用")}<strong>{snapshot?.enabledTeams.length ?? 0}</strong>
          </span>
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
            { value: 'enabled', label: tx("已启用") },
            { value: 'disabled', label: tx("已停用") },
        ]}/>
        </div>
        <div className="aag-field aag-field-search">
          <div className="aag-search-wrap">
            <Input id="aag-team-search" className="aag-search" aria-label={tx("搜索专家团")} placeholder={tx("搜索团队、用途或成员")} value={query} autoComplete="off" spellCheck={false} prefix={<IconSearch size={16}/>} allowClear={{ clearIcon: <span aria-label={tx("清除搜索")}/> }} onChange={(event) => setQuery(event.target.value)}/>
          </div>
        </div>
        <div className="aag-filter-actions">
          <Button type="primary" disabled={!snapshot || busy} onClick={() => setEditor({ enabled: false, revision: snapshot!.revision })}>{tx("新建专家团")}</Button>
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
          if (isPluginLeadTeam(team)) return (<LibraryCard key={team.id} testId="team-card" name={team.name} avatar={<div className="aag-team-avatar">
              <div className="agt-stack">{[team.lead, ...team.members].slice(0, 3).map(agent => <Avatar key={agent.expertSlug} expert={experts.find(expert => expert.slug === agent.expertSlug)}/>)}</div>
            </div>} metadata={<>{tx("内置")} · v{team.packageVersion}</>} description={team.description} content={<div className="agt-plugin-card-content">
              <p className="aag-card-description" title={team.description}>{team.description}</p>
              <dl><div><dt>Lead</dt><dd>{team.lead.name}</dd></div><div><dt>{tx("成员")}</dt><dd>{team.members.length}</dd></div><div><dt>{tx("技能")}</dt><dd>{team.skills.length}</dd></div></dl>
              {team.connectorStates.length > 0 && <div className="agt-plugin-connectors">{team.connectorStates.map(connector => <span key={connector.dependency} data-state={connector.state} data-ready={connector.installed && connector.enabled && connector.credentialsReady}><i aria-hidden="true"/>{connector.dependency} · {connectorStatus(connector, tx)}</span>)}</div>}
            </div>} enabled={snapshot!.enabledTeams.includes(team.id)} disabled={busy} enabledLabel={tx("已启用")} disabledLabel={tx("已停用")} toggle={() => void changePlugin(team.id, !snapshot!.enabledTeams.includes(team.id))} moreItems={team.connectorStates.flatMap(connector => {
                if (!connector.installed)
                    return [{ id: `connector-install-${connector.dependency}`, label: connector.credentialsRequired ? tx("配置 Connector：{0}", [connector.dependency]) : tx("安装 Connector：{0}", [connector.dependency]), disabled: busy || (!connector.installable && !connector.credentialsRequired), onSelect: () => connector.credentialsRequired ? props.onOpenConnectors?.() : void changeConnector(team, connector.dependency, 'install') }];
                return [
                    { id: `connector-toggle-${connector.dependency}`, label: connector.enabled ? tx("停用 Connector：{0}", [connector.dependency]) : tx("启用 Connector：{0}", [connector.dependency]), disabled: busy, onSelect: () => void changeConnector(team, connector.dependency, connector.enabled ? 'disable' : 'enable') },
                    { id: `connector-test-${connector.dependency}`, label: tx("测试 Connector：{0}", [connector.dependency]), disabled: busy, onSelect: () => void changeConnector(team, connector.dependency, 'test') },
                ];
            })} actions={<><button type="button" className="aag-card-action" aria-haspopup="dialog" disabled={busy} onClick={() => setDetails(team)}><IconEye size={18}/>{tx("查看详情")}</button><button type="button" className="aag-card-action" disabled={busy} onClick={() => void selectPlugin(team)}><IconSend size={18}/>{tx("召唤专家团")}</button></>}/>);
            const issue = teamIssue(team, experts, snapshot!.enabledExperts);
            const enabled = snapshot!.enabledTeams.includes(team.id);
            return (<LibraryCard key={team.id} testId="team-card" name={team.name} avatar={<div className="aag-team-avatar">
                  <TeamAvatars team={team} experts={experts}/>
                </div>} metadata={tx("{0} 位专家", [team.members.length])} description={enabled && issue
                    ? `${team.description} ${tx(issue)}`
                    : team.description} enabled={enabled} disabled={busy} enabledLabel={tx("已启用")} disabledLabel={tx("已停用")} toggle={() => void change(team, 'enable')} moreItems={[
                    { id: 'edit', label: team.builtin ? tx("复制并自定义") : tx("编辑专家团"), disabled: busy, onSelect: () => (team.builtin ? copy(team) : edit(team)) },
                    ...(!team.builtin ? [{ id: 'delete', label: tx("删除专家团"), danger: true, disabled: busy, onSelect: () => void change(team, 'delete') }] : []),
                ]} actions={<>
                  <button type="button" className="aag-card-action" title={tx("查看详情")} aria-label={tx("查看详情")} aria-haspopup="dialog" onClick={() => setDetails(team)}>
                    <IconEye size={18}/>{tx("查看详情")}</button>
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
      {details && (isPluginLeadTeam(details) ? <LeadTeamDetails team={details} experts={experts} busy={busy} close={() => setDetails(null)} select={example => void selectPlugin(details, example)}
        connector={(dependency, action) => void changeConnector(details, dependency, action)} openConnectors={props.onOpenConnectors}/> : <TeamDetails team={details} experts={experts} close={() => setDetails(null)} onCopy={() => copy(details)} onSelect={(example) => void change(details, 'select', example)} onEdit={!details.builtin
                ? () => {
                    setEditor({
                        value: details,
                        enabled: snapshot!.enabledTeams.includes(details.id),
                        revision: snapshot!.revision,
                    });
                    setDetails(null);
                }
                : undefined} onDelete={!details.builtin ? () => void change(details, 'delete') : undefined}/>)}
      {editor && (<TeamEditor initial={editor.value} experts={experts} enabled={editor.enabled} enabledExperts={snapshot!.enabledExperts} close={() => setEditor(null)} refresh={async () => {
                const latest = await unwrap(props.remote.getTeams());
                accept(latest);
                const catalog = await unwrap(props.remote.getCatalog());
                setExperts(catalog.experts);
                return latest;
            }} save={async (value, enabled, revision) => {
                const next = await unwrap(props.remote.saveTeam(value, enabled, revision ?? editor.revision));
                accept(next);
                setEditor(null);
                setNotice(tx("专家团配置已保存。"));
            }}/>)}
      {confirm && (<TeamConfirm title={confirm.action === 'delete' ? tx("删除专家团？") : tx("启用团队成员")} label={confirm.action === 'delete' ? tx("确认删除") : tx("启用团队及所需成员")} busy={busy} error={error} onCancel={() => setConfirm(null)} onConfirm={() => {
                const current = confirm;
                void change(current.team, current.action, current.example, true);
            }}>
          <p>
            {confirm.action === 'delete'
                ? tx("删除“{0}”的配置，保留成员专家和历史会话。", [confirm.team.name]) : tx("同时启用：{0}。停用团队时不会停用成员。", [confirm.team.members
                    .filter((m) => !snapshot!.enabledExperts.includes(m.expertSlug))
                    .map((m) => experts.find((e) => e.slug === m.expertSlug)?.name ?? tx("失效成员"))
                    .join(locale === 'en' ? ', ' : '、')])}
          </p>
        </TeamConfirm>)}
    </section>);
    return <MaybeAntdProvider locale={antdLocale(locale)}>{panel}</MaybeAntdProvider>;
}
