// @ts-nocheck -- ported client compatibility layer; host contracts remain strictly checked.
import { catalogState, refreshCatalog, subscribeCatalog } from './catalog.js';
import { refreshTeams, subscribeTeams, teamState } from './team-cache.js';
import { useTeamLocale, localizeTeam, localizedExperts } from './team-locale.js';
import React from 'react';
import { isTeamRecalled, type ExpertTeam, type TeamSnapshot } from '../team-contract.js';
import type { ExpertSummary } from '../expert-contract.js';
import type { TeamReferenceTarget } from './team-reference.js';
import { TeamDetails, type TeamRemote } from './team-ui.js';
import { TeamAvatars, teamIssue, teamRepairIssue, IconEye } from './team-shared.js';
import { useTeamCapabilityHealth } from './use-team-capabilities.js';
import type { ExpertCapabilityRegistry } from './capability-registry.js';
export function TeamMenu(props: {
    capabilityRegistry?: ExpertCapabilityRegistry;
    remote: TeamRemote;
    prepareSelect?(): (team: TeamReferenceTarget, example?: string) => boolean | Promise<boolean>;
    onSelected(): void;
    onExpertsChanged?(): void;
}) {
    const { locale, tx } = useTeamLocale();
    const healthFor = useTeamCapabilityHealth(props.capabilityRegistry);

    const [snapshot, setSnapshot] = React.useState<TeamSnapshot | null>(() => teamState(props.remote));
    const [rawExperts, setExperts] = React.useState<ExpertSummary[]>(() => {
        const catalog = catalogState(props.remote);
        return catalog.revision < 0 ? [] : [...catalog.experts];
    });
    const experts = localizedExperts(rawExperts, locale);
    React.useEffect(() => subscribeCatalog(props.remote, () => {
        const catalog = catalogState(props.remote);
        setExperts([...catalog.experts]);
        setSnapshot(current => current && catalog.revision >= current.revision
            ? { ...current, enabledExperts: [...catalog.enabled], revision: catalog.revision } : current);
    }), [props.remote]);
    const [query, setQuery] = React.useState('');
    const [error, setError] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [detail, setDetail] = React.useState<ExpertTeam | null>(null);
    const alive = React.useRef(true);
    React.useEffect(() => {
        alive.current = true;
        void load();
        const timer = setInterval(() => { if (!busy) void load(); }, 3000);
        const unsubscribe = subscribeTeams(props.remote, () => {
            if (!alive.current)
                return;
            const next = teamState(props.remote);
            if (next) {
                const catalog = catalogState(props.remote);
                setSnapshot(catalog.revision > next.revision ? { ...next, enabledExperts: [...catalog.enabled], revision: catalog.revision } : next);
            }
        });
        return () => {
            alive.current = false;
            clearInterval(timer);
            unsubscribe();
        };
    }, [props.remote, busy]);
    const load = async () => {
        try {
            const [teams, catalog] = await Promise.all([refreshTeams(props.remote), refreshCatalog(props.remote)]);
            if (!alive.current)
                return;
            setSnapshot(catalog.revision >= teams.revision ? { ...teams, enabledExperts: [...catalog.enabled], revision: catalog.revision } : teams);
            setExperts([...catalog.experts]);
            if (alive.current)
                setError('');
        }
        catch (cause) {
            if (alive.current)
                setError(cause instanceof Error ? tx(cause.message) : tx("专家团加载失败"));
        }
    };
    const pick = async (team: ExpertTeam, example?: string) => {
        if (busy || !snapshot)
            return;
        if (teamIssue(team, experts, snapshot.enabledExperts, healthFor(team, rawExperts))) {
            setError(tx("专家团成员或必需能力尚未就绪，请先在设置中修复。"));
            return;
        }
        const insert = props.prepareSelect?.();
        setBusy(true);
        try {
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
    const summoned = snapshot?.teams.filter(team => isTeamRecalled(team, snapshot.enabledExperts)) ?? [];
    const teams = summoned.map(team => localizeTeam(team, locale)).filter((t) =>
        `${t.name} ${t.description}`
            .toLowerCase()
            .includes(query.toLowerCase()));
    return (<div className="agt-compact">
      <div className="aag-discovery-tools">
        <input type="search" autoFocus aria-label={tx("搜索专家团")} placeholder={tx("搜索团队或工作目标")} value={query} onChange={(e) => setQuery(e.target.value)}/>
      </div>
      {error && (<div role="alert">
          {error}
          <button type="button" onClick={() => void load()}>{tx("刷新")}</button>
        </div>)}
      <div className="agt-compact-list">
        {teams.map((team) => {
          const repair = teamRepairIssue(team, experts, healthFor(team, rawExperts));
          const checking = repair === '能力检查中';
          const status = checking ? '能力检查中' : repair ? '需修复' : '已召唤';
          return (<div className="agt-compact-row" key={team.id}>
            <button type="button" disabled={busy || !!repair} onClick={() => void pick(team)}>
              <TeamAvatars team={team} experts={experts}/>
              <span>{team.name}</span>
              <small>{team.members.length}{tx("人")} · {tx(status)}</small>
            </button>
            <button type="button" aria-label={tx("查看{0}详情", [team.name])} onClick={() => setDetail(team)}>
              <IconEye size={16}/>
            </button>
          </div>);
        })}
        {!teams.length && (<p className="aag-menu-empty" role="status">
            {snapshot ? tx(summoned.length ? "没有匹配的专家团。" : "尚未召唤专家团，请先前往专家团管理页召唤。") : tx("正在加载…")}
          </p>)}
      </div>
      {detail && summoned.some(team => team.id === detail.id) && (<TeamDetails team={detail} experts={experts} health={healthFor(detail, rawExperts)} close={() => setDetail(null)} onSelect={snapshot && !teamIssue(detail, experts, snapshot.enabledExperts, healthFor(detail, rawExperts)) ? (example) => void pick(detail, example) : undefined}/>)}
    </div>);
}
