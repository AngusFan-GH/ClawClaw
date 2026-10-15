// @ts-nocheck -- ported client compatibility layer; host contracts remain strictly checked.
import { catalogState } from './catalog.js';
import { acceptTeamSnapshot, refreshTeams, subscribeTeams, teamState } from './team-cache.js';
import { useTeamLocale, localizeTeam, localizedExperts } from './team-locale.js';
import React from 'react';
import type { ExpertTeam, TeamSnapshot } from '../team-contract.js';
import type { ExpertSummary } from '../expert-contract.js';
import type { PluginTeamSnapshot, PluginTeamSummary } from '../plugin-team-contract.js';
import type { TeamReferenceTarget } from './team-reference.js';
import { TeamDetails, unwrap, type TeamRemote } from './team-ui.js';
import { Avatar, TeamAvatars, TeamConfirm, teamIssue, IconEye } from './team-shared.js';
export function TeamMenu(props: {
    remote: TeamRemote;
    prepareSelect?(): (team: TeamReferenceTarget, example?: string) => boolean | Promise<boolean>;
    onSelected(): void;
    onExpertsChanged?(): void;
}) {
    const { locale, tx } = useTeamLocale();

    const [snapshot, setSnapshot] = React.useState<TeamSnapshot | null>(() => teamState(props.remote));
    const [pluginSnapshot, setPluginSnapshot] = React.useState<PluginTeamSnapshot | null>(null);
    const [rawExperts, setExperts] = React.useState<ExpertSummary[]>(() => {
        const catalog = catalogState(props.remote);
        return catalog.revision < 0 ? [] : [...catalog.experts];
    });
    const experts = localizedExperts(rawExperts, locale);
    const [query, setQuery] = React.useState('');
    const [error, setError] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [detail, setDetail] = React.useState<ExpertTeam | null>(null);
    const [confirm, setConfirm] = React.useState<{
        team: ExpertTeam;
        example?: string;
    } | null>(null);
    const alive = React.useRef(true);
    React.useEffect(() => {
        alive.current = true;
        void load();
        const timer = setInterval(() => { if (!busy) void load(); }, 3000);
        const unsubscribe = subscribeTeams(props.remote, () => {
            if (!alive.current)
                return;
            const next = teamState(props.remote);
            if (next)
                setSnapshot(next);
        });
        return () => {
            alive.current = false;
            clearInterval(timer);
            unsubscribe();
        };
    }, [props.remote, busy]);
    const load = async () => {
        try {
            const teams = await refreshTeams(props.remote);
            if (!alive.current)
                return;
            setSnapshot(teams);
            if (typeof props.remote.getPluginTeams === 'function')
                setPluginSnapshot(await unwrap(props.remote.getPluginTeams()));
            const known = catalogState(props.remote);
            if (known.revision >= 0)
                setExperts([...known.experts]);
            else {
                const catalog = await unwrap(props.remote.getCatalog());
                if (alive.current)
                    setExperts(catalog.experts);
            }
            if (alive.current)
                setError('');
        }
        catch (cause) {
            if (alive.current)
                setError(cause instanceof Error ? tx(cause.message) : tx("专家团加载失败"));
        }
    };
    const pickPlugin = async (team: PluginTeamSummary) => {
        if (busy || !pluginSnapshot)
            return;
        const insert = props.prepareSelect?.();
        setBusy(true);
        try {
            let current = team;
            if (!team.enabled) {
                if (typeof props.remote.setPluginTeamEnabled !== 'function')
                    throw new Error(tx("Plugin Team 服务不可用，请重新加载插件。"));
                const next = await unwrap(props.remote.setPluginTeamEnabled(team.id, true, pluginSnapshot.revision));
                if (!alive.current)
                    return;
                setPluginSnapshot(next);
                const legacy = await refreshTeams(props.remote);
                if (alive.current)
                    setSnapshot(legacy);
                current = next.teams.find(item => item.id === team.id) ?? { ...team, enabled: true };
                props.onExpertsChanged?.();
            }
            if (!await insert?.({ id: current.id, name: current.name, examples: current.quickPrompts }))
                throw new Error(tx("无法插入团队，请确认当前聊天草稿后重试。"));
            props.onSelected();
        }
        catch (cause) {
            if (alive.current)
                setError(cause instanceof Error ? tx(cause.message) : tx("选择失败。"));
        }
        finally {
            if (alive.current)
                setBusy(false);
        }
    };
    const pick = async (team: ExpertTeam, example?: string, confirmed = false) => {
        if (busy || !snapshot)
            return;
        if (!confirmed &&
            (!snapshot.enabledTeams.includes(team.id) ||
                teamIssue(team, experts, snapshot.enabledExperts))) {
            setConfirm({ team, example });
            return;
        }
        const insert = props.prepareSelect?.();
        setBusy(true);
        try {
            if (confirmed) {
                const next = await unwrap(props.remote.setTeamEnabled(team.id, true, snapshot.revision));
                if (!alive.current)
                    return;
                acceptTeamSnapshot(props.remote, next);
                setSnapshot(next);
                props.onExpertsChanged?.();
            }
            if (!alive.current)
                return;
            if (!await insert?.(team, example))
                throw new Error(tx("无法插入团队，请确认当前聊天草稿后重试。"));
            props.onSelected();
        }
        catch (cause) {
            if (alive.current)
                setError(cause instanceof Error ? tx(cause.message) : tx("选择失败。"));
        }
        finally {
            if (alive.current)
                setBusy(false);
        }
    };
    const teams = snapshot?.teams.map(team => localizeTeam(team, locale)).filter((t) => (query !== '' || snapshot.enabledTeams.includes(t.id)) &&
        `${t.name} ${t.description}`
            .toLowerCase()
            .includes(query.toLowerCase())) ?? [];
    const pluginTeams = pluginSnapshot?.teams.filter(team => (query !== '' || team.enabled) && `${team.name} ${team.description}`.toLowerCase().includes(query.toLowerCase())) ?? [];
    return (<div className="agt-compact">
      <div className="aag-discovery-tools">
        <input type="search" autoFocus aria-label={tx("搜索专家团")} placeholder={tx("搜索团队或工作目标")} value={query} onChange={(e) => setQuery(e.target.value)}/>
      </div>
      {error && (<div role="alert">
          {error}
          <button type="button" onClick={() => void load()}>{tx("刷新")}</button>
        </div>)}
      <div className="agt-compact-list">
        {pluginTeams.map((team) => (<div className="agt-compact-row" key={team.id}>
            <button type="button" disabled={busy} onClick={() => void pickPlugin(team)}>
              <div className="agt-stack">{[team.lead, ...team.members].slice(0, 3).map(agent => <Avatar key={agent.slug} expert={experts.find(expert => expert.slug === agent.slug)}/>)}</div>
              <span>{team.name}</span><small>Plugin Team · v{team.installedVersion}{team.enabled ? '' : tx(" · 启用并选择")}</small>
            </button>
          </div>))}
        {teams.map((team) => (<div className="agt-compact-row" key={team.id}>
            <button type="button" disabled={busy} onClick={() => void pick(team)}>
              <TeamAvatars team={team} experts={experts}/>
              <span>{team.name}</span>
              <small>
                {team.members.length}{tx("人")}{snapshot?.enabledTeams.includes(team.id)
                ? ''
                : tx(" \u00B7 启用并选择")}
              </small>
            </button>
            <button type="button" aria-label={tx("查看{0}详情", [team.name])} onClick={() => setDetail(team)}>
              <IconEye size={16}/>
            </button>
          </div>))}
        {!teams.length && !pluginTeams.length && (<p className="aag-menu-empty" role="status">
            {snapshot ? tx("搜索并启用一个专家团。") : tx("正在加载…")}
          </p>)}
      </div>
      {detail && (<TeamDetails team={detail} experts={experts} close={() => setDetail(null)} onSelect={(example) => void pick(detail, example)}/>)}
      {confirm && (<TeamConfirm title={tx("启用专家团")} label={tx("启用团队及所需成员")} onCancel={() => setConfirm(null)} onConfirm={() => {
                const value = confirm;
                setConfirm(null);
                void pick(value.team, value.example, true);
            }}>
          <p>{tx("启用“")}{confirm.team.name}{tx("”及所需成员：")}{confirm.team.members
                .map((m) => experts.find((e) => e.slug === m.expertSlug)?.name ?? tx("失效成员"))
                .join(locale === 'en' ? ', ' : '、')}
            。
          </p>
        </TeamConfirm>)}
    </div>);
}
